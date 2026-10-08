//! Everything that can go wrong with an AI request, as a stable code the UI words in its own language.

use card_core::{ErrorInfo, ErrorParam};

pub type Result<T> = std::result::Result<T, AiError>;

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum AiError {
    /// AI Mode is off, so nothing is sent.
    #[error("AI Mode is off")]
    Disabled,
    /// The provider needs a key and none is saved.
    #[error("no API key is saved for this provider")]
    NoKey,
    /// The system keychain could not be used.
    #[error("the system keychain is not available: {0}")]
    Keychain(String),
    /// The provider answered with an error status.
    #[error("the provider answered {status}: {detail}")]
    Http { status: u16, detail: String },
    /// The provider could not be reached, or did not answer in time.
    #[error("could not reach the provider: {0}")]
    Network(String),
    #[error("the provider did not answer in time")]
    Timeout,
    /// The model declined, or the provider blocked the request.
    #[error("the model declined to answer: {0}")]
    Refused(String),
    /// The reply is not JSON of the shape that was asked for.
    #[error("the reply could not be read: {0}")]
    InvalidReply(String),
    /// The reply is well formed but describes something that cannot be on the page.
    #[error("the proposal does not fit the page: {0}")]
    InvalidProposal(String),
    /// Text only was asked for, but the page has nothing to describe in text.
    #[error("this page has no objects to describe; turn on sending page images")]
    TextOnlyNeedsObjects,
    /// A setting is missing or wrong (an empty model, a bad URL).
    #[error("{0}")]
    Config(String),
}

impl AiError {
    pub fn code(&self) -> &'static str {
        match self {
            AiError::Disabled => "ai_disabled",
            AiError::NoKey => "ai_no_key",
            AiError::Keychain(_) => "ai_keychain",
            AiError::Http { .. } => "ai_http",
            AiError::Network(_) => "ai_network",
            AiError::Timeout => "ai_timeout",
            AiError::Refused(_) => "ai_refused",
            AiError::InvalidReply(_) => "ai_invalid_reply",
            AiError::InvalidProposal(_) => "ai_invalid_proposal",
            AiError::TextOnlyNeedsObjects => "ai_text_only_needs_objects",
            AiError::Config(_) => "ai_config",
        }
    }
}

impl From<&AiError> for ErrorInfo {
    fn from(e: &AiError) -> Self {
        let mut info = ErrorInfo::new(e.code(), &e.to_string());
        let text = |s: &str| ErrorParam::Text(s.to_string());
        match e {
            AiError::Http { status, detail } => {
                info.params
                    .insert("status".into(), ErrorParam::Number(f64::from(*status)));
                info.params.insert("detail".into(), text(detail));
            }
            AiError::Keychain(d)
            | AiError::Network(d)
            | AiError::Refused(d)
            | AiError::InvalidReply(d)
            | AiError::InvalidProposal(d)
            | AiError::Config(d) => {
                info.params.insert("detail".into(), text(d));
            }
            AiError::Disabled
            | AiError::NoKey
            | AiError::Timeout
            | AiError::TextOnlyNeedsObjects => {}
        }
        info
    }
}

impl From<AiError> for ErrorInfo {
    fn from(e: AiError) -> Self {
        Self::from(&e)
    }
}

/// `text` without `secret` (a provider may echo part of a key in an error message).
pub fn redact(text: &str, secret: Option<&str>) -> String {
    match secret {
        Some(s) if s.len() >= 4 => text.replace(s, "[key]"),
        _ => text.to_string(),
    }
}
