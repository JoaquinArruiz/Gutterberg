//! The AI crate without any real provider: each adapter against requests and replies of the documented
//! shapes, the validation of what a model says, batching and estimates, the on/off gate, and the real
//! transport against a server on this computer.
use card_ai::adapters;
use card_ai::error::redact;
use card_ai::estimate::{estimate, price_for};
use card_ai::sort::{parse_sort, sort_requests, Label, PageSummary, SortInput, BATCH};
use card_ai::tasks::{detect_request, parse_detect, MAX_CONFIDENCE};
use card_ai::{
    guarded_send, send, AiError, AiReply, AiRequest, Gate, HttpRequest, HttpResponse, Image,
    ProviderConfig, ProviderKind, Transport, UreqTransport, Usage,
};
use card_core::detect::{ObjectKind, PageObject, ProposalKind};
use card_core::geometry::{PageSize, Rect};
use card_core::units::mm_to_pt;
use card_core::ErrorInfo;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

const A4: PageSize = PageSize {
    width_pt: 595.2756,
    height_pt: 841.8898,
};

fn config(kind: ProviderKind) -> ProviderConfig {
    ProviderConfig {
        kind,
        model: match kind {
            ProviderKind::Anthropic => "claude-sonnet-5-5".into(),
            _ => "some-model".into(),
        },
        base_url: None,
    }
}

fn picture(width: u32, height: u32) -> Image {
    Image {
        mime: "image/png".into(),
        bytes: vec![1, 2, 3, 4],
        width,
        height,
    }
}

fn request() -> AiRequest {
    AiRequest {
        instruction: "Look at the page.".into(),
        images: vec![picture(1000, 1414)],
        schema: json!({ "type": "object", "additionalProperties": false, "properties": { "ok": { "type": "boolean" } }, "required": ["ok"] }),
        max_output_tokens: 512,
    }
}

/// Answers every request with a fixed response and remembers what it was asked.
struct Mock {
    status: u16,
    body: String,
    seen: RefCell<Vec<HttpRequest>>,
}

impl Mock {
    fn new(status: u16, body: Value) -> Self {
        Self {
            status,
            body: body.to_string(),
            seen: RefCell::new(Vec::new()),
        }
    }
}

impl Transport for Mock {
    fn post(&self, request: &HttpRequest, _: Duration) -> card_ai::Result<HttpResponse> {
        self.seen.borrow_mut().push(request.clone());
        Ok(HttpResponse {
            status: self.status,
            body: self.body.clone().into_bytes(),
        })
    }
}

fn sent(mock: &Mock) -> (HttpRequest, Value) {
    let r = mock.seen.borrow()[0].clone();
    let v = serde_json::from_slice(&r.body).unwrap();
    (r, v)
}

fn header<'a>(r: &'a HttpRequest, name: &str) -> Option<&'a str> {
    r.headers
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.as_str())
}

// ---- adapters: what is sent ---------------------------------------------------------------

#[test]
fn anthropic_gets_the_picture_the_instruction_and_a_forced_tool_for_the_schema() {
    let mock = Mock::new(
        200,
        json!({ "content": [{ "type": "tool_use", "name": "report", "input": { "ok": true } }], "stop_reason": "tool_use", "usage": { "input_tokens": 1500, "output_tokens": 20 } }),
    );
    let reply = send(
        &config(ProviderKind::Anthropic),
        Some("sk-ant-secret"),
        &request(),
        &mock,
    )
    .unwrap();
    let (r, body) = sent(&mock);
    assert_eq!(r.url, "https://api.anthropic.com/v1/messages");
    assert_eq!(header(&r, "x-api-key"), Some("sk-ant-secret"));
    assert_eq!(header(&r, "anthropic-version"), Some("2023-06-01"));
    assert_eq!(body["model"], "claude-sonnet-5-5");
    assert_eq!(body["max_tokens"], 512);
    let content = &body["messages"][0]["content"];
    assert_eq!(content[0]["type"], "image");
    assert_eq!(content[0]["source"]["media_type"], "image/png");
    assert_eq!(content[0]["source"]["data"], "AQIDBA==");
    assert_eq!(
        content[1],
        json!({ "type": "text", "text": "Look at the page." })
    );
    assert_eq!(body["tools"][0]["input_schema"], request().schema);
    assert_eq!(
        body["tool_choice"],
        json!({ "type": "tool", "name": "report" })
    );
    assert_eq!(reply.json, json!({ "ok": true }));
    assert_eq!(
        reply.usage,
        Usage {
            input_tokens: 1500,
            output_tokens: 20
        }
    );
}

#[test]
fn openai_compatible_gets_a_data_uri_a_strict_schema_and_a_bearer_key_at_any_base_url() {
    let mock = Mock::new(
        200,
        json!({ "choices": [{ "message": { "content": "{\"ok\": true}" }, "finish_reason": "stop" }], "usage": { "prompt_tokens": 900, "completion_tokens": 12 } }),
    );
    let mut cfg = config(ProviderKind::OpenaiCompatible);
    cfg.base_url = Some("https://api.x.ai/v1/".into());
    let reply = send(&cfg, Some("xai-secret"), &request(), &mock).unwrap();
    let (r, body) = sent(&mock);
    assert_eq!(r.url, "https://api.x.ai/v1/chat/completions");
    assert_eq!(header(&r, "authorization"), Some("Bearer xai-secret"));
    let parts = &body["messages"][0]["content"];
    assert_eq!(
        parts[0],
        json!({ "type": "text", "text": "Look at the page." })
    );
    assert_eq!(
        parts[1]["image_url"]["url"],
        "data:image/png;base64,AQIDBA=="
    );
    assert_eq!(body["response_format"]["type"], "json_schema");
    assert_eq!(body["response_format"]["json_schema"]["strict"], true);
    assert_eq!(
        body["response_format"]["json_schema"]["schema"],
        request().schema
    );
    assert_eq!(reply.json, json!({ "ok": true }));
    assert_eq!(reply.usage.input_tokens, 900);
}

#[test]
fn gemini_gets_inline_data_and_a_schema_in_its_own_dialect() {
    let mock = Mock::new(
        200,
        json!({ "candidates": [{ "content": { "parts": [{ "text": "{\"ok\": false}" }] }, "finishReason": "STOP" }], "usageMetadata": { "promptTokenCount": 700, "candidatesTokenCount": 9 } }),
    );
    let reply = send(
        &config(ProviderKind::Gemini),
        Some("gem-secret"),
        &request(),
        &mock,
    )
    .unwrap();
    let (r, body) = sent(&mock);
    assert_eq!(
        r.url,
        "https://generativelanguage.googleapis.com/v1beta/models/some-model:generateContent"
    );
    assert_eq!(header(&r, "x-goog-api-key"), Some("gem-secret"));
    assert!(
        !r.url.contains("gem-secret"),
        "the key must not be in the address"
    );
    let parts = &body["contents"][0]["parts"];
    assert_eq!(parts[0]["text"], "Look at the page.");
    assert_eq!(parts[1]["inline_data"]["mime_type"], "image/png");
    let schema = &body["generationConfig"]["responseSchema"];
    assert_eq!(schema["type"], "OBJECT");
    assert_eq!(schema["properties"]["ok"]["type"], "BOOLEAN");
    assert!(schema.get("additionalProperties").is_none());
    assert_eq!(
        body["generationConfig"]["responseMimeType"],
        "application/json"
    );
    assert_eq!(reply.json, json!({ "ok": false }));
    assert_eq!(reply.usage.output_tokens, 9);
}

#[test]
fn ollama_needs_no_key_and_gets_base64_images_and_the_schema_as_format() {
    let mock = Mock::new(
        200,
        json!({ "message": { "content": "```json\n{\"ok\": true}\n```" }, "done_reason": "stop", "prompt_eval_count": 600, "eval_count": 7 }),
    );
    let reply = send(&config(ProviderKind::Ollama), None, &request(), &mock).unwrap();
    let (r, body) = sent(&mock);
    assert_eq!(r.url, "http://localhost:11434/api/chat");
    assert!(header(&r, "authorization").is_none() && header(&r, "x-api-key").is_none());
    assert_eq!(body["stream"], false);
    assert_eq!(body["messages"][0]["images"][0], "AQIDBA==");
    assert_eq!(body["format"], request().schema);
    assert_eq!(reply.json, json!({ "ok": true }));
    assert_eq!(
        reply.usage,
        Usage {
            input_tokens: 600,
            output_tokens: 7
        }
    );
}

// ---- adapters: what comes back wrong ----------------------------------------------------------

fn fails(kind: ProviderKind, status: u16, body: Value) -> AiError {
    let mock = Mock::new(status, body);
    send(&config(kind), Some("the-key-123"), &request(), &mock).unwrap_err()
}

#[test]
fn error_statuses_carry_the_providers_message_without_the_key() {
    match fails(
        ProviderKind::OpenaiCompatible,
        401,
        json!({ "error": { "message": "Incorrect API key provided: the-key-123." } }),
    ) {
        AiError::Http { status, detail } => {
            assert_eq!(status, 401);
            assert!(detail.contains("Incorrect API key"));
            assert!(!detail.contains("the-key-123"), "{detail}");
        }
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        fails(
            ProviderKind::Anthropic,
            429,
            json!({ "error": { "message": "rate limited" } })
        ),
        AiError::Http { status: 429, .. }
    ));
    assert!(matches!(
        fails(
            ProviderKind::Gemini,
            500,
            json!({ "error": { "message": "boom" } })
        ),
        AiError::Http { status: 500, .. }
    ));
    assert!(matches!(
        fails(ProviderKind::Ollama, 404, json!({ "error": "model 'x' not found" })),
        AiError::Http { status: 404, detail } if detail.contains("not found")
    ));
}

#[test]
fn refusals_and_blocked_answers_are_refusals() {
    assert!(matches!(
        fails(
            ProviderKind::Anthropic,
            200,
            json!({ "content": [], "stop_reason": "refusal" })
        ),
        AiError::Refused(_)
    ));
    assert!(matches!(
        fails(ProviderKind::Anthropic, 200, json!({ "content": [{ "type": "text", "text": "I cannot help" }], "stop_reason": "end_turn" })),
        AiError::Refused(t) if t.contains("cannot help")
    ));
    assert!(matches!(
        fails(
            ProviderKind::OpenaiCompatible,
            200,
            json!({ "choices": [{ "message": { "refusal": "no" } }] })
        ),
        AiError::Refused(_)
    ));
    assert!(matches!(
        fails(
            ProviderKind::Gemini,
            200,
            json!({ "promptFeedback": { "blockReason": "SAFETY" } })
        ),
        AiError::Refused(_)
    ));
    assert!(matches!(
        fails(
            ProviderKind::Gemini,
            200,
            json!({ "candidates": [{ "finishReason": "SAFETY" }] })
        ),
        AiError::Refused(_)
    ));
}

#[test]
fn a_reply_that_is_cut_off_or_not_json_is_an_invalid_reply() {
    assert!(matches!(
        fails(
            ProviderKind::Anthropic,
            200,
            json!({ "content": [{ "type": "tool_use", "input": {} }], "stop_reason": "max_tokens" })
        ),
        AiError::InvalidReply(_)
    ));
    assert!(matches!(
        fails(
            ProviderKind::OpenaiCompatible,
            200,
            json!({ "choices": [{ "message": { "content": "{\"ok\": tr" }, "finish_reason": "length" }] })
        ),
        AiError::InvalidReply(_)
    ));
    assert!(matches!(
        fails(
            ProviderKind::OpenaiCompatible,
            200,
            json!({ "choices": [{ "message": { "content": "Sure! Here you go" }, "finish_reason": "stop" }] })
        ),
        AiError::InvalidReply(_)
    ));
    assert!(matches!(
        adapters::parse(ProviderKind::Ollama, 200, b"<html>not json</html>", None),
        Err(AiError::InvalidReply(_))
    ));
    assert!(matches!(
        fails(ProviderKind::Ollama, 200, json!({ "message": {} })),
        AiError::InvalidReply(_)
    ));
}

#[test]
fn settings_that_cannot_work_are_refused_before_anything_is_sent() {
    let mock = Mock::new(200, json!({}));
    // A provider that needs a key.
    for kind in [
        ProviderKind::Anthropic,
        ProviderKind::OpenaiCompatible,
        ProviderKind::Gemini,
    ] {
        assert_eq!(
            send(&config(kind), None, &request(), &mock).unwrap_err(),
            AiError::NoKey
        );
        assert_eq!(
            send(&config(kind), Some("  "), &request(), &mock).unwrap_err(),
            AiError::NoKey
        );
    }
    // No model.
    let mut c = config(ProviderKind::OpenaiCompatible);
    c.model = " ".into();
    assert!(matches!(
        send(&c, Some("k"), &request(), &mock),
        Err(AiError::Config(_))
    ));
    // The key must not travel in the clear to a server out on the internet.
    let mut c = config(ProviderKind::OpenaiCompatible);
    c.base_url = Some("http://api.example.com/v1".into());
    assert!(matches!(
        send(&c, Some("k"), &request(), &mock),
        Err(AiError::Config(_))
    ));
    for ok in [
        "http://localhost:1234/v1",
        "http://127.0.0.1:8080",
        "http://192.168.1.20:11434",
        "http://10.0.0.5",
        "http://172.20.1.1",
    ] {
        c.base_url = Some(ok.into());
        assert!(
            send(
                &c,
                Some("k"),
                &request(),
                &Mock::new(
                    200,
                    json!({ "choices": [{ "message": { "content": "{}" } }] })
                )
            )
            .is_ok(),
            "{ok}"
        );
    }
    c.base_url = Some("http://172.32.1.1".into());
    assert!(matches!(
        send(&c, Some("k"), &request(), &mock),
        Err(AiError::Config(_))
    ));
    assert!(mock.seen.borrow().is_empty(), "nothing was sent");
}

#[test]
fn the_host_is_what_the_notice_names() {
    assert_eq!(config(ProviderKind::Anthropic).host(), "api.anthropic.com");
    assert_eq!(config(ProviderKind::Ollama).host(), "localhost:11434");
    let mut c = config(ProviderKind::OpenaiCompatible);
    c.base_url = Some(" https://openrouter.ai/api/v1/ ".into());
    assert_eq!(c.host(), "openrouter.ai");
    c.base_url = Some("".into());
    assert_eq!(c.host(), "api.openai.com");
}

#[test]
fn errors_reach_the_ui_as_codes_with_their_values() {
    let info = ErrorInfo::from(AiError::Http {
        status: 429,
        detail: "slow down".into(),
    });
    assert_eq!(info.code, "ai_http");
    let json = serde_json::to_value(&info).unwrap();
    assert_eq!(json["status"].as_f64(), Some(429.0));
    assert_eq!(json["detail"], "slow down");
    for (e, code) in [
        (AiError::Disabled, "ai_disabled"),
        (AiError::NoKey, "ai_no_key"),
        (AiError::Keychain("x".into()), "ai_keychain"),
        (AiError::Timeout, "ai_timeout"),
        (AiError::Refused("x".into()), "ai_refused"),
        (AiError::InvalidReply("x".into()), "ai_invalid_reply"),
        (AiError::InvalidProposal("x".into()), "ai_invalid_proposal"),
        (AiError::TextOnlyNeedsObjects, "ai_text_only_needs_objects"),
    ] {
        assert_eq!(ErrorInfo::from(e).code, code);
    }
    assert_eq!(
        redact("bad key abcd1234 here", Some("abcd1234")),
        "bad key [key] here"
    );
    assert_eq!(redact("short", Some("ab")), "short");
}

// ---- detect ------------------------------------------------------------------------------

fn grid_reply(over: Value) -> Value {
    let mut v = json!({
        "kind": "grid", "confidence": 0.9,
        "grid_x": 0.1, "grid_y": 0.1, "grid_width": 0.8, "grid_height": 0.8,
        "grid_rows": 3, "grid_columns": 3, "gap_x_mm": 0, "gap_y_mm": 0, "rects": [],
    });
    for (k, x) in over.as_object().unwrap() {
        v[k] = x.clone();
    }
    v
}

fn rects_reply(rects: Value, confidence: f64) -> Value {
    json!({
        "kind": "rects", "confidence": confidence,
        "grid_x": 0, "grid_y": 0, "grid_width": 0, "grid_height": 0, "grid_rows": 0, "grid_columns": 0,
        "gap_x_mm": 0, "gap_y_mm": 0, "rects": rects,
    })
}

fn one_rect(cx: f64, cy: f64, w: f64, h: f64, angle: f64) -> Value {
    json!([{ "cx": cx, "cy": cy, "width": w, "height": h, "angle_deg": angle }])
}

#[test]
fn a_grid_answer_becomes_a_proposal_in_points_marked_ai_and_never_better_than_good() {
    let d = parse_detect(&grid_reply(json!({ "gap_x_mm": 2.0, "gap_y_mm": 2.0 })), A4).unwrap();
    let p = &d.proposals[0];
    assert_eq!(p.engine, "ai");
    assert!(p.confidence <= MAX_CONFIDENCE);
    match &p.kind {
        ProposalKind::Grid {
            bounds,
            rows,
            columns,
            source_gap_x_mm,
            ..
        } => {
            assert_eq!((*rows, *columns), (3, 3));
            assert!((bounds.x - 0.1 * A4.width_pt).abs() < 1e-6);
            assert!((bounds.height - 0.8 * A4.height_pt).abs() < 1e-6);
            assert_eq!(*source_gap_x_mm, 2.0);
        }
        other => panic!("{other:?}"),
    }
    // A model that claims certainty is still capped; one that doubts is still offered, as low.
    assert_eq!(
        parse_detect(&grid_reply(json!({ "confidence": 1.0 })), A4)
            .unwrap()
            .proposals[0]
            .confidence,
        0.8
    );
    assert_eq!(
        parse_detect(&grid_reply(json!({ "confidence": 0.05 })), A4)
            .unwrap()
            .proposals[0]
            .confidence,
        0.35
    );
}

#[test]
fn a_rectangles_answer_keeps_the_tilt_and_turns_a_quarter_into_swapped_sides() {
    let d = parse_detect(&rects_reply(one_rect(0.5, 0.5, 0.2, 0.15, -10.0), 0.7), A4).unwrap();
    let ProposalKind::Rects { rects } = &d.proposals[0].kind else {
        panic!()
    };
    assert_eq!(rects.len(), 1);
    assert!((rects[0].center.x - 0.5 * A4.width_pt).abs() < 1e-6);
    assert!((rects[0].angle_deg + 10.0).abs() < 1e-9);
    assert!((rects[0].width - 0.2 * A4.width_pt).abs() < 1e-6);

    // 100 degrees is a quarter turn and ten more: sides swap, tilt 10.
    let d = parse_detect(&rects_reply(one_rect(0.5, 0.5, 0.2, 0.15, 100.0), 0.7), A4).unwrap();
    let ProposalKind::Rects { rects } = &d.proposals[0].kind else {
        panic!()
    };
    assert!((rects[0].angle_deg - 10.0).abs() < 1e-9);
    assert!((rects[0].width - 0.15 * A4.height_pt).abs() < 1e-6);
    assert!((rects[0].height - 0.2 * A4.width_pt).abs() < 1e-6);
}

#[test]
fn none_means_no_proposal() {
    let d = parse_detect(&json!({ "kind": "none", "confidence": 0.9 }), A4).unwrap();
    assert!(d.proposals.is_empty());
}

#[test]
fn an_answer_that_cannot_be_the_pieces_of_this_page_is_refused() {
    let bad = |v: Value| parse_detect(&v, A4).unwrap_err();
    // Outside the page.
    assert!(matches!(
        bad(grid_reply(json!({ "grid_x": 0.5, "grid_width": 0.9 }))),
        AiError::InvalidProposal(_)
    ));
    assert!(matches!(
        bad(grid_reply(json!({ "grid_x": -0.4 }))),
        AiError::InvalidProposal(_)
    ));
    // No size, too many cells, fractions of a cell, silly gaps, pieces that would be tiny.
    assert!(matches!(
        bad(grid_reply(json!({ "grid_width": 0 }))),
        AiError::InvalidProposal(_)
    ));
    assert!(matches!(
        bad(grid_reply(json!({ "grid_rows": 31 }))),
        AiError::InvalidProposal(_)
    ));
    assert!(matches!(
        bad(grid_reply(json!({ "grid_columns": 2.5 }))),
        AiError::InvalidProposal(_)
    ));
    assert!(matches!(
        bad(grid_reply(json!({ "grid_rows": 0 }))),
        AiError::InvalidProposal(_)
    ));
    assert!(matches!(
        bad(grid_reply(json!({ "gap_x_mm": 80 }))),
        AiError::InvalidProposal(_)
    ));
    assert!(matches!(
        bad(grid_reply(json!({ "grid_columns": 30, "grid_rows": 30 }))),
        AiError::InvalidProposal(_)
    ));
    // Rectangles: none, too many, too small, outside the page.
    assert!(matches!(
        bad(rects_reply(json!([]), 0.8)),
        AiError::InvalidProposal(_)
    ));
    let many: Vec<Value> = (0..201)
        .map(|_| one_rect(0.5, 0.5, 0.2, 0.2, 0.0)[0].clone())
        .collect();
    assert!(matches!(
        bad(rects_reply(json!(many), 0.8)),
        AiError::InvalidProposal(_)
    ));
    assert!(matches!(
        bad(rects_reply(one_rect(0.5, 0.5, 0.01, 0.01, 0.0), 0.8)),
        AiError::InvalidProposal(_)
    ));
    assert!(matches!(
        bad(rects_reply(one_rect(0.95, 0.5, 0.3, 0.2, 0.0), 0.8)),
        AiError::InvalidProposal(_)
    ));
    assert!(matches!(
        bad(rects_reply(one_rect(1.5, 0.5, 0.2, 0.2, 0.0), 0.8)),
        AiError::InvalidProposal(_)
    ));
    // Not the shape asked for.
    assert!(matches!(
        bad(json!({ "confidence": 0.5 })),
        AiError::InvalidReply(_)
    ));
    assert!(matches!(
        bad(json!({ "kind": "circles", "confidence": 0.5 })),
        AiError::InvalidReply(_)
    ));
    assert!(matches!(
        bad(json!({ "kind": "grid" })),
        AiError::InvalidReply(_)
    ));
    assert!(matches!(
        bad(json!({ "kind": "grid", "confidence": "high" })),
        AiError::InvalidReply(_)
    ));
    assert!(matches!(
        bad(grid_reply(json!({ "grid_x": "left" }))),
        AiError::InvalidReply(_)
    ));
    let _ = mm_to_pt(1.0);
}

#[test]
fn the_detect_request_sends_the_picture_or_only_the_boxes() {
    let r = detect_request(A4, Some(picture(1000, 1414)), &[]).unwrap();
    assert_eq!(r.images.len(), 1);
    assert!(r.instruction.contains("210 mm wide and 297 mm tall"));
    assert!(r.instruction.contains("\"grid\"") && r.instruction.contains("\"rects\""));

    let objects = [
        PageObject {
            kind: ObjectKind::Image,
            rect: Rect::new(59.5276, 84.189, 119.0551, 168.378),
        },
        PageObject {
            kind: ObjectKind::Rect,
            rect: Rect::new(0.0, 0.0, 595.2756, 841.8898),
        },
    ];
    let text_only = detect_request(A4, None, &objects).unwrap();
    assert!(text_only.images.is_empty());
    assert!(text_only.instruction.contains("You are given no picture"));
    // The boxes are fractions of the page, the biggest first.
    assert!(text_only.instruction.contains("\"width\":1.0"));
    assert!(text_only.instruction.contains("\"kind\":\"image\""));
    assert!(text_only.instruction.contains("0.1"));
    // A scan has no objects to describe.
    assert_eq!(
        detect_request(A4, None, &[]).unwrap_err(),
        AiError::TextOnlyNeedsObjects
    );
}

// ---- sort ------------------------------------------------------------------------------

fn pages(n: usize) -> Vec<(usize, Image)> {
    (0..n).map(|i| (i, picture(320, 452))).collect()
}

#[test]
fn fifty_pages_are_three_requests_of_at_most_twenty() {
    let requests = sort_requests(SortInput::Images(pages(50)));
    let sizes: Vec<usize> = requests.iter().map(|(_, idx)| idx.len()).collect();
    assert_eq!(sizes, [BATCH, BATCH, 10]);
    assert_eq!(requests[2].1, (40..50).collect::<Vec<_>>());
    assert_eq!(requests[1].0.images.len(), 20);
    assert!(requests[2].0.instruction.contains("pages 41, 42"));
    assert!(requests[0].0.max_output_tokens >= 256 + 60 * 20);
}

#[test]
fn text_only_sorting_sends_a_description_and_no_picture() {
    let long = "word ".repeat(300);
    let summaries = vec![
        PageSummary {
            page_index: 0,
            width_mm: 210.0,
            height_mm: 297.0,
            images: 1,
            paths: 0,
            texts: 1,
            text: "THE GAME\nBy Someone".into(),
        },
        PageSummary {
            page_index: 1,
            width_mm: 210.0,
            height_mm: 297.0,
            images: 0,
            paths: 40,
            texts: 80,
            text: long,
        },
    ];
    let requests = sort_requests(SortInput::Text(summaries));
    assert_eq!(requests.len(), 1);
    let (r, indexes) = &requests[0];
    assert!(r.images.is_empty());
    assert_eq!(indexes, &[0, 1]);
    assert!(r.instruction.contains("Page 1: 210 x 297 mm, 1 images, 0 drawn shapes, 1 text runs. Text: \"THE GAME By Someone\""));
    // The start of a long text only.
    let page2 = r
        .instruction
        .lines()
        .find(|l| l.starts_with("Page 2"))
        .unwrap();
    assert!(page2.len() < 600, "{}", page2.len());
}

fn sort_reply(rows: &[(u64, &str, f64)]) -> Value {
    json!({ "pages": rows.iter().map(|(p, l, c)| json!({ "page": p, "label": l, "confidence": c })).collect::<Vec<_>>() })
}

#[test]
fn labels_are_read_in_page_order_with_rules_cover_and_other_skipped_by_default() {
    let labels = parse_sort(
        &sort_reply(&[
            (3, "cards", 0.9),
            (1, "cover", 0.8),
            (2, "rules", 0.99),
            (4, "backs", 0.7),
            (5, "other", 2.0),
        ]),
        &[0, 1, 2, 3, 4],
    )
    .unwrap();
    assert_eq!(
        labels.iter().map(|l| l.page_index).collect::<Vec<_>>(),
        [0, 1, 2, 3, 4]
    );
    assert_eq!(labels.iter().map(|l| l.label).collect::<Vec<_>>().len(), 5);
    assert_eq!(labels[0].label, Label::Cover);
    assert_eq!(labels[3].label, Label::Backs);
    assert_eq!(labels[4].confidence, 1.0); // clamped
    let skipped: Vec<bool> = labels
        .iter()
        .map(|l| l.label.skipped_by_default())
        .collect();
    assert_eq!(skipped, [true, true, false, false, true]);
}

#[test]
fn a_sort_answer_must_cover_exactly_the_pages_asked_about() {
    let expected = [0, 1, 2];
    let ok = sort_reply(&[(1, "cards", 0.9), (2, "cards", 0.9), (3, "rules", 0.9)]);
    assert!(parse_sort(&ok, &expected).is_ok());
    // Missing a page, a page twice, a page that was not sent, page 0, an unknown label, nothing at all.
    assert!(matches!(
        parse_sort(
            &sort_reply(&[(1, "cards", 0.9), (2, "cards", 0.9)]),
            &expected
        ),
        Err(AiError::InvalidProposal(_))
    ));
    assert!(matches!(
        parse_sort(
            &sort_reply(&[(1, "cards", 0.9), (1, "cards", 0.9), (2, "x", 0.9)]),
            &expected
        ),
        Err(AiError::InvalidProposal(_))
    ));
    assert!(matches!(
        parse_sort(
            &sort_reply(&[
                (1, "cards", 0.9),
                (2, "cards", 0.9),
                (3, "cards", 0.9),
                (4, "cards", 0.9)
            ]),
            &expected
        ),
        Err(AiError::InvalidProposal(_))
    ));
    assert!(matches!(
        parse_sort(&sort_reply(&[(0, "cards", 0.9)]), &expected),
        Err(AiError::InvalidReply(_))
    ));
    assert!(matches!(
        parse_sort(
            &sort_reply(&[(1, "cards", 0.9), (2, "cards", 0.9), (3, "poster", 0.9)]),
            &expected
        ),
        Err(AiError::InvalidReply(_))
    ));
    assert!(matches!(
        parse_sort(&json!({}), &expected),
        Err(AiError::InvalidReply(_))
    ));
}

// ---- estimate ----------------------------------------------------------------------------

#[test]
fn the_estimate_counts_pictures_text_and_requests_before_anything_is_sent() {
    let one = estimate(&[request()], &config(ProviderKind::Anthropic));
    assert_eq!((one.requests, one.images), (1, 1));
    assert!(one.sends_images);
    assert_eq!(one.host, "api.anthropic.com");
    // 1000 x 1414 / 750 for the picture, a little for the words.
    assert!(
        one.input_tokens >= 1886 && one.input_tokens < 2100,
        "{}",
        one.input_tokens
    );
    assert_eq!(one.output_tokens, 256);
    let cost = one.cost_usd.unwrap();
    assert!(cost > 0.005 && cost < 0.02, "{cost}");

    // Another model has no known price: tokens only.
    let other = estimate(&[request()], &config(ProviderKind::OpenaiCompatible));
    assert!(other.cost_usd.is_none());
    assert!(price_for("claude-sonnet-5-5-20260101").is_some());
    assert!(price_for("gpt-x").is_none());

    // Text only sends no picture.
    let mut text = request();
    text.images.clear();
    let e = estimate(&[text], &config(ProviderKind::Gemini));
    assert!(!e.sends_images);
    assert!(e.input_tokens < 200);

    // A run of three requests adds up.
    let many = estimate(
        &[request(), request(), request()],
        &config(ProviderKind::Anthropic),
    );
    assert_eq!(many.requests, 3);
    assert_eq!(many.input_tokens, one.input_tokens * 3);
}

// ---- the switch and the real transport -----------------------------------------------------

/// A server on this computer that answers one request, and reports what it was asked.
fn serve_once(
    status_line: &'static str,
    body: String,
    delay: Duration,
) -> (u16, std::thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut raw = Vec::new();
        let mut buf = [0u8; 4096];
        let (head_end, length) = loop {
            let n = stream.read(&mut buf).unwrap();
            raw.extend_from_slice(&buf[..n]);
            if let Some(i) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&raw[..i]).to_lowercase();
                let length = head
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .and_then(|v| v.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                break (i + 4, length);
            }
            if n == 0 {
                break (raw.len(), 0);
            }
        };
        while raw.len() < head_end + length {
            let n = stream.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            raw.extend_from_slice(&buf[..n]);
        }
        std::thread::sleep(delay);
        let response = format!(
            "HTTP/1.1 {status_line}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes());
        String::from_utf8_lossy(&raw).into_owned()
    });
    (port, handle)
}

fn local(kind: ProviderKind, port: u16) -> ProviderConfig {
    ProviderConfig {
        base_url: Some(format!("http://127.0.0.1:{port}")),
        ..config(kind)
    }
}

#[test]
fn the_real_transport_sends_the_key_in_a_header_and_reads_the_answer() {
    let reply = json!({ "content": [{ "type": "tool_use", "name": "report", "input": { "ok": true } }], "stop_reason": "tool_use", "usage": { "input_tokens": 5, "output_tokens": 2 } });
    let (port, server) = serve_once("200 OK", reply.to_string(), Duration::ZERO);
    let got: AiReply = send(
        &local(ProviderKind::Anthropic, port),
        Some("sk-live-key"),
        &request(),
        &UreqTransport,
    )
    .unwrap();
    assert_eq!(got.json, json!({ "ok": true }));
    let seen = server.join().unwrap();
    let lower = seen.to_lowercase();
    assert!(seen.starts_with("POST /v1/messages HTTP/1.1"), "{seen}");
    assert!(lower.contains("x-api-key: sk-live-key"));
    assert!(lower.contains("content-type: application/json"));
    assert!(seen.contains("\"tool_choice\""));
    assert!(!seen.lines().next().unwrap().contains("sk-live-key"));
}

#[test]
fn the_real_transport_reports_error_statuses_and_does_not_follow_redirects() {
    let (port, server) = serve_once(
        "401 Unauthorized",
        json!({ "error": { "message": "bad key" } }).to_string(),
        Duration::ZERO,
    );
    let e = send(
        &local(ProviderKind::OpenaiCompatible, port),
        Some("k-123456"),
        &request(),
        &UreqTransport,
    )
    .unwrap_err();
    assert!(
        matches!(e, AiError::Http { status: 401, ref detail } if detail == "bad key"),
        "{e:?}"
    );
    server.join().unwrap();

    let (port, server) = serve_once("302 Found", String::new(), Duration::ZERO);
    let e = send(
        &local(ProviderKind::Ollama, port),
        None,
        &request(),
        &UreqTransport,
    )
    .unwrap_err();
    assert!(matches!(e, AiError::Http { status: 302, .. }), "{e:?}");
    server.join().unwrap();
}

#[test]
fn the_real_transport_gives_up_on_a_server_that_does_not_answer() {
    let (port, server) = serve_once("200 OK", "{}".into(), Duration::from_millis(1500));
    let http = HttpRequest {
        url: format!("http://127.0.0.1:{port}/api/chat"),
        headers: vec![],
        body: b"{}".to_vec(),
    };
    let e = UreqTransport
        .post(&http, Duration::from_millis(300))
        .unwrap_err();
    assert_eq!(e, AiError::Timeout);
    let _ = server.join();

    // Nothing listening at all.
    let closed = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let http = HttpRequest {
        url: format!("http://127.0.0.1:{port}/x"),
        headers: vec![],
        body: vec![],
    };
    assert!(matches!(
        UreqTransport.post(&http, Duration::from_secs(2)),
        Err(AiError::Network(_))
    ));
}

#[test]
fn while_ai_mode_is_off_nothing_is_sent_and_no_connection_is_made() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let gate = Gate::default();
    assert!(!gate.is_on());
    let cfg = local(ProviderKind::Ollama, port);
    let e = guarded_send(&gate, &cfg, None, &request(), &UreqTransport).unwrap_err();
    assert_eq!(e, AiError::Disabled);
    assert!(matches!(listener.accept(), Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock));

    // Switched on, the same call reaches the server.
    gate.set(true);
    let (port, server) = serve_once(
        "200 OK",
        json!({ "message": { "content": "{\"ok\": true}" } }).to_string(),
        Duration::ZERO,
    );
    let ok = guarded_send(
        &gate,
        &local(ProviderKind::Ollama, port),
        None,
        &request(),
        &UreqTransport,
    )
    .unwrap();
    assert_eq!(ok.json, json!({ "ok": true }));
    server.join().unwrap();
    // And off again.
    gate.set(false);
    assert_eq!(
        guarded_send(&gate, &cfg, None, &request(), &UreqTransport).unwrap_err(),
        AiError::Disabled
    );
}
