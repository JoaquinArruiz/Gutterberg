//! From a project to the request the print planner takes.
//!
//! ```text
//! project body (the UI's shape) --print_request--> PrintRequest --plan_and_finish / plan_print_files--> sheets
//! ```
//!
//! A project file holds what the user chose, in the UI's own shape (camelCase, normalized coordinates, piece keys
//! such as `g:0:1:2:3`): page groups, freeform pieces, piece edits, the plan and the output settings. This module
//! reads those parts and turns them into the planner's input, so the app's preview, its export and the command line
//! all build the request in one place.
//!
//! The values are pulled back into what the UI allows, as the app does when it opens a project, so a hand-edited
//! file gives the same sheets in the app and from the command line.

use crate::card::{CardId, DocumentId, OrientedRect, PageGroup, PageGroupKind, PageRange};
use crate::error::{Error, ErrorInfo, ErrorParam, Result};
use crate::export::{export_sheets_files, plan_print_files, PageIssue, SourceFile};
use crate::finish::{
    parse_color, BackLayout, BackPair, BackgroundOptions, BleedOptions, BleedSource, DuplexOptions,
    EdgeColor, FinishOptions, Finishing, Flip, MarkLine, MarkOptions, MarkStyle, MAX_BLEED_MM,
    MAX_DUPLEX_OFFSET_MM, MAX_FOLD_GAP_MM,
};
use crate::geometry::{PageSize, Point, Rect};
use crate::layout::GridLayout;
use crate::sheet::{
    extract_all_cards, Card, CardSetting, DocumentSource, FoldAxis, Margins, Order, OutputSheet,
    PaginateOptions, PrintLayout, SheetPage, SheetSpec, Turn,
};
use crate::units::mm_to_pt;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

/// A piece can be printed from a tenth of its size up to five times it (`clampScale` in the UI).
pub const MIN_SCALE: f64 = 0.1;
pub const MAX_SCALE: f64 = 5.0;
/// Copies of one piece the plan can ask for.
pub const MAX_QUANTITY: usize = 99;
/// Rows or columns of a custom sheet grid.
pub const MAX_SHEET_GRID: usize = 30;
pub const MAX_GAP_MM: f64 = 50.0;
pub const MAX_MARGIN_MM: f64 = 100.0;
const MARK_WIDTH_RANGE: (f64, f64) = (0.05, 2.0);
const MARK_LENGTH_RANGE: (f64, f64) = (1.0, 10.0);
const MARK_OFFSET_RANGE: (f64, f64) = (0.0, 10.0);

// ---------------------------------------------------------------------------------------------
// The project, as the UI saves it
// ---------------------------------------------------------------------------------------------

/// The parts of a project the print request is built from. Other keys (the viewed page, grid names, the images
/// of an images document...) are left alone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintProject {
    pub documents: Vec<ProjectDocument>,
    pub output: OutputSettings,
    pub edits: PieceEdits,
    pub plan: PrintPlan,
}

/// What a document is made of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentKind {
    #[default]
    Pdf,
    /// Its pages are images (one piece each), so "same as source" cannot print it.
    Images,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDocument {
    pub id: DocumentId,
    #[serde(default)]
    pub kind: DocumentKind,
    pub groups: Vec<ProjectGroup>,
    /// The freeform pieces of each page (keyed by the page index, as JSON keys are strings), normalized.
    #[serde(default)]
    pub freeform: BTreeMap<String, Vec<OrientedRect>>,
}

impl ProjectDocument {
    /// The freeform pieces of `page`, if it has any.
    fn freeform_on(&self, page: usize) -> Option<&[OrientedRect]> {
        self.freeform
            .iter()
            .find(|(k, _)| k.parse::<usize>().ok() == Some(page))
            .map(|(_, cards)| cards.as_slice())
            .filter(|cards| !cards.is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProjectGroup {
    Grid {
        pages: PageRange,
        grids: Vec<GridRegion>,
    },
    Skip {
        pages: PageRange,
    },
}

/// One grid of a page group: how it divides its region, and the region (normalized), if one is drawn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridRegion {
    pub grid: GroupGrid,
    pub selection: Option<Rect>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupGrid {
    pub rows: usize,
    pub columns: usize,
    pub source_gap_x_mm: f64,
    pub source_gap_y_mm: f64,
    #[serde(default)]
    pub source_gap_linked: bool,
}

/// The sheet size the user chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PageMode {
    Same,
    A3,
    A4,
    A5,
    Letter,
    Legal,
    Tabloid,
    Custom,
    Fit,
}

impl PageMode {
    /// The paper size (mm, portrait) of a preset.
    fn preset_mm(self) -> Option<(f64, f64)> {
        Some(match self {
            PageMode::A3 => (297.0, 420.0),
            PageMode::A4 => (210.0, 297.0),
            PageMode::A5 => (148.0, 210.0),
            PageMode::Letter => (215.9, 279.4),
            PageMode::Legal => (215.9, 355.6),
            PageMode::Tabloid => (279.4, 431.8),
            PageMode::Same | PageMode::Custom | PageMode::Fit => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Orientation {
    Portrait,
    Landscape,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ProjectMargins {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

/// The output settings: gaps between pieces, the sheet and its margins.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputSettings {
    pub gap_x_mm: f64,
    pub gap_y_mm: f64,
    #[serde(default)]
    pub gap_linked: bool,
    pub page_mode: PageMode,
    pub orientation: Orientation,
    pub custom_width_mm: f64,
    pub custom_height_mm: f64,
    pub margins: ProjectMargins,
}

/// What the user decided about single pieces, keyed by piece key (`g:doc:page:row:column[:grid]`, `f:doc:page:i`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PieceEdits {
    #[serde(default)]
    pub turns: BTreeMap<String, Turn>,
    #[serde(default)]
    pub scales: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scales_y: Option<BTreeMap<String, f64>>,
    /// The library order. Empty = page order; pieces it does not list follow, in page order.
    #[serde(default)]
    pub order: Vec<String>,
    #[serde(default)]
    pub backs: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanMode {
    /// Every piece once, in order.
    All,
    /// Only the pieces given a quantity.
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SheetGridMode {
    /// Each source page keeps its own grid.
    Same,
    /// As many per sheet as fit.
    Auto,
    /// Rows x columns.
    Custom,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintPlan {
    pub mode: PlanMode,
    #[serde(default)]
    pub quantities: BTreeMap<String, f64>,
    pub auto_fill: bool,
    pub order: Order,
    pub group_by_size: bool,
    pub sheet_grid: SheetGridMode,
    pub rows: usize,
    pub columns: usize,
    pub finish: Finish,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finish {
    pub marks: FinishMarks,
    pub bleed: FinishBleed,
    pub duplex: FinishDuplex,
    #[serde(default)]
    pub background: BackgroundOptions,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FinishBleed {
    pub mm: f64,
    pub source: BleedSource,
    /// The `Edge` bleed's colour of each piece (by key), `#rrggbb`, as the app found it.
    pub edge_colors: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishMarks {
    pub style: MarkStyle,
    #[serde(default)]
    pub line: MarkLine,
    pub width_mm: f64,
    pub color: String,
    pub length_mm: f64,
    pub offset_mm: f64,
    #[serde(default)]
    pub on_backs: bool,
    #[serde(default)]
    pub inner_crosses: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishDuplex {
    pub on: bool,
    #[serde(default)]
    pub layout: BackLayout,
    #[serde(default)]
    pub fold: FoldAxis,
    #[serde(default)]
    pub fold_gap_mm: f64,
    #[serde(default)]
    pub cut_apart: bool,
    #[serde(default)]
    pub back_upside_down: Option<bool>,
    pub flip: Flip,
    pub offset_x_mm: f64,
    pub offset_y_mm: f64,
    pub common_back: Option<String>,
}

/// Reads the parts of a project body (already checked and migrated by `project::parse_project`) that printing
/// needs.
pub fn print_project(body: &crate::project::Body) -> Result<PrintProject> {
    serde_json::from_value(serde_json::Value::Object(body.clone()))
        .map_err(|e| Error::Malformed(format!("the project cannot be printed: {e}")))
}

// ---------------------------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------------------------

/// One document as the export reads it: which PDF, and where its pieces are.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocumentGroups {
    pub document_id: DocumentId,
    pub groups: Vec<PageGroup>,
}

/// Everything the planner takes for one print.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PrintRequest {
    pub documents: Vec<DocumentGroups>,
    pub settings: Vec<CardSetting>,
    pub layout: PrintLayout,
    pub options: PaginateOptions,
    pub finishing: Finishing,
}

impl PrintRequest {
    /// The documents with their page sizes, as the preview plans from them.
    pub fn sources(&self, pages: &HashMap<DocumentId, Vec<PageSize>>) -> Vec<DocumentSource> {
        self.documents
            .iter()
            .map(|d| DocumentSource {
                document_id: d.document_id,
                pages: pages.get(&d.document_id).cloned().unwrap_or_default(),
                groups: d.groups.clone(),
            })
            .collect()
    }
}

/// The key a piece is filed under in the project (`cardIdKey` in the UI).
pub fn piece_key(id: &CardId) -> String {
    match *id {
        CardId::Grid {
            document_id,
            page_index,
            grid,
            row,
            column,
        } => {
            let grid = if grid > 0 {
                format!(":{grid}")
            } else {
                String::new()
            };
            format!("g:{document_id}:{page_index}:{row}:{column}{grid}")
        }
        CardId::Freeform {
            document_id,
            page_index,
            index,
        } => format!("f:{document_id}:{page_index}:{index}"),
    }
}

/// The piece a key stands for, or `None` when it is not a piece key.
pub fn parse_piece_key(key: &str) -> Option<CardId> {
    let (kind, rest) = key.split_once(':')?;
    let n: Vec<usize> = rest
        .split(':')
        .map(|p| {
            (!p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
                .then(|| p.parse().ok())
                .flatten()
        })
        .collect::<Option<_>>()?;
    let document_id = DocumentId::try_from(*n.first()?).ok()?;
    match (kind, n.as_slice()) {
        ("g", &[_, page_index, row, column]) => Some(CardId::Grid {
            document_id,
            page_index,
            grid: 0,
            row,
            column,
        }),
        ("g", &[_, page_index, row, column, grid]) if grid > 0 => Some(CardId::Grid {
            document_id,
            page_index,
            grid,
            row,
            column,
        }),
        ("f", &[_, page_index, index]) => Some(CardId::Freeform {
            document_id,
            page_index,
            index,
        }),
        _ => None,
    }
}

fn is_piece_key(key: &str) -> bool {
    parse_piece_key(key).is_some_and(|id| piece_key(&id) == key)
}

fn clamp_to(v: f64, lo: f64, hi: f64, fallback: f64) -> f64 {
    if v.is_finite() {
        v.clamp(lo, hi)
    } else {
        fallback
    }
}

fn clamp_scale(s: f64) -> f64 {
    clamp_to(s, MIN_SCALE, MAX_SCALE, 1.0)
}

fn clamp_quantity(n: f64) -> usize {
    clamp_to(n.round(), 0.0, MAX_QUANTITY as f64, 0.0) as usize
}

fn is_one(s: f64) -> bool {
    (s - 1.0).abs() < 1e-6
}

/// The project's values pulled back into what the UI allows, as the app does when it opens a project.
fn cleaned(project: &PrintProject) -> PrintProject {
    let mut p = project.clone();
    let o = &mut p.output;
    let gap = |mm: f64| mm.clamp(0.0, MAX_GAP_MM);
    let margin = |mm: f64| mm.clamp(0.0, MAX_MARGIN_MM);
    o.gap_x_mm = gap(o.gap_x_mm);
    o.gap_y_mm = if o.gap_linked {
        o.gap_x_mm
    } else {
        gap(o.gap_y_mm)
    };
    o.custom_width_mm = o.custom_width_mm.max(10.0);
    o.custom_height_mm = o.custom_height_mm.max(10.0);
    o.margins = ProjectMargins {
        top: margin(o.margins.top),
        right: margin(o.margins.right),
        bottom: margin(o.margins.bottom),
        left: margin(o.margins.left),
    };

    let e = &mut p.edits;
    e.turns.retain(|k, _| is_piece_key(k));
    e.scales.retain(|k, _| is_piece_key(k));
    e.scales.values_mut().for_each(|s| *s = clamp_scale(*s));
    if let Some(y) = &mut e.scales_y {
        y.retain(|k, _| is_piece_key(k));
        y.values_mut().for_each(|s| *s = clamp_scale(*s));
    }
    if e.scales_y.as_ref().is_some_and(BTreeMap::is_empty) {
        e.scales_y = None;
    }
    e.order.retain(|k| is_piece_key(k));
    e.backs
        .retain(|k, v| is_piece_key(k) && is_piece_key(v) && k != v);

    let plan = &mut p.plan;
    plan.quantities = plan
        .quantities
        .iter()
        .map(|(k, n)| (k.clone(), clamp_quantity(*n) as f64))
        .filter(|(_, n)| *n > 0.0)
        .collect();
    plan.rows = plan.rows.clamp(1, MAX_SHEET_GRID);
    plan.columns = plan.columns.clamp(1, MAX_SHEET_GRID);
    p
}

/// The sheet a preset, custom size or the source's size gives (`outputPage` in the UI), in points.
fn output_page(o: &OutputSettings) -> Option<PageSize> {
    let (w, h) = match o.page_mode {
        PageMode::Custom => (o.custom_width_mm, o.custom_height_mm),
        mode => mode.preset_mm()?,
    };
    let (w, h) = match o.orientation {
        Orientation::Landscape => (h, w),
        Orientation::Portrait => (w, h),
    };
    Some(PageSize {
        width_pt: mm_to_pt(w),
        height_pt: mm_to_pt(h),
    })
}

/// A grid and its region plus the output settings, as the layout engine takes them.
fn grid_layout(bounds: Rect, grid: &GroupGrid, o: &OutputSettings) -> GridLayout {
    GridLayout {
        bounds,
        rows: grid.rows,
        columns: grid.columns,
        source_gap_x_mm: grid.source_gap_x_mm,
        source_gap_y_mm: grid.source_gap_y_mm,
        gap_x_mm: o.gap_x_mm,
        gap_y_mm: o.gap_y_mm,
        margin_top_mm: o.margins.top,
        margin_right_mm: o.margins.right,
        margin_bottom_mm: o.margins.bottom,
        margin_left_mm: o.margins.left,
        output_page: output_page(o),
        fit_page: o.page_mode == PageMode::Fit,
    }
}

fn oriented_to_points(r: &OrientedRect, page: PageSize) -> OrientedRect {
    OrientedRect {
        center: Point {
            x: r.center.x * page.width_pt,
            y: r.center.y * page.height_pt,
        },
        width: r.width * page.width_pt,
        height: r.height * page.height_pt,
        angle_deg: r.angle_deg,
    }
}

/// A document's page groups in the planner's shape. Grid groups with no region drawn yet have no pieces and are
/// left out; in the others a grid with no region is `None`, so the grids after it keep their numbers. A page's
/// freeform pieces become a one-page freeform group right after that page's grid pieces, so the pieces come out in
/// page order. `pages` (points) place the freeform pieces; a page without a size has none.
pub fn page_groups(
    document: &ProjectDocument,
    pages: &[PageSize],
    output: &OutputSettings,
) -> Vec<PageGroup> {
    let mut out = Vec::new();
    for g in &document.groups {
        let (range, grids) = match g {
            ProjectGroup::Skip { pages } => {
                out.push(PageGroup {
                    pages: *pages,
                    kind: PageGroupKind::Skip,
                });
                continue;
            }
            ProjectGroup::Grid { pages, grids } => {
                let drawn = grids.iter().any(|r| r.selection.is_some());
                let grids = drawn.then(|| {
                    grids
                        .iter()
                        .map(|r| r.selection.map(|s| grid_layout(s, &r.grid, output)))
                        .collect::<Vec<_>>()
                });
                (*pages, grids)
            }
        };
        let mut start = range.first;
        let flush = |out: &mut Vec<PageGroup>, start: usize, end: usize| {
            if let Some(grids) = &grids {
                if end >= start {
                    out.push(PageGroup {
                        pages: PageRange {
                            first: start,
                            last: end,
                        },
                        kind: PageGroupKind::Grid {
                            grids: grids.clone(),
                        },
                    });
                }
            }
        };
        for p in range.first..=range.last {
            let (Some(own), Some(&size)) = (document.freeform_on(p), pages.get(p)) else {
                continue;
            };
            flush(&mut out, start, p);
            out.push(PageGroup {
                pages: PageRange { first: p, last: p },
                kind: PageGroupKind::Freeform {
                    cards: own.iter().map(|c| oriented_to_points(c, size)).collect(),
                },
            });
            start = p + 1;
        }
        // A group ending before it starts is a damaged file; the planner reports its range.
        if range.last >= range.first {
            flush(&mut out, start, range.last);
        }
    }
    out
}

/// The documents with their pieces in the planner's shape and their page sizes: what the piece library is
/// extracted from (see [`page_groups`]).
pub fn document_sources(
    documents: &[ProjectDocument],
    output: &OutputSettings,
    pages: &HashMap<DocumentId, Vec<PageSize>>,
) -> Vec<DocumentSource> {
    let no_pages = Vec::new();
    documents
        .iter()
        .map(|d| {
            let sizes = pages.get(&d.id).unwrap_or(&no_pages);
            DocumentSource {
                document_id: d.id,
                pages: sizes.clone(),
                groups: page_groups(d, sizes, output),
            }
        })
        .collect()
}

/// The pieces as the library shows and the planner prints them: in the user's order, with turn and scale applied.
pub fn apply_edits(cards: &[Card], edits: &PieceEdits) -> Vec<Card> {
    let merged: Vec<Card> = cards
        .iter()
        .map(|c| {
            let k = piece_key(&c.id);
            Card {
                turn: edits.turns.get(&k).copied().unwrap_or(c.turn),
                scale: edits.scales.get(&k).copied().unwrap_or(c.scale),
                scale_y: edits
                    .scales_y
                    .as_ref()
                    .and_then(|y| y.get(&k).copied())
                    .or(c.scale_y),
                ..*c
            }
        })
        .collect();
    if edits.order.is_empty() {
        return merged;
    }
    let rank: HashMap<&str, usize> = edits
        .order
        .iter()
        .enumerate()
        .map(|(i, k)| (k.as_str(), i))
        .collect();
    let keyed: Vec<(Option<usize>, Card)> = merged
        .into_iter()
        .map(|c| (rank.get(piece_key(&c.id).as_str()).copied(), c))
        .collect();
    let mut listed: Vec<(usize, Card)> = keyed
        .iter()
        .filter_map(|(r, c)| r.map(|r| (r, *c)))
        .collect();
    // Stable, as the UI's sort is.
    listed.sort_by_key(|(r, _)| *r);
    listed
        .into_iter()
        .map(|(_, c)| c)
        .chain(keyed.iter().filter(|(r, _)| r.is_none()).map(|(_, c)| *c))
        .collect()
}

/// Whether any piece is turned, scaled or moved from its page position: such plans cannot use "same as source".
pub fn has_edits(cards: &[Card], edits: &PieceEdits) -> bool {
    let changed = cards.iter().any(|c| {
        let k = piece_key(&c.id);
        edits.turns.get(&k).is_some_and(|t| *t != Turn::R0)
            || !is_one(edits.scales.get(&k).copied().unwrap_or(1.0))
            || edits.scales_y.as_ref().is_some_and(|y| y.contains_key(&k))
    });
    changed
        || apply_edits(cards, edits)
            .iter()
            .zip(cards)
            .any(|(a, b)| a.id != b.id)
}

/// The sheet grid the plan really uses. "Same as source" is the default plan only (every piece once, in order,
/// each source page on its own sheet), so any other plan falls back to Auto. `planner` is true when pieces are
/// freeform, turned, resized, reordered, from images, or printed gutterfold.
pub fn effective_grid(plan: &PrintPlan, planner: bool) -> SheetGridMode {
    if plan.sheet_grid == SheetGridMode::Same
        && (plan.mode != PlanMode::All || plan.auto_fill || planner)
    {
        SheetGridMode::Auto
    } else {
        plan.sheet_grid
    }
}

fn sheet_page(o: &OutputSettings) -> SheetPage {
    match o.page_mode {
        PageMode::Same => SheetPage::SameAsSource,
        PageMode::Fit => SheetPage::Fit,
        _ => output_page(o).map_or(SheetPage::SameAsSource, SheetPage::Size),
    }
}

/// The finishing for a request. `known` are the keys of the pieces that exist: a back that names a piece that is
/// gone is left out rather than failing the plan. A back turned in the library is turned that much more on the
/// sheet, so it faces like its front.
fn finishing(finish: &Finish, edits: &PieceEdits, known: &HashSet<String>) -> Finishing {
    let m = &finish.marks;
    let d = &finish.duplex;
    let is_color = |c: &str| {
        c.len() == 7 && c.starts_with('#') && c[1..].bytes().all(|b| b.is_ascii_hexdigit())
    };
    let color_ok = is_color(&m.color);
    // A colour that is not `#rrggbb` paints nothing rather than failing the plan.
    let fill = |c: &Option<String>| c.as_deref().filter(|c| is_color(c)).map(str::to_lowercase);
    let defaults = MarkOptions::default();
    let turn_of = |k: &str| edits.turns.get(k).copied().unwrap_or_default();
    let common = d
        .common_back
        .as_deref()
        .filter(|k| is_piece_key(k) && known.contains(*k));
    let backs = edits
        .backs
        .iter()
        .filter(|(card, back)| known.contains(*card) && known.contains(*back))
        .filter_map(|(card, back)| {
            Some(BackPair {
                card: parse_piece_key(card)?,
                back: parse_piece_key(back)?,
                turn: turn_of(back),
            })
        })
        .collect();
    let edge_colors = finish
        .bleed
        .edge_colors
        .iter()
        .filter(|(k, _)| known.contains(*k))
        .filter_map(|(k, c)| {
            Some(EdgeColor {
                card: parse_piece_key(k)?,
                color: parse_color(fill(&Some(c.clone()))?.as_str()).ok()?,
            })
        })
        .collect();
    Finishing {
        edge_colors,
        options: FinishOptions {
            marks: MarkOptions {
                style: m.style,
                line: m.line,
                width_mm: clamp_to(
                    m.width_mm,
                    MARK_WIDTH_RANGE.0,
                    MARK_WIDTH_RANGE.1,
                    defaults.width_mm,
                ),
                color: if color_ok {
                    m.color.to_lowercase()
                } else {
                    defaults.color
                },
                length_mm: clamp_to(
                    m.length_mm,
                    MARK_LENGTH_RANGE.0,
                    MARK_LENGTH_RANGE.1,
                    defaults.length_mm,
                ),
                offset_mm: clamp_to(
                    m.offset_mm,
                    MARK_OFFSET_RANGE.0,
                    MARK_OFFSET_RANGE.1,
                    defaults.offset_mm,
                ),
                on_backs: m.on_backs,
                inner_crosses: m.inner_crosses,
            },
            bleed: BleedOptions {
                mm: clamp_to(finish.bleed.mm, 0.0, MAX_BLEED_MM, 0.0),
                source: finish.bleed.source,
            },
            duplex: DuplexOptions {
                on: d.on,
                layout: d.layout,
                fold: d.fold,
                fold_gap_mm: clamp_to(d.fold_gap_mm, 0.0, MAX_FOLD_GAP_MM, 0.0),
                cut_apart: d.cut_apart,
                back_upside_down: d.back_upside_down,
                flip: d.flip,
                offset_x_mm: clamp_to(
                    d.offset_x_mm,
                    -MAX_DUPLEX_OFFSET_MM,
                    MAX_DUPLEX_OFFSET_MM,
                    0.0,
                ),
                offset_y_mm: clamp_to(
                    d.offset_y_mm,
                    -MAX_DUPLEX_OFFSET_MM,
                    MAX_DUPLEX_OFFSET_MM,
                    0.0,
                ),
                common_back: common.and_then(parse_piece_key),
                common_back_turn: common.map(turn_of).unwrap_or_default(),
            },
            background: BackgroundOptions {
                sheet: fill(&finish.background.sheet),
                pieces: fill(&finish.background.pieces),
            },
        },
        backs,
    }
}

/// The request the planner takes for `project`. `pages` are the page sizes of each document (points), from the
/// files or as the app shows them; they place the freeform pieces and give the pieces the edits apply to.
pub fn print_request(
    project: &PrintProject,
    pages: &HashMap<DocumentId, Vec<PageSize>>,
) -> Result<PrintRequest> {
    let p = cleaned(project);
    let no_pages = Vec::new();
    let documents: Vec<DocumentGroups> = p
        .documents
        .iter()
        .map(|d| DocumentGroups {
            document_id: d.id,
            groups: page_groups(d, pages.get(&d.id).unwrap_or(&no_pages), &p.output),
        })
        .collect();
    let request = PrintRequest {
        documents,
        settings: Vec::new(),
        layout: PrintLayout::SameAsSource,
        options: PaginateOptions::default(),
        finishing: Finishing::default(),
    };
    // The pieces in page order, one document after the other: what the edits apply to.
    let cards = extract_all_cards(&request.sources(pages))?;
    let edited = has_edits(&cards, &p.edits);
    let images: HashSet<DocumentId> = p
        .documents
        .iter()
        .filter(|d| d.kind == DocumentKind::Images)
        .map(|d| d.id)
        .collect();
    let gutterfold =
        p.plan.finish.duplex.on && p.plan.finish.duplex.layout == BackLayout::Gutterfold;
    let planner = edited
        || gutterfold
        || cards.iter().any(|c| {
            matches!(c.id, CardId::Freeform { .. }) || images.contains(&c.id.document_id())
        });
    let grid = effective_grid(&p.plan, planner);
    let layout = match grid {
        SheetGridMode::Same => PrintLayout::SameAsSource,
        _ => {
            let custom = grid == SheetGridMode::Custom;
            PrintLayout::Grid {
                spec: SheetSpec {
                    page: sheet_page(&p.output),
                    rows: custom.then_some(p.plan.rows),
                    columns: custom.then_some(p.plan.columns),
                    gap_x_mm: p.output.gap_x_mm,
                    gap_y_mm: p.output.gap_y_mm,
                    margins: Margins {
                        top_mm: p.output.margins.top,
                        right_mm: p.output.margins.right,
                        bottom_mm: p.output.margins.bottom,
                        left_mm: p.output.margins.left,
                    },
                },
            }
        }
    };
    // In "all pieces" mode no settings, unless pieces are turned, resized or reordered: then every piece once.
    let settings = if p.plan.mode == PlanMode::All && !edited {
        Vec::new()
    } else {
        apply_edits(&cards, &p.edits)
            .iter()
            .map(|c| CardSetting {
                id: c.id,
                quantity: match p.plan.mode {
                    PlanMode::All => 1,
                    PlanMode::Custom => p
                        .plan
                        .quantities
                        .get(&piece_key(&c.id))
                        .map_or(0, |n| *n as usize),
                },
                turn: c.turn,
                scale: c.scale,
                scale_y: c.scale_y,
            })
            .collect()
    };
    let known: HashSet<String> = cards.iter().map(|c| piece_key(&c.id)).collect();
    Ok(PrintRequest {
        settings,
        layout,
        options: PaginateOptions {
            order: p.plan.order,
            group_by_size: p.plan.group_by_size,
            auto_fill: p.plan.auto_fill,
            fold: None,
        },
        finishing: finishing(&p.plan.finish, &p.edits, &known),
        ..request
    })
}

// ---------------------------------------------------------------------------------------------
// Planning and exporting from the files
// ---------------------------------------------------------------------------------------------

/// Plans the request's sheets from the PDFs at `files` (one per document of the request, in its order) and lists
/// the pages that would make the export fail: what the app's check before export and the command line's `check`
/// run.
pub fn plan_files(
    req: &PrintRequest,
    files: &[(DocumentId, &Path)],
) -> Result<(Vec<OutputSheet>, Vec<PageIssue>)> {
    let sources: Vec<SourceFile> = req
        .documents
        .iter()
        .zip(files)
        .map(|(d, (id, path))| SourceFile {
            document_id: *id,
            path,
            groups: &d.groups,
        })
        .collect();
    plan_print_files(
        &sources,
        &req.settings,
        &req.layout,
        &req.options,
        &req.finishing,
    )
}

/// Exports the request from the PDFs at `files` to `output`, after the same check as [`plan_files`]: the first
/// page that cannot be exported is the error, with its own code and the page (`at_page`). Returns the number of
/// sheets written.
pub fn export_files(
    req: &PrintRequest,
    files: &[(DocumentId, &Path)],
    output: &Path,
) -> std::result::Result<usize, ErrorInfo> {
    let (sheets, issues) = plan_files(req, files)?;
    if let Some(first) = issues.into_iter().next() {
        let mut info = ErrorInfo::new(&first.code, &first.message);
        info.params = first.params;
        info.message = format!("page {}: {}", first.page_index + 1, first.message);
        info.params.insert(
            "at_page".into(),
            ErrorParam::Number((first.page_index + 1) as f64),
        );
        return Err(info);
    }
    if sheets.is_empty() {
        return Err(ErrorInfo::new(
            "nothing_to_print",
            "there is nothing to print",
        ));
    }
    export_sheets_files(files, output, &sheets)?;
    Ok(sheets.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn piece_keys_read_back() {
        for key in ["g:0:1:2:3", "g:2:0:1:1:4", "f:1:3:0"] {
            assert_eq!(piece_key(&parse_piece_key(key).unwrap()), key);
        }
        for bad in [
            "g:0:1:2",
            "g:0:1:2:3:0",
            "f:1:a:0",
            "x:0:0:0",
            "g:0:1:2:3:",
            "g:-1:0:0:0",
        ] {
            assert!(!is_piece_key(bad), "{bad}");
        }
    }

    #[test]
    fn landscape_presets_swap_sides() {
        let o = OutputSettings {
            gap_x_mm: 0.0,
            gap_y_mm: 0.0,
            gap_linked: true,
            page_mode: PageMode::A4,
            orientation: Orientation::Landscape,
            custom_width_mm: 100.0,
            custom_height_mm: 100.0,
            margins: ProjectMargins {
                top: 0.0,
                right: 0.0,
                bottom: 0.0,
                left: 0.0,
            },
        };
        let page = output_page(&o).unwrap();
        assert!((page.width_pt - mm_to_pt(297.0)).abs() < 1e-9);
        assert!((page.height_pt - mm_to_pt(210.0)).abs() < 1e-9);
    }

    fn output() -> OutputSettings {
        OutputSettings {
            gap_x_mm: 3.0,
            gap_y_mm: 4.0,
            gap_linked: false,
            page_mode: PageMode::Same,
            orientation: Orientation::Portrait,
            custom_width_mm: 210.0,
            custom_height_mm: 297.0,
            margins: ProjectMargins {
                top: 1.0,
                right: 2.0,
                bottom: 3.0,
                left: 4.0,
            },
        }
    }

    const PAGE: PageSize = PageSize {
        width_pt: 595.0,
        height_pt: 842.0,
    };

    /// Page 0 skipped, pages 1-2 one grid group (drawn or not), with freeform pieces on `freeform` pages.
    fn document(drawn: bool, freeform: &[usize]) -> ProjectDocument {
        let piece = OrientedRect {
            center: Point { x: 0.5, y: 0.5 },
            width: 0.1,
            height: 0.2,
            angle_deg: 5.0,
        };
        ProjectDocument {
            id: 0,
            kind: DocumentKind::Pdf,
            groups: vec![
                ProjectGroup::Skip {
                    pages: PageRange { first: 0, last: 0 },
                },
                ProjectGroup::Grid {
                    pages: PageRange { first: 1, last: 2 },
                    grids: vec![GridRegion {
                        grid: GroupGrid {
                            rows: 1,
                            columns: 3,
                            source_gap_x_mm: 0.0,
                            source_gap_y_mm: 0.0,
                            source_gap_linked: true,
                        },
                        selection: drawn.then(|| Rect::new(0.1, 0.1, 0.8, 0.8)),
                    }],
                },
            ],
            freeform: freeform
                .iter()
                .map(|p| (p.to_string(), vec![piece]))
                .collect(),
        }
    }

    fn shape(groups: &[PageGroup]) -> Vec<(&'static str, usize, usize)> {
        groups
            .iter()
            .map(|g| {
                let kind = match g.kind {
                    PageGroupKind::Grid { .. } => "grid",
                    PageGroupKind::Skip => "skip",
                    PageGroupKind::Freeform { .. } => "freeform",
                };
                (kind, g.pages.first, g.pages.last)
            })
            .collect()
    }

    #[test]
    fn grids_get_the_output_settings_and_groups_with_no_region_are_left_out() {
        let groups = page_groups(&document(true, &[]), &[PAGE; 3], &output());
        assert_eq!(shape(&groups), [("skip", 0, 0), ("grid", 1, 2)]);
        let PageGroupKind::Grid { grids } = &groups[1].kind else {
            panic!("not a grid")
        };
        assert_eq!(grids[0].unwrap().gap_y_mm, 4.0);
        assert_eq!(grids[0].unwrap().margin_left_mm, 4.0);
        let none = page_groups(&document(false, &[]), &[PAGE; 3], &output());
        assert_eq!(shape(&none), [("skip", 0, 0)]);
    }

    #[test]
    fn freeform_pieces_come_right_after_their_page_grid_pieces_in_points() {
        let groups = page_groups(&document(true, &[2, 1]), &[PAGE; 3], &output());
        assert_eq!(
            shape(&groups),
            [
                ("skip", 0, 0),
                ("grid", 1, 1),
                ("freeform", 1, 1),
                ("grid", 2, 2),
                ("freeform", 2, 2),
            ]
        );
        let PageGroupKind::Freeform { cards } = &groups[2].kind else {
            panic!("not freeform")
        };
        assert_eq!(cards[0].center, Point { x: 297.5, y: 421.0 });
        assert!((cards[0].width - 59.5).abs() < 1e-9 && (cards[0].height - 168.4).abs() < 1e-9);
        assert_eq!(cards[0].angle_deg, 5.0);
    }

    #[test]
    fn freeform_pieces_of_a_page_with_no_region_stay_and_those_of_a_skipped_page_go() {
        let groups = page_groups(&document(false, &[0, 2]), &[PAGE; 3], &output());
        assert_eq!(shape(&groups), [("skip", 0, 0), ("freeform", 2, 2)]);
        // A page whose size is not known has no freeform pieces.
        let groups = page_groups(&document(false, &[2]), &[PAGE; 2], &output());
        assert_eq!(shape(&groups), [("skip", 0, 0)]);
    }

    fn finish() -> Finish {
        Finish {
            marks: FinishMarks {
                style: MarkStyle::Gaps,
                line: MarkLine::Dashed,
                width_mm: 0.5,
                color: "#FF0000".into(),
                length_mm: 4.0,
                offset_mm: 2.0,
                on_backs: true,
                inner_crosses: false,
            },
            bleed: FinishBleed::default(),
            duplex: FinishDuplex {
                on: true,
                layout: BackLayout::Duplex,
                fold: FoldAxis::Vertical,
                fold_gap_mm: 0.0,
                cut_apart: false,
                back_upside_down: None,
                flip: Flip::Long,
                offset_x_mm: 1.0,
                offset_y_mm: -1.0,
                common_back: Some("g:0:0:1:0".into()),
            },
            background: BackgroundOptions::default(),
        }
    }

    #[test]
    fn edge_colours_are_kept_for_pieces_that_exist_with_a_real_colour() {
        let mut f = finish();
        f.bleed.edge_colors = [
            ("g:0:0:0:0", "#FF0000"),
            ("g:0:0:0:1", "red"),
            ("g:9:0:0:0", "#00ff00"),
        ]
        .map(|(k, c)| (k.to_string(), c.to_string()))
        .into();
        let colors = finishing(&f, &PieceEdits::default(), &known()).edge_colors;
        assert_eq!(colors.len(), 1);
        assert_eq!(colors[0].card, parse_piece_key("g:0:0:0:0").unwrap());
        assert_eq!(colors[0].color, [255, 0, 0]);
    }

    #[test]
    fn a_background_colour_that_is_not_rrggbb_paints_nothing() {
        let mut f = finish();
        f.background = BackgroundOptions {
            sheet: Some("#00FF00".into()),
            pieces: Some("green".into()),
        };
        let options = finishing(&f, &PieceEdits::default(), &known()).options;
        assert_eq!(options.background.sheet.as_deref(), Some("#00ff00"));
        assert_eq!(options.background.pieces, None);
    }

    fn known() -> HashSet<String> {
        ["g:0:0:0:0", "g:0:0:0:1", "g:0:0:1:0"]
            .map(String::from)
            .into()
    }

    #[test]
    fn backs_carry_the_users_turn_of_each_back_and_of_the_common_back() {
        let edits = PieceEdits {
            turns: [
                ("g:0:0:0:1".into(), Turn::R180),
                ("g:0:0:1:0".into(), Turn::R90),
            ]
            .into(),
            backs: [("g:0:0:0:0".into(), "g:0:0:0:1".into())].into(),
            ..PieceEdits::default()
        };
        let f = finishing(&finish(), &edits, &known());
        assert_eq!(f.options.marks.color, "#ff0000");
        assert_eq!(f.options.marks.line, MarkLine::Dashed);
        assert!(f.options.marks.on_backs);
        assert_eq!(f.options.duplex.offset_y_mm, -1.0);
        assert_eq!(f.options.duplex.common_back, parse_piece_key("g:0:0:1:0"));
        assert_eq!(f.options.duplex.common_back_turn, Turn::R90);
        assert_eq!(
            f.backs,
            [BackPair {
                card: parse_piece_key("g:0:0:0:0").unwrap(),
                back: parse_piece_key("g:0:0:0:1").unwrap(),
                turn: Turn::R180,
            }]
        );
    }

    #[test]
    fn a_back_that_names_a_piece_that_is_gone_is_left_out() {
        let mut gone = finish();
        gone.duplex.common_back = Some("g:0:9:9:9".into());
        let edits = PieceEdits {
            backs: [
                ("g:0:0:0:0".into(), "g:0:7:7:7".into()),
                ("g:0:6:6:6".into(), "g:0:0:0:1".into()),
            ]
            .into(),
            ..PieceEdits::default()
        };
        let f = finishing(&gone, &edits, &known());
        assert!(f.backs.is_empty());
        assert_eq!(f.options.duplex.common_back, None);
    }
}
