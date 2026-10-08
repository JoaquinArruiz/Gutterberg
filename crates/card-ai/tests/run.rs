//! The actions end to end with a stand-in provider and in-memory keys: the order of checks (switch, page,
//! key, send), whole-run failure, and that a key never shows up in an error.
use card_ai::sort::{Label, SortInput};
use card_ai::{
    AiError, Gate, HttpRequest, HttpResponse, Image, KeyStore, MemoryKeys, ProviderConfig,
    ProviderKind, Runner, Transport,
};
use card_core::detect::ProposalKind;
use card_core::geometry::PageSize;
use serde_json::{json, Value};
use std::cell::{Cell, RefCell};
use std::time::Duration;

const A4: PageSize = PageSize {
    width_pt: 595.2756,
    height_pt: 841.8898,
};

fn config() -> ProviderConfig {
    ProviderConfig {
        kind: ProviderKind::Anthropic,
        model: "claude-sonnet-5-5".into(),
        base_url: None,
    }
}

fn picture() -> Image {
    Image {
        mime: "image/png".into(),
        bytes: vec![0; 8],
        width: 1000,
        height: 1414,
    }
}

/// Answers each request with the next of `replies` (an Anthropic-shaped tool result, or a raw response).
struct Script {
    replies: RefCell<Vec<(u16, Value)>>,
    sent: RefCell<Vec<HttpRequest>>,
}

impl Script {
    fn new(replies: Vec<(u16, Value)>) -> Self {
        Self {
            replies: RefCell::new(replies),
            sent: RefCell::new(Vec::new()),
        }
    }

    fn ok(input: Value, tokens: (u64, u64)) -> (u16, Value) {
        (
            200,
            json!({ "content": [{ "type": "tool_use", "name": "report", "input": input }], "stop_reason": "tool_use", "usage": { "input_tokens": tokens.0, "output_tokens": tokens.1 } }),
        )
    }
}

impl Transport for Script {
    fn post(&self, request: &HttpRequest, _: Duration) -> card_ai::Result<HttpResponse> {
        self.sent.borrow_mut().push(request.clone());
        let (status, body) = self.replies.borrow_mut().remove(0);
        Ok(HttpResponse {
            status,
            body: body.to_string().into_bytes(),
        })
    }
}

/// Counts how often a key is read.
struct Counting {
    inner: MemoryKeys,
    reads: Cell<usize>,
}

impl KeyStore for Counting {
    fn get(&self, p: ProviderKind) -> card_ai::Result<Option<String>> {
        self.reads.set(self.reads.get() + 1);
        self.inner.get(p)
    }
    fn set(&self, p: ProviderKind, k: &str) -> card_ai::Result<()> {
        self.inner.set(p, k)
    }
    fn delete(&self, p: ProviderKind) -> card_ai::Result<()> {
        self.inner.delete(p)
    }
}

fn keys_with(key: &str) -> Counting {
    let inner = MemoryKeys::default();
    inner.set(ProviderKind::Anthropic, key).unwrap();
    Counting {
        inner,
        reads: Cell::new(0),
    }
}

fn on() -> Gate {
    let g = Gate::default();
    g.set(true);
    g
}

fn grid_answer() -> Value {
    json!({
        "kind": "grid", "confidence": 0.9, "grid_x": 0.1, "grid_y": 0.1, "grid_width": 0.8, "grid_height": 0.8,
        "grid_rows": 3, "grid_columns": 3, "gap_x_mm": 0, "gap_y_mm": 0, "rects": [],
    })
}

#[test]
fn keys_are_saved_replaced_and_removed() {
    let keys = MemoryKeys::default();
    assert!(!keys.has(ProviderKind::Gemini).unwrap());
    keys.set(ProviderKind::Gemini, "one").unwrap();
    keys.set(ProviderKind::Gemini, "two").unwrap();
    assert_eq!(
        keys.get(ProviderKind::Gemini).unwrap().as_deref(),
        Some("two")
    );
    assert!(!keys.has(ProviderKind::Anthropic).unwrap());
    keys.delete(ProviderKind::Gemini).unwrap();
    keys.delete(ProviderKind::Gemini).unwrap(); // nothing there: still fine
    assert!(!keys.has(ProviderKind::Gemini).unwrap());
}

#[test]
fn detect_runs_end_to_end_and_reports_what_it_used() {
    let transport = Script::new(vec![Script::ok(grid_answer(), (1500, 90))]);
    let (gate, keys) = (on(), keys_with("sk-ant-1"));
    let cfg = config();
    let runner = Runner {
        gate: &gate,
        config: &cfg,
        keys: &keys,
        transport: &transport,
    };
    let (detection, usage) = runner.detect(A4, Some(picture()), &[]).unwrap();
    assert_eq!(detection.proposals.len(), 1);
    assert_eq!(detection.proposals[0].engine, "ai");
    assert!(matches!(
        detection.proposals[0].kind,
        ProposalKind::Grid {
            rows: 3,
            columns: 3,
            ..
        }
    ));
    assert_eq!((usage.input_tokens, usage.output_tokens), (1500, 90));
    assert_eq!(transport.sent.borrow().len(), 1);
}

#[test]
fn nothing_is_read_or_sent_while_ai_mode_is_off() {
    let transport = Script::new(vec![]);
    let gate = Gate::default();
    let keys = keys_with("sk-ant-1");
    let cfg = config();
    let runner = Runner {
        gate: &gate,
        config: &cfg,
        keys: &keys,
        transport: &transport,
    };
    assert_eq!(
        runner.detect(A4, Some(picture()), &[]).unwrap_err(),
        AiError::Disabled
    );
    assert_eq!(runner.test().unwrap_err(), AiError::Disabled);
    assert_eq!(
        runner
            .sort(SortInput::Images(vec![(0, picture())]))
            .unwrap_err(),
        AiError::Disabled
    );
    assert_eq!(keys.reads.get(), 0, "the keychain was not touched");
    assert!(transport.sent.borrow().is_empty());
}

#[test]
fn a_missing_key_stops_before_anything_is_sent() {
    let transport = Script::new(vec![]);
    let (gate, keys) = (
        on(),
        Counting {
            inner: MemoryKeys::default(),
            reads: Cell::new(0),
        },
    );
    let cfg = config();
    let runner = Runner {
        gate: &gate,
        config: &cfg,
        keys: &keys,
        transport: &transport,
    };
    assert_eq!(
        runner.detect(A4, Some(picture()), &[]).unwrap_err(),
        AiError::NoKey
    );
    assert!(transport.sent.borrow().is_empty());

    // Ollama needs none and never asks the keychain.
    let ollama = ProviderConfig {
        kind: ProviderKind::Ollama,
        model: "llava".into(),
        base_url: None,
    };
    let transport = Script::new(vec![(
        200,
        json!({ "message": { "content": grid_answer().to_string() } }),
    )]);
    let runner = Runner {
        gate: &gate,
        config: &ollama,
        keys: &keys,
        transport: &transport,
    };
    assert!(runner.detect(A4, Some(picture()), &[]).is_ok());
    assert_eq!(keys.reads.get(), 1, "only the first run read it");
}

#[test]
fn a_page_that_cannot_be_described_fails_before_the_key_is_read() {
    let transport = Script::new(vec![]);
    let (gate, keys) = (on(), keys_with("sk-ant-1"));
    let cfg = config();
    let runner = Runner {
        gate: &gate,
        config: &cfg,
        keys: &keys,
        transport: &transport,
    };
    assert_eq!(
        runner.detect(A4, None, &[]).unwrap_err(),
        AiError::TextOnlyNeedsObjects
    );
    assert_eq!(keys.reads.get(), 0);
}

#[test]
fn a_key_never_appears_in_an_error_or_in_the_address() {
    let key = "sk-ant-api03-SECRETSECRET";
    let transport = Script::new(vec![(
        401,
        json!({ "error": { "message": format!("invalid x-api-key {key}") } }),
    )]);
    let (gate, keys) = (on(), keys_with(key));
    let cfg = config();
    let runner = Runner {
        gate: &gate,
        config: &cfg,
        keys: &keys,
        transport: &transport,
    };
    let e = runner.test().unwrap_err();
    for text in [
        format!("{e}"),
        format!("{e:?}"),
        serde_json::to_string(&card_core::ErrorInfo::from(&e)).unwrap(),
    ] {
        assert!(!text.contains("SECRETSECRET"), "{text}");
    }
    assert!(!transport.sent.borrow()[0].url.contains("SECRETSECRET"));
}

#[test]
fn the_connection_test_checks_the_answer_has_the_shape_asked_for() {
    let (gate, keys) = (on(), keys_with("k-1234"));
    let cfg = config();
    let good = Script::new(vec![Script::ok(json!({ "ok": true }), (20, 4))]);
    let runner = Runner {
        gate: &gate,
        config: &cfg,
        keys: &keys,
        transport: &good,
    };
    assert_eq!(runner.test().unwrap().input_tokens, 20);
    let bad = Script::new(vec![Script::ok(json!({ "hello": 1 }), (20, 4))]);
    let runner = Runner {
        gate: &gate,
        config: &cfg,
        keys: &keys,
        transport: &bad,
    };
    assert!(matches!(runner.test(), Err(AiError::InvalidReply(_))));
}

fn labels(range: std::ops::Range<usize>, label: &str) -> Value {
    json!({ "pages": range.map(|i| json!({ "page": i + 1, "label": label, "confidence": 0.9 })).collect::<Vec<_>>() })
}

#[test]
fn sorting_runs_the_batches_in_turn_and_adds_up_the_usage() {
    let transport = Script::new(vec![
        Script::ok(labels(0..20, "cards"), (1000, 100)),
        Script::ok(labels(20..40, "rules"), (1000, 100)),
        Script::ok(labels(40..45, "cover"), (400, 40)),
    ]);
    let (gate, keys) = (on(), keys_with("k-1234"));
    let cfg = config();
    let runner = Runner {
        gate: &gate,
        config: &cfg,
        keys: &keys,
        transport: &transport,
    };
    let pages: Vec<_> = (0..45).map(|i| (i, picture())).collect();
    let (labelled, usage) = runner.sort(SortInput::Images(pages)).unwrap();
    assert_eq!(labelled.len(), 45);
    assert_eq!(labelled[0].label, Label::Cards);
    assert_eq!(labelled[25].label, Label::Rules);
    assert_eq!(labelled[44].label, Label::Cover);
    assert_eq!((usage.input_tokens, usage.output_tokens), (2400, 240));
    assert_eq!(
        keys.reads.get(),
        1,
        "the key was read once for the whole run"
    );
}

#[test]
fn one_bad_batch_fails_the_whole_run() {
    let transport = Script::new(vec![
        Script::ok(labels(0..20, "cards"), (1000, 100)),
        Script::ok(labels(20..39, "cards"), (1000, 100)), // one page short
    ]);
    let (gate, keys) = (on(), keys_with("k-1234"));
    let cfg = config();
    let runner = Runner {
        gate: &gate,
        config: &cfg,
        keys: &keys,
        transport: &transport,
    };
    let pages: Vec<_> = (0..40).map(|i| (i, picture())).collect();
    assert!(matches!(
        runner.sort(SortInput::Images(pages)),
        Err(AiError::InvalidProposal(_))
    ));
}
