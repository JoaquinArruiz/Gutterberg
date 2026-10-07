use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("PDF error: {0}")]
    Pdf(#[from] lopdf::Error),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid grid: {0}")]
    InvalidGrid(String),
    #[error("page {0} does not exist (document has {1} pages)")]
    PageOutOfRange(usize, usize),
    #[error("page {} has a /Rotate of {}; only multiples of 90 are supported", .0 + 1, .1)]
    UnsupportedRotation(usize, i64),
    #[error("page {} has /UserUnit {}; only 1 is supported", .0 + 1, .1)]
    UnsupportedUserUnit(usize, f64),
    #[error(
        "laid-out cards need {needed_w_mm:.1} x {needed_h_mm:.1} mm but the output page is only \
         {page_w_mm:.1} x {page_h_mm:.1} mm"
    )]
    DoesNotFit {
        needed_w_mm: f64,
        needed_h_mm: f64,
        page_w_mm: f64,
        page_h_mm: f64,
    },
    #[error("invalid sheet: {0}")]
    InvalidSheet(String),
    #[error("pdfium error: {0}")]
    Pdfium(String),
    #[error("superseded")]
    Superseded,
    #[error("render thread stopped")]
    WorkerStopped,
    #[error("no PDF is open")]
    NoDocument,
    #[error("malformed PDF: {0}")]
    Malformed(String),
    #[error("this is not a valid Gutterberg project file")]
    NotAProject,
    #[error(
        "this project was made with a newer version of Gutterberg (file version {found}, this \
         version reads up to {supported}); please update"
    )]
    ProjectTooNew { found: u32, supported: u32 },
}

/// A value that goes with an error code (a page number, a size in mm, a detail text).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ErrorParam {
    Number(f64),
    Text(String),
}

/// An error as the UI receives it: a stable `code`, the values the message needs, and the
/// English `message` (the `Display` text) for logs and as the fallback for a code the UI
/// does not know. Page numbers are 1-based, as the user sees them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ErrorInfo {
    pub code: String,
    pub message: String,
    #[serde(flatten)]
    pub params: BTreeMap<String, ErrorParam>,
}

impl ErrorInfo {
    /// An error with no values.
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            params: BTreeMap::new(),
        }
    }
}

impl From<&Error> for ErrorInfo {
    fn from(e: &Error) -> Self {
        let number = |n: usize| ErrorParam::Number(n as f64);
        let text = |s: &str| ErrorParam::Text(s.to_string());
        let (code, params): (&str, Vec<(&str, ErrorParam)>) = match e {
            Error::Pdf(d) => ("pdf", vec![("detail", text(&d.to_string()))]),
            Error::Io(d) => ("io", vec![("detail", text(&d.to_string()))]),
            Error::InvalidGrid(d) => ("invalid_grid", vec![("detail", text(d))]),
            Error::PageOutOfRange(page, count) => (
                "page_out_of_range",
                vec![("page", number(page + 1)), ("count", number(*count))],
            ),
            Error::UnsupportedRotation(page, rotate) => (
                "unsupported_rotation",
                vec![
                    ("page", number(page + 1)),
                    ("rotate", ErrorParam::Number(*rotate as f64)),
                ],
            ),
            Error::UnsupportedUserUnit(page, unit) => (
                "unsupported_user_unit",
                vec![
                    ("page", number(page + 1)),
                    ("unit", ErrorParam::Number(*unit)),
                ],
            ),
            Error::DoesNotFit {
                needed_w_mm,
                needed_h_mm,
                page_w_mm,
                page_h_mm,
            } => (
                "does_not_fit",
                vec![
                    ("needed_w_mm", ErrorParam::Number(*needed_w_mm)),
                    ("needed_h_mm", ErrorParam::Number(*needed_h_mm)),
                    ("page_w_mm", ErrorParam::Number(*page_w_mm)),
                    ("page_h_mm", ErrorParam::Number(*page_h_mm)),
                ],
            ),
            Error::InvalidSheet(d) => ("invalid_sheet", vec![("detail", text(d))]),
            Error::Pdfium(d) => ("pdfium", vec![("detail", text(d))]),
            Error::Superseded => ("superseded", vec![]),
            Error::WorkerStopped => ("worker_stopped", vec![]),
            Error::NoDocument => ("no_document", vec![]),
            Error::Malformed(d) => ("malformed", vec![("detail", text(d))]),
            Error::NotAProject => ("not_a_project", vec![]),
            Error::ProjectTooNew { found, supported } => (
                "project_too_new",
                vec![
                    ("found", ErrorParam::Number(*found as f64)),
                    ("supported", ErrorParam::Number(*supported as f64)),
                ],
            ),
        };
        Self {
            code: code.into(),
            message: e.to_string(),
            params: params
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
        }
    }
}

impl From<Error> for ErrorInfo {
    fn from(e: Error) -> Self {
        Self::from(&e)
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        ErrorInfo::from(self).serialize(s)
    }
}
