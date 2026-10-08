//! Detecting where the pieces are on a page, locally: no network, no AI.
//!
//! ```text
//! page (pdfium) --read_page_data--> PageData { size, objects, grey }
//!      --> Detector engines, in order --> Proposal[] (best first)
//! ```
//!
//! Every engine implements [`Detector`], so another one (the optional AI engine) can be added to the
//! list without changing the command or the UI. The engines are pure functions of [`PageData`] and
//! work in PDF points with a top-left origin, in the page as displayed. A proposal is never applied
//! by this module: the UI shows it as a draft.

mod blobs;
mod edges;
mod objects;
pub mod read;

pub use blobs::BlobsEngine;
pub use edges::EdgesEngine;
pub use objects::ObjectsEngine;

use crate::card::OrientedRect;
use crate::geometry::{PageSize, Rect};
use crate::units::mm_to_pt;
use serde::{Deserialize, Serialize};

/// Smallest side of a piece (mm): anything smaller is art, not a piece.
pub const MIN_PIECE_MM: f64 = 15.0;
/// A candidate this large in both directions (share of the page) is the page, not a piece.
pub const PAGE_FRACTION: f64 = 0.6;
/// Positions closer than this (mm) are the same position.
pub const POSITION_TOLERANCE_MM: f64 = 0.3;
/// Sizes closer than this (mm) are the same size (as `sheet::SIZE_TOLERANCE_MM`).
pub const SIZE_TOLERANCE_MM: f64 = 0.5;
/// Proposals under this confidence are not offered.
pub const MIN_CONFIDENCE: f64 = 0.35;
/// From this confidence a proposal is "good"; between the two it is offered as low confidence.
pub const GOOD_CONFIDENCE: f64 = 0.7;
/// An engine result at or above this ends the search: the later engines are not run.
pub const STOP_CONFIDENCE: f64 = 0.85;
/// Inferred results (edges, blobs) never read as exact.
pub const INFERRED_CAP: f64 = 0.9;
/// The long side of the grey render the image engines work on.
pub const GREY_LONG_SIDE_PX: u32 = 1600;

pub(crate) fn min_piece_pt() -> f64 {
    mm_to_pt(MIN_PIECE_MM)
}

/// What a page object is, as far as detection cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjectKind {
    Image,
    /// A closed path of four right-angled corners, axis-aligned in the displayed page.
    Rect,
    /// A horizontal or vertical stroke: a cut line or a crop mark.
    Line,
}

/// A page object's box in the displayed page, points, top-left origin.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageObject {
    pub kind: ObjectKind,
    pub rect: Rect,
}

/// A low-resolution grey render of the page: 8-bit, row-major, white = 255.
#[derive(Debug, Clone, PartialEq)]
pub struct GreyImage {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
    /// Page points per pixel, horizontally and vertically.
    pub pt_per_px_x: f64,
    pub pt_per_px_y: f64,
}

impl GreyImage {
    pub fn at(&self, x: usize, y: usize) -> u8 {
        self.data[y * self.width + x]
    }
}

/// Everything the engines look at for one page.
#[derive(Debug, Clone, PartialEq)]
pub struct PageData {
    pub size: PageSize,
    pub objects: Vec<PageObject>,
    pub grey: Option<GreyImage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProposalKind {
    /// A regular grid. `bounds` is the outer box of all the pieces in points, gaps included.
    Grid {
        bounds: Rect,
        rows: usize,
        columns: usize,
        source_gap_x_mm: f64,
        source_gap_y_mm: f64,
    },
    /// One rectangle per piece, tilt included, in reading order.
    Rects { rects: Vec<OrientedRect> },
}

/// Something worth telling the user about a proposal; the UI words each code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Note {
    /// Some cells of the grid have no object (the last row is not full).
    MissingCells,
    /// Crop marks in the margins line up with the grid.
    CropMarks,
    /// Only two or three objects back the grid.
    FewObjects,
    /// The pieces differ in size.
    UnevenSizes,
    /// A piece touches the edge of the page.
    TouchesEdge,
    /// Only one piece was found.
    OnePiece,
    /// Pieces seem to touch or merge, so their outlines cannot be told apart. Only ever a reason.
    MergedPieces,
    /// The page has no regular pattern of borders. Only ever a reason.
    NoRegularPattern,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Proposal {
    #[serde(flatten)]
    pub kind: ProposalKind,
    /// 0 to 1.
    pub confidence: f64,
    /// Which engine made it: `pdf-objects`, `edges`, `blobs` (and later `ai`).
    pub engine: String,
    #[serde(default)]
    pub notes: Vec<Note>,
}

impl Proposal {
    /// The area the proposal covers, to rank equally confident ones: the larger first.
    pub fn coverage(&self) -> f64 {
        match &self.kind {
            ProposalKind::Grid { bounds, .. } => bounds.width * bounds.height,
            ProposalKind::Rects { rects } => rects.iter().map(|r| r.width * r.height).sum(),
        }
    }
}

/// What one engine found: proposals (of any confidence) and why it found less than it could have.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EngineResult {
    pub proposals: Vec<Proposal>,
    pub reasons: Vec<Note>,
}

/// One way of finding pieces. M19's AI engine implements this too.
pub trait Detector {
    fn engine(&self) -> &'static str;
    fn detect(&self, page: &PageData) -> EngineResult;
}

/// What a detection offers: proposals worth showing (best first) and, when there are none, the reasons.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Detection {
    pub proposals: Vec<Proposal>,
    pub reasons: Vec<Note>,
}

/// The engines in the order they are tried.
pub fn default_engines() -> Vec<Box<dyn Detector>> {
    vec![
        Box::new(ObjectsEngine),
        Box::new(EdgesEngine),
        Box::new(BlobsEngine),
    ]
}

/// Runs `engines` in order and keeps what is worth offering: proposals under [`MIN_CONFIDENCE`] are
/// dropped, the rest sorted by confidence (then by what they cover). The search ends as soon as a
/// proposal reaches [`STOP_CONFIDENCE`].
pub fn detect_page(page: &PageData, engines: &[Box<dyn Detector>]) -> Detection {
    let mut kept: Vec<Proposal> = Vec::new();
    let mut reasons: Vec<Note> = Vec::new();
    for engine in engines {
        let found = engine.detect(page);
        for r in found.reasons {
            if !reasons.contains(&r) {
                reasons.push(r);
            }
        }
        kept.extend(
            found
                .proposals
                .into_iter()
                .filter(|p| p.confidence >= MIN_CONFIDENCE),
        );
        if kept.iter().any(|p| p.confidence >= STOP_CONFIDENCE) {
            break;
        }
    }
    kept.sort_by(|a, b| {
        let key = |p: &Proposal| (p.confidence * 100.0).round();
        key(b)
            .total_cmp(&key(a))
            .then(b.coverage().total_cmp(&a.coverage()))
    });
    if !kept.is_empty() {
        reasons.clear();
    }
    Detection {
        proposals: kept,
        reasons,
    }
}

/// Positions merged into clusters: sorted values within `tolerance` of the previous one share a cluster.
/// Returns each cluster's mean and member count.
pub(crate) fn cluster(values: &[f64], tolerance: f64) -> Vec<(f64, usize)> {
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let mut out: Vec<(f64, f64, usize)> = Vec::new(); // (sum, last, count)
    for v in sorted {
        match out.last_mut() {
            Some(c) if v - c.1 <= tolerance => {
                c.0 += v;
                c.1 = v;
                c.2 += 1;
            }
            _ => out.push((v, v, 1)),
        }
    }
    out.into_iter()
        .map(|(sum, _, n)| (sum / n as f64, n))
        .collect()
}
