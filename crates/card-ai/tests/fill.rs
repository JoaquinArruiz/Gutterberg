//! Fill with AI, the request side: what each provider is sent for one piece and how the picture is read back
//! from its answer, without any real provider.
use base64::{engine::general_purpose::STANDARD, Engine};
use card_ai::fill::{draws, edit_size, parse_fill, send_fill, FILL_PROMPT};
use card_ai::{AiError, HttpRequest, HttpResponse, ProviderConfig, ProviderKind, Transport};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::time::Duration;

fn config(kind: ProviderKind) -> ProviderConfig {
    ProviderConfig {
        kind,
        model: "image-model".into(),
        base_url: None,
        workspace_id: None,
    }
}

/// A PNG header that says 1024 × 1536, and nothing else: enough for the request to read its size.
fn picture() -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    png.extend(1024u32.to_be_bytes());
    png.extend(1536u32.to_be_bytes());
    png
}

struct Mock {
    body: String,
    seen: RefCell<Vec<HttpRequest>>,
}

impl Mock {
    fn new(body: Value) -> Self {
        Self {
            body: body.to_string(),
            seen: RefCell::new(Vec::new()),
        }
    }
}

impl Transport for Mock {
    fn post(&self, request: &HttpRequest, _: Duration) -> card_ai::Result<HttpResponse> {
        self.seen.borrow_mut().push(request.clone());
        Ok(HttpResponse {
            status: 200,
            body: self.body.clone().into_bytes(),
        })
    }

    fn get(&self, request: &HttpRequest, timeout: Duration) -> card_ai::Result<HttpResponse> {
        self.post(request, timeout)
    }
}

#[test]
fn only_gemini_and_openai_compatible_servers_draw() {
    assert!(draws(ProviderKind::Gemini));
    assert!(draws(ProviderKind::OpenaiCompatible));
    assert!(!draws(ProviderKind::Anthropic));
    assert!(!draws(ProviderKind::Ollama));
    let mock = Mock::new(json!({}));
    let err = send_fill(
        &config(ProviderKind::Anthropic),
        Some("key"),
        &picture(),
        b"mask",
        &mock,
    )
    .unwrap_err();
    assert_eq!(err, AiError::NoImageOutput);
    assert!(mock.seen.borrow().is_empty());
}

#[test]
fn the_edit_size_is_the_one_nearest_in_shape() {
    assert_eq!(edit_size(800, 1100), (1024, 1536));
    assert_eq!(edit_size(1100, 800), (1536, 1024));
    assert_eq!(edit_size(900, 950), (1024, 1024));
}

#[test]
fn gemini_gets_the_picture_and_asks_for_one_back() {
    let drawn = STANDARD.encode(b"drawn");
    let mock = Mock::new(json!({
        "candidates": [{ "content": { "parts": [
            { "text": "Here it is." },
            { "inlineData": { "mimeType": "image/png", "data": drawn } },
        ] } }],
        "usageMetadata": { "promptTokenCount": 1300, "candidatesTokenCount": 1290 },
    }));
    let (bytes, usage) = send_fill(
        &config(ProviderKind::Gemini),
        Some("key"),
        &picture(),
        b"mask",
        &mock,
    )
    .unwrap();
    assert_eq!(bytes, b"drawn");
    assert_eq!((usage.input_tokens, usage.output_tokens), (1300, 1290));
    let r = mock.seen.borrow()[0].clone();
    assert!(r
        .url
        .ends_with("/v1beta/models/image-model:generateContent"));
    let v: Value = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(v["contents"][0]["parts"][0]["text"], FILL_PROMPT);
    assert_eq!(
        v["contents"][0]["parts"][1]["inline_data"]["data"],
        STANDARD.encode(picture())
    );
    assert_eq!(
        v["generationConfig"]["responseModalities"],
        json!(["TEXT", "IMAGE"])
    );
}

#[test]
fn gemini_without_a_picture_says_why() {
    let words = json!({ "candidates": [{ "content": { "parts": [{ "text": "I cannot edit images." }] } }] });
    let err = parse_fill(
        ProviderKind::Gemini,
        200,
        words.to_string().as_bytes(),
        None,
    )
    .unwrap_err();
    assert_eq!(err, AiError::Refused("I cannot edit images.".into()));
    let blocked = json!({ "candidates": [{ "finishReason": "IMAGE_SAFETY" }] });
    assert!(matches!(
        parse_fill(
            ProviderKind::Gemini,
            200,
            blocked.to_string().as_bytes(),
            None
        ),
        Err(AiError::Refused(_))
    ));
}

#[test]
fn an_openai_compatible_server_gets_the_picture_and_the_mask_as_a_form() {
    let mock = Mock::new(json!({
        "data": [{ "b64_json": STANDARD.encode(b"drawn") }],
        "usage": { "input_tokens": 400, "output_tokens": 6000 },
    }));
    let mut c = config(ProviderKind::OpenaiCompatible);
    c.base_url = Some("https://images.example.com/v1".into());
    let (bytes, usage) = send_fill(&c, Some("sk-test"), &picture(), b"MASK", &mock).unwrap();
    assert_eq!(bytes, b"drawn");
    assert_eq!((usage.input_tokens, usage.output_tokens), (400, 6000));
    let r = mock.seen.borrow()[0].clone();
    assert_eq!(r.url, "https://images.example.com/v1/images/edits");
    let has = |name: &str, value: &str| {
        r.headers
            .iter()
            .any(|(k, v)| k == name && v.starts_with(value))
    };
    assert!(has("authorization", "Bearer sk-test"));
    assert!(has("content-type", "multipart/form-data; boundary="));
    let body = String::from_utf8_lossy(&r.body);
    assert!(body.contains("name=\"model\"\r\n\r\nimage-model\r\n"));
    assert!(body.contains("name=\"size\"\r\n\r\n1024x1536\r\n"));
    assert!(body.contains("name=\"image\"; filename=\"image.png\""));
    assert!(body.contains("name=\"mask\"; filename=\"mask.png\""));
    assert!(body.contains("MASK"));
}

#[test]
fn a_link_instead_of_a_picture_or_an_error_status_is_refused_without_the_key() {
    let link = json!({ "data": [{ "url": "https://example.com/x.png" }] });
    assert!(matches!(
        parse_fill(
            ProviderKind::OpenaiCompatible,
            200,
            link.to_string().as_bytes(),
            None
        ),
        Err(AiError::InvalidReply(_))
    ));
    let err = parse_fill(
        ProviderKind::OpenaiCompatible,
        401,
        br#"{"error":{"message":"bad key sk-secret"}}"#,
        Some("sk-secret"),
    )
    .unwrap_err();
    assert!(matches!(&err, AiError::Http { status: 401, detail } if !detail.contains("sk-secret")));
}

#[test]
fn no_image_model_means_no_request() {
    let mock = Mock::new(json!({}));
    let mut c = config(ProviderKind::Gemini);
    c.model = " ".into();
    assert!(matches!(
        send_fill(&c, Some("key"), &picture(), b"", &mock),
        Err(AiError::Config(_))
    ));
    assert!(mock.seen.borrow().is_empty());
}
