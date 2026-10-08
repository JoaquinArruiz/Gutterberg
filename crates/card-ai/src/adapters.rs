//! The four provider adapters. Each builds the provider's own request from an [`AiRequest`] and reads the
//! answer back into an [`AiReply`]; they differ only in shape. Written from the providers' documented
//! formats; the tests check them against replies of those shapes.

use crate::error::{redact, AiError, Result};
use crate::provider::{AiReply, AiRequest, HttpRequest, ProviderConfig, ProviderKind, Usage};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

pub fn build(config: &ProviderConfig, key: Option<&str>, request: &AiRequest) -> HttpRequest {
    match config.kind {
        ProviderKind::Anthropic => anthropic_request(config, key, request),
        ProviderKind::OpenaiCompatible => openai_request(config, key, request),
        ProviderKind::Gemini => gemini_request(config, key, request),
        ProviderKind::Ollama => ollama_request(config, request),
    }
}

pub fn parse(kind: ProviderKind, status: u16, body: &[u8], key: Option<&str>) -> Result<AiReply> {
    if !(200..300).contains(&status) {
        return Err(AiError::Http {
            status,
            detail: redact(&error_detail(body), key),
        });
    }
    let v: Value = serde_json::from_slice(body)
        .map_err(|e| AiError::InvalidReply(format!("the answer is not JSON: {e}")))?;
    match kind {
        ProviderKind::Anthropic => anthropic_reply(&v),
        ProviderKind::OpenaiCompatible => openai_reply(&v),
        ProviderKind::Gemini => gemini_reply(&v),
        ProviderKind::Ollama => ollama_reply(&v),
    }
}

fn json_headers(extra: &[(&str, &str)]) -> Vec<(String, String)> {
    let mut h = vec![("content-type".to_string(), "application/json".to_string())];
    h.extend(extra.iter().map(|(k, v)| (k.to_string(), v.to_string())));
    h
}

fn b64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

fn body(v: Value) -> Vec<u8> {
    serde_json::to_vec(&v).unwrap_or_default()
}

/// The provider's own message from an error body, else the start of the body.
fn error_detail(body: &[u8]) -> String {
    let text = String::from_utf8_lossy(body);
    if let Ok(v) = serde_json::from_str::<Value>(&text) {
        let message = v
            .pointer("/error/message")
            .or_else(|| v.get("error"))
            .and_then(Value::as_str);
        if let Some(m) = message {
            return m.chars().take(300).collect();
        }
    }
    text.trim().chars().take(300).collect()
}

/// The JSON in a model's text answer, which some providers wrap in a code fence.
fn json_from_text(text: &str) -> Result<Value> {
    let t = text.trim();
    let t = t
        .strip_prefix("```json")
        .or_else(|| t.strip_prefix("```"))
        .map_or(t, |r| r.strip_suffix("```").unwrap_or(r))
        .trim();
    serde_json::from_str(t)
        .map_err(|e| AiError::InvalidReply(format!("the reply is not the JSON asked for: {e}")))
}

fn number(v: Option<&Value>) -> u64 {
    v.and_then(Value::as_u64).unwrap_or(0)
}

// ---- Anthropic -------------------------------------------------------------------------------

/// The reply is asked for as the input of a forced tool, which Claude fills with JSON of the schema.
const ANTHROPIC_TOOL: &str = "report";

fn anthropic_request(
    config: &ProviderConfig,
    key: Option<&str>,
    request: &AiRequest,
) -> HttpRequest {
    let mut content: Vec<Value> = request
        .images
        .iter()
        .map(|i| {
            json!({ "type": "image", "source": { "type": "base64", "media_type": i.mime, "data": b64(&i.bytes) } })
        })
        .collect();
    content.push(json!({ "type": "text", "text": request.instruction }));
    HttpRequest {
        url: format!("{}/v1/messages", config.base()),
        headers: json_headers(&[
            ("x-api-key", key.unwrap_or("")),
            ("anthropic-version", "2023-06-01"),
        ]),
        body: body(json!({
            "model": config.model,
            "max_tokens": request.max_output_tokens,
            "messages": [{ "role": "user", "content": content }],
            "tools": [{
                "name": ANTHROPIC_TOOL,
                "description": "Report the result.",
                "input_schema": request.schema,
            }],
            "tool_choice": { "type": "tool", "name": ANTHROPIC_TOOL },
        })),
    }
}

fn anthropic_reply(v: &Value) -> Result<AiReply> {
    let usage = Usage {
        input_tokens: number(v.pointer("/usage/input_tokens")),
        output_tokens: number(v.pointer("/usage/output_tokens")),
    };
    let stop = v.get("stop_reason").and_then(Value::as_str).unwrap_or("");
    if stop == "refusal" {
        return Err(AiError::Refused("the model refused this request".into()));
    }
    let blocks = v
        .get("content")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(input) = blocks
        .iter()
        .find(|b| b.get("type").and_then(Value::as_str) == Some("tool_use"))
        .and_then(|b| b.get("input"))
    {
        if stop == "max_tokens" {
            return Err(AiError::InvalidReply("the answer was cut off".into()));
        }
        return Ok(AiReply {
            json: input.clone(),
            usage,
        });
    }
    let said: String = blocks
        .iter()
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(" ");
    Err(AiError::Refused(said.chars().take(200).collect()))
}

// ---- OpenAI-compatible -----------------------------------------------------------------------

fn openai_request(config: &ProviderConfig, key: Option<&str>, request: &AiRequest) -> HttpRequest {
    let mut content = vec![json!({ "type": "text", "text": request.instruction })];
    content.extend(request.images.iter().map(|i| {
        json!({ "type": "image_url", "image_url": { "url": format!("data:{};base64,{}", i.mime, b64(&i.bytes)) } })
    }));
    let auth = key.map(|k| format!("Bearer {k}"));
    let extra: Vec<(&str, &str)> = auth
        .as_deref()
        .map(|a| ("authorization", a))
        .into_iter()
        .collect();
    HttpRequest {
        url: format!("{}/chat/completions", config.base()),
        headers: json_headers(&extra),
        body: body(json!({
            "model": config.model,
            "messages": [{ "role": "user", "content": content }],
            "response_format": {
                "type": "json_schema",
                "json_schema": { "name": "result", "strict": true, "schema": request.schema },
            },
        })),
    }
}

fn openai_reply(v: &Value) -> Result<AiReply> {
    let usage = Usage {
        input_tokens: number(v.pointer("/usage/prompt_tokens")),
        output_tokens: number(v.pointer("/usage/completion_tokens")),
    };
    let choice = v
        .pointer("/choices/0")
        .ok_or_else(|| AiError::InvalidReply("the answer has no choices".into()))?;
    if let Some(r) = choice.pointer("/message/refusal").and_then(Value::as_str) {
        return Err(AiError::Refused(r.chars().take(200).collect()));
    }
    match choice.get("finish_reason").and_then(Value::as_str) {
        Some("length") => return Err(AiError::InvalidReply("the answer was cut off".into())),
        Some("content_filter") => {
            return Err(AiError::Refused(
                "the provider's filter blocked the answer".into(),
            ))
        }
        _ => {}
    }
    let text = choice
        .pointer("/message/content")
        .and_then(Value::as_str)
        .ok_or_else(|| AiError::InvalidReply("the answer has no content".into()))?;
    Ok(AiReply {
        json: json_from_text(text)?,
        usage,
    })
}

// ---- Gemini ----------------------------------------------------------------------------------

/// Gemini's schema is an OpenAPI subset: types in capitals and no `additionalProperties`.
fn gemini_schema(schema: &Value) -> Value {
    match schema {
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(k, _)| k.as_str() != "additionalProperties")
                .map(|(k, v)| {
                    let v = match (k.as_str(), v) {
                        ("type", Value::String(t)) => Value::String(t.to_uppercase()),
                        _ => gemini_schema(v),
                    };
                    (k.clone(), v)
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(gemini_schema).collect()),
        other => other.clone(),
    }
}

fn gemini_request(config: &ProviderConfig, key: Option<&str>, request: &AiRequest) -> HttpRequest {
    let mut parts = vec![json!({ "text": request.instruction })];
    parts.extend(
        request
            .images
            .iter()
            .map(|i| json!({ "inline_data": { "mime_type": i.mime, "data": b64(&i.bytes) } })),
    );
    HttpRequest {
        url: format!(
            "{}/v1beta/models/{}:generateContent",
            config.base(),
            config.model
        ),
        headers: json_headers(&[("x-goog-api-key", key.unwrap_or(""))]),
        body: body(json!({
            "contents": [{ "role": "user", "parts": parts }],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": gemini_schema(&request.schema),
                "maxOutputTokens": request.max_output_tokens,
            },
        })),
    }
}

fn gemini_reply(v: &Value) -> Result<AiReply> {
    let usage = Usage {
        input_tokens: number(v.pointer("/usageMetadata/promptTokenCount")),
        output_tokens: number(v.pointer("/usageMetadata/candidatesTokenCount")),
    };
    if let Some(reason) = v
        .pointer("/promptFeedback/blockReason")
        .and_then(Value::as_str)
    {
        return Err(AiError::Refused(format!(
            "the provider blocked the request ({reason})"
        )));
    }
    let candidate = v
        .pointer("/candidates/0")
        .ok_or_else(|| AiError::InvalidReply("the answer has no candidates".into()))?;
    match candidate.get("finishReason").and_then(Value::as_str) {
        Some(r @ ("SAFETY" | "RECITATION" | "BLOCKLIST" | "PROHIBITED_CONTENT" | "SPII")) => {
            return Err(AiError::Refused(format!(
                "the provider blocked the answer ({r})"
            )));
        }
        Some("MAX_TOKENS") => return Err(AiError::InvalidReply("the answer was cut off".into())),
        _ => {}
    }
    let text: String = candidate
        .pointer("/content/parts")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect()
        })
        .unwrap_or_default();
    if text.is_empty() {
        return Err(AiError::InvalidReply("the answer has no text".into()));
    }
    Ok(AiReply {
        json: json_from_text(&text)?,
        usage,
    })
}

// ---- Ollama ----------------------------------------------------------------------------------

fn ollama_request(config: &ProviderConfig, request: &AiRequest) -> HttpRequest {
    let images: Vec<String> = request.images.iter().map(|i| b64(&i.bytes)).collect();
    HttpRequest {
        url: format!("{}/api/chat", config.base()),
        headers: json_headers(&[]),
        body: body(json!({
            "model": config.model,
            "stream": false,
            "messages": [{ "role": "user", "content": request.instruction, "images": images }],
            "format": request.schema,
            "options": { "temperature": 0 },
        })),
    }
}

fn ollama_reply(v: &Value) -> Result<AiReply> {
    if let Some(e) = v.get("error").and_then(Value::as_str) {
        return Err(AiError::Http {
            status: 200,
            detail: e.chars().take(300).collect(),
        });
    }
    let usage = Usage {
        input_tokens: number(v.get("prompt_eval_count")),
        output_tokens: number(v.get("eval_count")),
    };
    if v.get("done_reason").and_then(Value::as_str) == Some("length") {
        return Err(AiError::InvalidReply("the answer was cut off".into()));
    }
    let text = v
        .pointer("/message/content")
        .and_then(Value::as_str)
        .ok_or_else(|| AiError::InvalidReply("the answer has no content".into()))?;
    Ok(AiReply {
        json: json_from_text(text)?,
        usage,
    })
}
