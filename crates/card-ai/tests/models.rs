//! The model list: the GET each provider is asked, how each answer is read, and that nothing is asked
//! while AI Mode is off or without a key the provider needs.
use card_ai::models::{list_models, list_request};
use card_ai::{
    AiError, Gate, HttpRequest, HttpResponse, KeyStore, MemoryKeys, ProviderConfig, ProviderKind,
    Runner, Transport,
};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::time::Duration;

struct Lister {
    status: u16,
    body: Value,
    gets: RefCell<Vec<HttpRequest>>,
}

impl Lister {
    fn new(status: u16, body: Value) -> Self {
        Self {
            status,
            body,
            gets: RefCell::new(Vec::new()),
        }
    }
}

impl Transport for Lister {
    fn post(&self, _: &HttpRequest, _: Duration) -> card_ai::Result<HttpResponse> {
        panic!("the model list is a GET");
    }

    fn get(&self, request: &HttpRequest, _: Duration) -> card_ai::Result<HttpResponse> {
        self.gets.borrow_mut().push(request.clone());
        Ok(HttpResponse {
            status: self.status,
            body: self.body.to_string().into_bytes(),
        })
    }
}

fn config(kind: ProviderKind, base_url: Option<&str>) -> ProviderConfig {
    ProviderConfig {
        kind,
        model: String::new(),
        base_url: base_url.map(str::to_string),
        workspace_id: None,
    }
}

fn header<'a>(r: &'a HttpRequest, name: &str) -> Option<&'a str> {
    r.headers
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.as_str())
}

#[test]
fn asks_each_provider_at_its_own_list_with_its_own_header() {
    let a = list_request(&config(ProviderKind::Anthropic, None), Some("sk-a"));
    assert_eq!(a.url, "https://api.anthropic.com/v1/models?limit=1000");
    assert_eq!(header(&a, "x-api-key"), Some("sk-a"));
    assert!(a.body.is_empty());

    let o = list_request(
        &config(
            ProviderKind::OpenaiCompatible,
            Some("https://openrouter.ai/api/v1/"),
        ),
        Some("sk-or"),
    );
    assert_eq!(o.url, "https://openrouter.ai/api/v1/models");
    assert_eq!(header(&o, "authorization"), Some("Bearer sk-or"));
    let none = list_request(&config(ProviderKind::OpenaiCompatible, None), None);
    assert_eq!(header(&none, "authorization"), None);

    let g = list_request(&config(ProviderKind::Gemini, None), Some("g"));
    assert_eq!(
        g.url,
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000"
    );
    assert_eq!(header(&g, "x-goog-api-key"), Some("g"));

    let l = list_request(&config(ProviderKind::Ollama, None), None);
    assert_eq!(l.url, "http://localhost:11434/api/tags");
    assert!(l.headers.is_empty());
}

#[test]
fn reads_openrouter_with_names_and_whether_a_model_reads_images() {
    let t = Lister::new(
        200,
        json!({ "data": [
            { "id": "openai/gpt-5", "name": "OpenAI: GPT-5", "architecture": { "input_modalities": ["text", "image"] } },
            { "id": "some/text-model", "name": "some/text-model", "architecture": { "input_modalities": ["text"] } },
            { "id": "openai/gpt-5", "name": "again" },
            { "name": "no id" },
        ] }),
    );
    let models = list_models(
        &config(
            ProviderKind::OpenaiCompatible,
            Some("https://openrouter.ai/api/v1"),
        ),
        None,
        &t,
    )
    .unwrap();
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].id, "openai/gpt-5");
    assert_eq!(models[0].name.as_deref(), Some("OpenAI: GPT-5"));
    assert_eq!(models[0].images, Some(true));
    assert_eq!(models[1].name, None); // the same as the id
    assert_eq!(models[1].images, Some(false));
}

#[test]
fn reads_gemini_without_the_models_prefix_or_the_embedding_models() {
    let t = Lister::new(
        200,
        json!({ "models": [
            { "name": "models/gemini-2.5-flash", "displayName": "Gemini 2.5 Flash", "supportedGenerationMethods": ["generateContent", "countTokens"] },
            { "name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"] },
        ] }),
    );
    let models = list_models(&config(ProviderKind::Gemini, None), Some("g"), &t).unwrap();
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "gemini-2.5-flash");
    assert_eq!(models[0].name.as_deref(), Some("Gemini 2.5 Flash"));
}

#[test]
fn reads_anthropic_and_ollama() {
    let a = Lister::new(
        200,
        json!({ "data": [{ "type": "model", "id": "claude-sonnet-5-5", "display_name": "Claude Sonnet 5.5" }], "has_more": false }),
    );
    let models = list_models(&config(ProviderKind::Anthropic, None), Some("k"), &a).unwrap();
    assert_eq!(models[0].id, "claude-sonnet-5-5");
    assert_eq!(models[0].name.as_deref(), Some("Claude Sonnet 5.5"));

    let o = Lister::new(
        200,
        json!({ "models": [{ "name": "llava:latest" }, { "name": "llama3.2-vision:11b" }] }),
    );
    let models = list_models(&config(ProviderKind::Ollama, None), None, &o).unwrap();
    let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["llava:latest", "llama3.2-vision:11b"]);
}

#[test]
fn reports_the_providers_error_without_the_key() {
    let t = Lister::new(
        401,
        json!({ "error": { "message": "invalid x-api-key sk-secret" } }),
    );
    let e = list_models(
        &config(ProviderKind::Anthropic, None),
        Some("sk-secret"),
        &t,
    )
    .unwrap_err();
    assert_eq!(
        e,
        AiError::Http {
            status: 401,
            detail: "invalid x-api-key [key]".into()
        }
    );
    let bad = Lister::new(200, json!({ "unexpected": true }));
    assert!(matches!(
        list_models(&config(ProviderKind::Ollama, None), None, &bad),
        Err(AiError::InvalidReply(_))
    ));
}

#[test]
fn asks_nothing_while_off_without_a_needed_key_or_at_a_plain_http_address() {
    let t = Lister::new(200, json!({ "data": [] }));
    let keys = MemoryKeys::default();
    let gate = Gate::default();
    let anthropic = config(ProviderKind::Anthropic, None);
    let runner = Runner {
        gate: &gate,
        config: &anthropic,
        keys: &keys,
        transport: &t,
    };
    assert_eq!(runner.models(), Err(AiError::Disabled));
    gate.set(true);
    assert_eq!(runner.models(), Err(AiError::NoKey));
    assert!(t.gets.borrow().is_empty());

    keys.set(ProviderKind::Anthropic, "sk-a").unwrap();
    assert_eq!(runner.models(), Ok(Vec::new()));
    assert_eq!(header(&t.gets.borrow()[0], "x-api-key"), Some("sk-a"));

    // An OpenAI-compatible server is asked without a key (OpenRouter and LM Studio answer).
    let open = config(
        ProviderKind::OpenaiCompatible,
        Some("http://localhost:1234/v1"),
    );
    let runner = Runner {
        gate: &gate,
        config: &open,
        keys: &keys,
        transport: &t,
    };
    assert_eq!(runner.models(), Ok(Vec::new()));
    assert_eq!(t.gets.borrow()[1].url, "http://localhost:1234/v1/models");

    let far = config(
        ProviderKind::OpenaiCompatible,
        Some("http://example.com/v1"),
    );
    assert!(matches!(
        list_models(&far, None, &t),
        Err(AiError::Config(_))
    ));
    assert_eq!(t.gets.borrow().len(), 2);
}

// ---- the saved lists ---------------------------------------------------------------------------

fn cache_file(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("gutterberg-models-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir.join("ai-models.json")
}

#[test]
fn a_saved_list_is_used_for_a_week_and_asked_again_on_reload_or_after() {
    use card_ai::model_cache::MAX_AGE_SECS;
    let path = cache_file("week");
    let t = Lister::new(200, json!({ "models": [{ "name": "llava:latest" }] }));
    let keys = MemoryKeys::default();
    let gate = Gate::default();
    gate.set(true);
    let ollama = config(ProviderKind::Ollama, None);
    let runner = Runner {
        gate: &gate,
        config: &ollama,
        keys: &keys,
        transport: &t,
    };
    let first = runner.models_cached(&path, false, 1000).unwrap();
    assert_eq!(first.models[0].id, "llava:latest");
    assert_eq!(first.fetched_at, 1000);
    assert!(path.exists());
    // Opening Preferences again, even after a restart, asks nothing.
    let again = runner.models_cached(&path, false, 1000 + 3600).unwrap();
    assert_eq!(again, first);
    assert_eq!(t.gets.borrow().len(), 1);
    // Reload asks; so does a list older than a week.
    assert_eq!(
        runner.models_cached(&path, true, 2000).unwrap().fetched_at,
        2000
    );
    assert_eq!(
        runner
            .models_cached(&path, false, 2000 + MAX_AGE_SECS)
            .unwrap()
            .fetched_at,
        2000 + MAX_AGE_SECS
    );
    assert_eq!(t.gets.borrow().len(), 3);
    // Another address has its own list.
    let other = config(ProviderKind::Ollama, Some("http://192.168.1.5:11434"));
    Runner {
        config: &other,
        ..runner
    }
    .models_cached(&path, false, 2000 + MAX_AGE_SECS)
    .unwrap();
    assert_eq!(t.gets.borrow().len(), 4);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn a_failed_reload_keeps_the_saved_list_and_says_why_and_off_asks_nothing() {
    let path = cache_file("failed");
    let keys = MemoryKeys::default();
    let gate = Gate::default();
    gate.set(true);
    let ollama = config(ProviderKind::Ollama, None);
    let ok = Lister::new(200, json!({ "models": [{ "name": "llava:latest" }] }));
    Runner {
        gate: &gate,
        config: &ollama,
        keys: &keys,
        transport: &ok,
    }
    .models_cached(&path, false, 1000)
    .unwrap();

    let down = Lister::new(500, json!({ "error": "busy" }));
    let runner = Runner {
        gate: &gate,
        config: &ollama,
        keys: &keys,
        transport: &down,
    };
    let kept = runner.models_cached(&path, true, 5000).unwrap();
    assert_eq!(kept.models[0].id, "llava:latest");
    assert_eq!(kept.fetched_at, 1000);
    assert_eq!(kept.refresh_error.unwrap().code, "ai_http");

    // With nothing saved, the error itself comes back.
    std::fs::remove_file(&path).unwrap();
    assert!(matches!(
        runner.models_cached(&path, true, 5000),
        Err(AiError::Http { status: 500, .. })
    ));

    gate.set(false);
    assert_eq!(
        runner.models_cached(&path, true, 5000),
        Err(AiError::Disabled)
    );
    assert_eq!(down.gets.borrow().len(), 2);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn the_key_itself_is_never_saved() {
    let path = cache_file("key");
    let t = Lister::new(200, json!({ "data": [{ "id": "claude-sonnet-5-5" }] }));
    let keys = MemoryKeys::default();
    keys.set(ProviderKind::Anthropic, "sk-very-secret").unwrap();
    let gate = Gate::default();
    gate.set(true);
    let anthropic = config(ProviderKind::Anthropic, None);
    Runner {
        gate: &gate,
        config: &anthropic,
        keys: &keys,
        transport: &t,
    }
    .models_cached(&path, false, 1)
    .unwrap();
    let saved = std::fs::read_to_string(&path).unwrap();
    assert!(saved.contains("claude-sonnet-5-5"));
    assert!(saved.contains("|key"));
    assert!(!saved.contains("sk-very-secret"));
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
