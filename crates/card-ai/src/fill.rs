//! Fill with AI: the bleed of a piece painted by an image model. Unlike the other actions the answer is a
//! picture, not JSON, so it has its own request shapes: Gemini's `generateContent` with a picture in the
//! reply, and the OpenAI image edits endpoint (`/images/edits`) with a mask. Anthropic and Ollama have no
//! image output. What is sent is a picture of one piece with a magenta frame where the bleed goes (and,
//! for the edits endpoint, a mask of that frame); what comes back is checked by `card_core::fill`, which
//! keeps only the frame, so the model can never change the piece.

use crate::adapters::error_detail;
use crate::error::{redact, AiError, Result};
use crate::provider::{HttpRequest, ProviderConfig, ProviderKind, Transport, Usage};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::time::Duration;

/// An image model takes longer than a text answer.
pub const FILL_TIMEOUT: Duration = Duration::from_secs(180);

/// What the model is asked to do with the picture.
pub const FILL_PROMPT: &str = "This picture is one playing piece (a card, token or tile) of a board game, \
with a flat magenta frame around it. Paint over the magenta frame only: continue the artwork of the piece \
outward, past its edge, as print bleed, with the same colours, patterns and textures that meet the edge. \
Keep everything inside the frame exactly as it is. Add no text, no new objects, no border and no frame. \
Return the whole picture, the same size and shape.";

/// The output sizes the edits endpoint offers; the picture sent is framed to the nearest one.
pub const EDIT_SIZES: [(u32, u32); 3] = [(1024, 1024), (1536, 1024), (1024, 1536)];

/// Whether `kind` can return a picture.
pub fn draws(kind: ProviderKind) -> bool {
    matches!(kind, ProviderKind::Gemini | ProviderKind::OpenaiCompatible)
}

/// The edits endpoint's size nearest in shape to `width` × `height`.
pub fn edit_size(width: u32, height: u32) -> (u32, u32) {
    let aspect = f64::from(width) / f64::from(height.max(1));
    let off = |(w, h): (u32, u32)| (f64::from(w) / f64::from(h) / aspect).ln().abs();
    EDIT_SIZES
        .into_iter()
        .min_by(|a, b| off(*a).total_cmp(&off(*b)))
        .unwrap_or(EDIT_SIZES[0])
}

/// The request for one piece. `picture` is the framed piece as a PNG; `mask` is a PNG, the same size,
/// opaque over the piece and clear where the model paints (the edits endpoint only).
pub fn fill_request(
    config: &ProviderConfig,
    key: Option<&str>,
    picture: &[u8],
    mask: &[u8],
) -> Result<HttpRequest> {
    match config.kind {
        ProviderKind::Gemini => Ok(gemini_request(config, key, picture)),
        ProviderKind::OpenaiCompatible => Ok(edits_request(config, key, picture, mask)),
        ProviderKind::Anthropic | ProviderKind::Ollama => Err(AiError::NoImageOutput),
    }
}

/// The picture (PNG, JPEG or WebP bytes) in a reply, and what it cost.
pub fn parse_fill(
    kind: ProviderKind,
    status: u16,
    body: &[u8],
    key: Option<&str>,
) -> Result<(Vec<u8>, Usage)> {
    if !(200..300).contains(&status) {
        return Err(AiError::Http {
            status,
            detail: redact(&error_detail(body), key),
        });
    }
    let v: Value = serde_json::from_slice(body)
        .map_err(|e| AiError::InvalidReply(format!("the answer is not JSON: {e}")))?;
    let data = match kind {
        ProviderKind::Gemini => gemini_picture(&v)?,
        _ => edits_picture(&v)?,
    };
    let bytes = STANDARD
        .decode(data.trim())
        .map_err(|_| AiError::InvalidReply("the picture in the answer cannot be read".into()))?;
    let number = |p: &str| v.pointer(p).and_then(Value::as_u64).unwrap_or(0);
    let usage = match kind {
        ProviderKind::Gemini => Usage {
            input_tokens: number("/usageMetadata/promptTokenCount"),
            output_tokens: number("/usageMetadata/candidatesTokenCount")
                + number("/usageMetadata/thoughtsTokenCount"),
        },
        _ => Usage {
            input_tokens: number("/usage/input_tokens"),
            output_tokens: number("/usage/output_tokens"),
        },
    };
    Ok((bytes, usage))
}

/// Sends one fill request and returns the picture that came back, unchecked (see `card_core::fill`).
pub fn send_fill(
    config: &ProviderConfig,
    key: Option<&str>,
    picture: &[u8],
    mask: &[u8],
    transport: &dyn Transport,
) -> Result<(Vec<u8>, Usage)> {
    if config.model.trim().is_empty() {
        return Err(AiError::Config(
            "choose an image model in Preferences".into(),
        ));
    }
    config.check_address()?;
    let key = key.map(str::trim).filter(|k| !k.is_empty());
    if config.kind.needs_key() && key.is_none() {
        return Err(AiError::NoKey);
    }
    let http = fill_request(config, key, picture, mask)?;
    let response = transport.post(&http, FILL_TIMEOUT).map_err(|e| match e {
        AiError::Network(d) => AiError::Network(redact(&d, key)),
        other => other,
    })?;
    parse_fill(config.kind, response.status, &response.body, key)
}

// ---- Gemini ----------------------------------------------------------------------------------

fn gemini_request(config: &ProviderConfig, key: Option<&str>, picture: &[u8]) -> HttpRequest {
    let body = json!({
        "contents": [{ "role": "user", "parts": [
            { "text": FILL_PROMPT },
            { "inline_data": { "mime_type": "image/png", "data": STANDARD.encode(picture) } },
        ] }],
        "generationConfig": { "responseModalities": ["TEXT", "IMAGE"] },
    });
    HttpRequest {
        url: format!(
            "{}/v1beta/models/{}:generateContent",
            config.base(),
            config.model.trim()
        ),
        headers: vec![
            ("content-type".into(), "application/json".into()),
            ("x-goog-api-key".into(), key.unwrap_or("").into()),
        ],
        body: serde_json::to_vec(&body).unwrap_or_default(),
    }
}

fn gemini_picture(v: &Value) -> Result<String> {
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
    if let Some(
        r
        @ ("SAFETY" | "RECITATION" | "BLOCKLIST" | "PROHIBITED_CONTENT" | "SPII" | "IMAGE_SAFETY"),
    ) = candidate.get("finishReason").and_then(Value::as_str)
    {
        return Err(AiError::Refused(format!(
            "the provider blocked the answer ({r})"
        )));
    }
    let parts = candidate
        .pointer("/content/parts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    // The REST answer writes `inlineData`; accept the snake case the request uses too.
    parts
        .iter()
        .find_map(|p| {
            p.get("inlineData")
                .or_else(|| p.get("inline_data"))
                .and_then(|d| d.get("data"))
                .and_then(Value::as_str)
        })
        .map(str::to_string)
        .ok_or_else(|| {
            let said: String = parts
                .iter()
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(" ");
            if said.trim().is_empty() {
                AiError::InvalidReply("the answer has no picture; is this an image model?".into())
            } else {
                AiError::Refused(said.chars().take(200).collect())
            }
        })
}

// ---- OpenAI image edits ----------------------------------------------------------------------

/// A boundary that cannot appear in base64 or in the PNG headers it separates.
const BOUNDARY: &str = "gutterberg-fill-7f3a91c2e5d84b60";

fn edits_request(
    config: &ProviderConfig,
    key: Option<&str>,
    picture: &[u8],
    mask: &[u8],
) -> HttpRequest {
    let mut body = Vec::with_capacity(picture.len() + mask.len() + 1024);
    let mut text = |name: &str, value: &str| {
        body.extend_from_slice(
            format!("--{BOUNDARY}\r\ncontent-disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
                .as_bytes(),
        );
    };
    let (w, h) = png_size(picture).unwrap_or((1024, 1024));
    text("model", config.model.trim());
    text("prompt", FILL_PROMPT);
    text("n", "1");
    text("size", &format!("{w}x{h}"));
    for (name, bytes) in [("image", picture), ("mask", mask)] {
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\ncontent-disposition: form-data; name=\"{name}\"; filename=\"{name}.png\"\r\ncontent-type: image/png\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(bytes);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
    let mut headers = vec![(
        "content-type".to_string(),
        format!("multipart/form-data; boundary={BOUNDARY}"),
    )];
    if let Some(k) = key {
        headers.push(("authorization".into(), format!("Bearer {k}")));
    }
    HttpRequest {
        url: format!("{}/images/edits", config.base()),
        headers,
        body,
    }
}

fn edits_picture(v: &Value) -> Result<String> {
    let first = v
        .pointer("/data/0")
        .ok_or_else(|| AiError::InvalidReply("the answer has no picture".into()))?;
    if let Some(b64) = first.get("b64_json").and_then(Value::as_str) {
        return Ok(b64.to_string());
    }
    Err(AiError::InvalidReply(
        "the answer is a link, not a picture; this server's edits endpoint is not supported".into(),
    ))
}

/// Width and height from a PNG's header.
fn png_size(png: &[u8]) -> Option<(u32, u32)> {
    if png.len() < 24 || &png[..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let be = |at: usize| u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]);
    Some((be(16), be(20)))
}
