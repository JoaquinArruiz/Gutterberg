//! "Sort pages with AI": label every page from small thumbnails (or, text only, from a description), in
//! batches, and check the answer covers exactly the pages that were asked about.

use crate::error::{AiError, Result};
use crate::provider::{AiRequest, Image};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

/// Pages per request: a 50-page PDF is three requests.
pub const BATCH: usize = 20;
const OUTPUT_TOKENS_PER_PAGE: u32 = 60;
/// Characters of a page's own text given to the model in text-only mode.
pub const TEXT_CHARS: usize = 400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Label {
    /// Pages of the pieces to cut out (fronts).
    Cards,
    /// Pages of card backs.
    Backs,
    /// Rules and instructions.
    Rules,
    Cover,
    /// Blank pages, adverts, anything else.
    Other,
}

impl Label {
    pub const ALL: [Label; 5] = [
        Label::Cards,
        Label::Backs,
        Label::Rules,
        Label::Cover,
        Label::Other,
    ];

    fn name(self) -> &'static str {
        match self {
            Label::Cards => "cards",
            Label::Backs => "backs",
            Label::Rules => "rules",
            Label::Cover => "cover",
            Label::Other => "other",
        }
    }

    /// Pages of these kinds have no pieces to print, so they start out skipped. Backs are pieces (for duplex).
    pub fn skipped_by_default(self) -> bool {
        matches!(self, Label::Rules | Label::Cover | Label::Other)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PageLabel {
    pub page_index: usize,
    pub label: Label,
    pub confidence: f64,
}

/// What the model is told about a page when no picture is sent.
#[derive(Debug, Clone, PartialEq)]
pub struct PageSummary {
    pub page_index: usize,
    pub width_mm: f64,
    pub height_mm: f64,
    pub images: usize,
    pub paths: usize,
    pub texts: usize,
    /// The start of the page's own text.
    pub text: String,
}

/// What the pages are sent as.
pub enum SortInput {
    /// One small picture per page, `(page_index, picture)`.
    Images(Vec<(usize, Image)>),
    Text(Vec<PageSummary>),
}

pub fn sort_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "pages": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "page": { "type": "integer" },
                        "label": { "type": "string", "enum": Label::ALL.map(Label::name) },
                        "confidence": { "type": "number" },
                    },
                    "required": ["page", "label", "confidence"],
                },
            },
        },
        "required": ["pages"],
    })
}

const RULES: &str = "Label each page of a print-and-play PDF: \"cards\" for pages of the pieces (cards, tokens, \
tiles) to cut out, \"backs\" for pages of their backs, \"rules\" for the rulebook or instructions, \"cover\" \
for a title, cover or credits page, \"other\" for blank pages, adverts or anything else. Answer once for every \
page listed, using the page numbers given, and give confidence from 0 to 1.";

/// One request per batch of pages, each with the page indexes (0-based) it covers.
pub fn sort_requests(input: SortInput) -> Vec<(AiRequest, Vec<usize>)> {
    match input {
        SortInput::Images(pages) => pages
            .chunks(BATCH)
            .map(|chunk| {
                let numbers: Vec<String> = chunk.iter().map(|(i, _)| (i + 1).to_string()).collect();
                let instruction = format!(
                    "The pictures are pages {} of a print-and-play PDF, in this order. {RULES}",
                    numbers.join(", ")
                );
                let indexes: Vec<usize> = chunk.iter().map(|(i, _)| *i).collect();
                (request(instruction, chunk.iter().map(|(_, img)| img.clone()).collect(), chunk.len()), indexes)
            })
            .collect(),
        SortInput::Text(pages) => pages
            .chunks(BATCH)
            .map(|chunk| {
                let described: Vec<String> = chunk
                    .iter()
                    .map(|p| {
                        let text: String = p.text.split_whitespace().collect::<Vec<_>>().join(" ");
                        let text: String = text.chars().take(TEXT_CHARS).collect();
                        format!(
                            "Page {}: {:.0} x {:.0} mm, {} images, {} drawn shapes, {} text runs. Text: \"{}\"",
                            p.page_index + 1,
                            p.width_mm,
                            p.height_mm,
                            p.images,
                            p.paths,
                            p.texts,
                            text,
                        )
                    })
                    .collect();
                let instruction = format!(
                    "You are given no pictures, only a description of each page.\n{}\n{RULES}",
                    described.join("\n")
                );
                let indexes: Vec<usize> = chunk.iter().map(|p| p.page_index).collect();
                (request(instruction, Vec::new(), chunk.len()), indexes)
            })
            .collect(),
    }
}

fn request(instruction: String, images: Vec<Image>, pages: usize) -> AiRequest {
    AiRequest {
        instruction,
        images,
        schema: sort_schema(),
        max_output_tokens: 256 + OUTPUT_TOKENS_PER_PAGE * pages as u32,
    }
}

/// The labels in a reply, which must name every page in `expected` (0-based) once and no other.
pub fn parse_sort(reply: &Value, expected: &[usize]) -> Result<Vec<PageLabel>> {
    let list = reply
        .get("pages")
        .and_then(Value::as_array)
        .ok_or_else(|| AiError::InvalidReply("`pages` is missing".into()))?;
    let wanted: HashSet<usize> = expected.iter().copied().collect();
    let mut seen: HashSet<usize> = HashSet::new();
    let mut labels = Vec::with_capacity(list.len());
    for item in list {
        let number = item
            .get("page")
            .and_then(Value::as_u64)
            .filter(|n| *n >= 1)
            .ok_or_else(|| AiError::InvalidReply("a page number is missing".into()))?;
        let page_index = (number - 1) as usize;
        if !wanted.contains(&page_index) {
            return Err(AiError::InvalidProposal(format!(
                "page {number} was not one of the pages sent"
            )));
        }
        if !seen.insert(page_index) {
            return Err(AiError::InvalidProposal(format!(
                "page {number} is labelled twice"
            )));
        }
        let label: Label = serde_json::from_value(
            item.get("label").cloned().unwrap_or(Value::Null),
        )
        .map_err(|_| AiError::InvalidReply(format!("page {number} has an unknown label")))?;
        let confidence = item
            .get("confidence")
            .and_then(Value::as_f64)
            .filter(|c| c.is_finite())
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);
        labels.push(PageLabel {
            page_index,
            label,
            confidence,
        });
    }
    if let Some(missing) = expected.iter().find(|i| !seen.contains(i)) {
        return Err(AiError::InvalidProposal(format!(
            "page {} has no label",
            missing + 1
        )));
    }
    labels.sort_by_key(|l| l.page_index);
    Ok(labels)
}
