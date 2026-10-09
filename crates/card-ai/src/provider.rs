//! Providers and the one request shape they all take: an instruction, some images, a JSON Schema for the
//! reply. Each adapter (`adapters.rs`) turns that into the provider's own HTTP request and reads the answer.

use crate::adapters;
use crate::error::{AiError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

/// How long a provider may take to answer.
pub const TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Anthropic,
    /// Chat completions with image parts and a JSON schema: OpenAI, Grok, OpenRouter, LM Studio...
    OpenaiCompatible,
    Gemini,
    /// A local Ollama server.
    Ollama,
}

impl ProviderKind {
    pub fn default_base_url(self) -> &'static str {
        match self {
            ProviderKind::Anthropic => "https://api.anthropic.com",
            ProviderKind::OpenaiCompatible => "https://api.openai.com/v1",
            ProviderKind::Gemini => "https://generativelanguage.googleapis.com",
            ProviderKind::Ollama => "http://localhost:11434",
        }
    }

    /// The model used when the user has not typed one. Only Anthropic has a default.
    pub fn default_model(self) -> &'static str {
        match self {
            ProviderKind::Anthropic => "claude-sonnet-5-5",
            _ => "",
        }
    }

    /// Whether requests carry a key. A local Ollama needs none.
    pub fn needs_key(self) -> bool {
        self != ProviderKind::Ollama
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub kind: ProviderKind,
    pub model: String,
    /// Empty or absent = the provider's own address.
    #[serde(default)]
    pub base_url: Option<String>,
    /// Anthropic only: the workspace a key that is not scoped to one must name, sent as `anthropic-workspace-id`.
    #[serde(default)]
    pub workspace_id: Option<String>,
}

impl ProviderConfig {
    /// The base URL without a trailing slash.
    pub fn base(&self) -> String {
        let url = self
            .base_url
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .unwrap_or_else(|| self.kind.default_base_url());
        url.trim_end_matches('/').to_string()
    }

    /// The server the requests go to, as the privacy notice names it (`api.anthropic.com`, `localhost:11434`).
    pub fn host(&self) -> String {
        let base = self.base();
        let rest = base.split_once("://").map_or(base.as_str(), |(_, r)| r);
        rest.split('/').next().unwrap_or(rest).to_string()
    }

    /// The workspace ID to send, if one is set (Anthropic only).
    pub fn workspace(&self) -> Option<&str> {
        if self.kind != ProviderKind::Anthropic {
            return None;
        }
        self.workspace_id
            .as_deref()
            .map(str::trim)
            .filter(|w| !w.is_empty())
    }

    fn check(&self) -> Result<()> {
        if self.model.trim().is_empty() {
            return Err(AiError::Config("choose a model in Preferences".into()));
        }
        // It goes into a header, so it can hold nothing but an ID.
        if let Some(w) = self.workspace() {
            if w.len() > 100
                || !w
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                return Err(AiError::Config(
                    "the workspace ID may only have letters, digits, - and _".into(),
                ));
            }
        }
        let base = self.base();
        let secure = base.starts_with("https://");
        let local = base.starts_with("http://") && is_local_host(&self.host());
        if !secure && !local {
            return Err(AiError::Config(
                "the address must use https (http is only for this computer or a private network)"
                    .into(),
            ));
        }
        Ok(())
    }
}

/// Loopback and private-network hosts, where plain http keeps the key on the user's own network.
fn is_local_host(host: &str) -> bool {
    let name = host
        .rsplit_once(':')
        .map_or(host, |(h, _)| h)
        .trim_matches(['[', ']']);
    if name == "localhost" || name == "::1" || name.ends_with(".local") {
        return true;
    }
    let parts: Vec<u32> = name.split('.').filter_map(|p| p.parse().ok()).collect();
    match parts.as_slice() {
        [127, _, _, _] | [10, _, _, _] | [192, 168, _, _] => true,
        [172, b, _, _] => (16..=31).contains(b),
        _ => false,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Image {
    pub mime: String,
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// One request: what to do, what to look at, and the shape the answer must have.
#[derive(Debug, Clone, PartialEq)]
pub struct AiRequest {
    pub instruction: String,
    pub images: Vec<Image>,
    /// A JSON Schema using only `type`, `properties`, `required`, `items`, `enum` and
    /// `additionalProperties`, which every provider accepts.
    pub schema: Value,
    pub max_output_tokens: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

impl Usage {
    pub fn add(&mut self, other: Usage) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AiReply {
    pub json: Value,
    pub usage: Usage,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HttpRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

/// Sends one POST. The real one is [`crate::transport::UreqTransport`]; tests use their own.
pub trait Transport {
    fn post(&self, request: &HttpRequest, timeout: Duration) -> Result<HttpResponse>;
}

/// Sends `request` to the provider and returns its JSON answer. `key` is used for the request and nothing
/// else: it never appears in an error.
pub fn send(
    config: &ProviderConfig,
    key: Option<&str>,
    request: &AiRequest,
    transport: &dyn Transport,
) -> Result<AiReply> {
    config.check()?;
    let key = key.map(str::trim).filter(|k| !k.is_empty());
    if config.kind.needs_key() && key.is_none() {
        return Err(AiError::NoKey);
    }
    let http = adapters::build(config, key, request);
    let response = transport
        .post(&http, TIMEOUT)
        .map_err(|e| redact_error(e, key))?;
    adapters::parse(config.kind, response.status, &response.body, key)
}

fn redact_error(e: AiError, key: Option<&str>) -> AiError {
    use crate::error::redact;
    match e {
        AiError::Network(d) => AiError::Network(redact(&d, key)),
        other => other,
    }
}
