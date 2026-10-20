//! The models a provider offers, for the model picker in Preferences. One GET to the provider's own list
//! (`/v1/models`, `/models`, `/v1beta/models`, `/api/tags`) with the key, if there is one, and nothing else:
//! no page, picture or project goes with it.

use crate::adapters::error_detail;
use crate::error::{redact, AiError, Result};
use crate::provider::{HttpRequest, ProviderConfig, ProviderKind, Transport};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;

/// How long the list may take: it is a small answer, and the field can always be typed in instead.
pub const LIST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelInfo {
    /// What goes in the model setting.
    pub id: String,
    /// The provider's display name, when it has one that is not the id.
    pub name: Option<String>,
    /// Whether the model reads images, when the provider says so (OpenRouter does).
    pub images: Option<bool>,
}

/// The request for `config`'s model list.
pub fn list_request(config: &ProviderConfig, key: Option<&str>) -> HttpRequest {
    let base = config.base();
    let key = key.unwrap_or("");
    let (url, headers) = match config.kind {
        ProviderKind::Anthropic => {
            let mut h = vec![
                ("x-api-key".to_string(), key.to_string()),
                ("anthropic-version".to_string(), "2023-06-01".to_string()),
            ];
            if let Some(w) = config.workspace() {
                h.push(("anthropic-workspace-id".to_string(), w.to_string()));
            }
            (format!("{base}/v1/models?limit=1000"), h)
        }
        ProviderKind::OpenaiCompatible => {
            let h = if key.is_empty() {
                Vec::new()
            } else {
                vec![("authorization".to_string(), format!("Bearer {key}"))]
            };
            (format!("{base}/models"), h)
        }
        ProviderKind::Gemini => (
            format!("{base}/v1beta/models?pageSize=1000"),
            vec![("x-goog-api-key".to_string(), key.to_string())],
        ),
        ProviderKind::Ollama => (format!("{base}/api/tags"), Vec::new()),
    };
    HttpRequest {
        url,
        headers,
        body: Vec::new(),
    }
}

/// The models in a list answer, in the provider's order, without repeats.
pub fn parse_models(
    kind: ProviderKind,
    status: u16,
    body: &[u8],
    key: Option<&str>,
) -> Result<Vec<ModelInfo>> {
    if !(200..300).contains(&status) {
        return Err(AiError::Http {
            status,
            detail: redact(&error_detail(body), key),
        });
    }
    let v: Value = serde_json::from_slice(body)
        .map_err(|e| AiError::InvalidReply(format!("the model list is not JSON: {e}")))?;
    let text = |m: &Value, k: &str| {
        m.get(k)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let (field, items) = match kind {
        ProviderKind::Gemini => ("models", v.get("models")),
        ProviderKind::Ollama => ("models", v.get("models")),
        _ => ("data", v.get("data")),
    };
    let items = items
        .and_then(Value::as_array)
        .ok_or_else(|| AiError::InvalidReply(format!("the model list has no \"{field}\" list")))?;
    let mut seen = HashSet::new();
    let mut models = Vec::new();
    for m in items {
        let info = match kind {
            ProviderKind::Anthropic => text(m, "id").map(|id| ModelInfo {
                name: text(m, "display_name"),
                id,
                images: None,
            }),
            ProviderKind::OpenaiCompatible => text(m, "id").map(|id| ModelInfo {
                name: text(m, "name"),
                images: m
                    .pointer("/architecture/input_modalities")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().any(|x| x.as_str() == Some("image"))),
                id,
            }),
            // Only models that answer generateContent (not the embedding ones), named without "models/".
            ProviderKind::Gemini => {
                let generates = m
                    .get("supportedGenerationMethods")
                    .and_then(Value::as_array)
                    .is_none_or(|a| a.iter().any(|x| x.as_str() == Some("generateContent")));
                text(m, "name").filter(|_| generates).map(|n| ModelInfo {
                    id: n.strip_prefix("models/").unwrap_or(&n).to_string(),
                    name: text(m, "displayName"),
                    images: None,
                })
            }
            ProviderKind::Ollama => text(m, "name").map(|id| ModelInfo {
                id,
                name: None,
                images: None,
            }),
        };
        if let Some(mut info) = info {
            if info.name.as_deref() == Some(info.id.as_str()) {
                info.name = None;
            }
            if seen.insert(info.id.clone()) {
                models.push(info);
            }
        }
    }
    Ok(models)
}

/// Asks the provider for its models. Anthropic and Gemini need the key for it; an OpenAI-compatible server
/// is asked with or without one (OpenRouter and LM Studio answer without).
pub fn list_models(
    config: &ProviderConfig,
    key: Option<&str>,
    transport: &dyn Transport,
) -> Result<Vec<ModelInfo>> {
    config.check_address()?;
    let key = key.map(str::trim).filter(|k| !k.is_empty());
    if matches!(config.kind, ProviderKind::Anthropic | ProviderKind::Gemini) && key.is_none() {
        return Err(AiError::NoKey);
    }
    let response = transport
        .get(&list_request(config, key), LIST_TIMEOUT)
        .map_err(|e| match e {
            AiError::Network(d) => AiError::Network(redact(&d, key)),
            other => other,
        })?;
    parse_models(config.kind, response.status, &response.body, key)
}
