//! Finishing the sheets of the print stage: cut marks, bleed and duplex backs.
//!
//! ```text
//! plan_print_in --> OutputSheet[] --finish_sheets--> OutputSheet[] --export_sheets--> PDF
//!                                     |- bleed   (regions painted under the pieces)
//!                                     |- marks   (lines painted over them)
//!                                     `- duplex  (a back sheet after each front sheet)
//! ```
//!
//! Everything is in PDF points with a top-left origin, like the rest of the sheet engine. The
//! preview and the export both read the result, so they cannot disagree. With every feature off
//! the sheets come out exactly as they went in.

use crate::card::{CardId, DocumentId, OrientedRect};
use crate::error::{Error, Result};
use crate::export::PageIssue;
use crate::geometry::{PageSize, Point, Rect};
use crate::sheet::{
    extract_all_cards, plan_print_in, Affine, Card, CardSetting, DocumentSource, Fold, FoldAxis,
    OutputSheet, PaginateOptions, PrintLayout, SheetPlacement, Turn,
};
use crate::units::{mm_to_pt, pt_to_mm};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const MAX_BLEED_MM: f64 = 5.0;
pub const MAX_DUPLEX_OFFSET_MM: f64 = 10.0;
pub const MAX_FOLD_GAP_MM: f64 = 5.0;

/// Positions closer than this (points) are the same position.
const EPS: f64 = 0.01;
/// A gap must be this much wider than the line (mm) for a line to be drawn in it.
const GAP_LINE_CLEARANCE_MM: f64 = 0.5;
/// A back whose size differs from its front by more than this (mm) will not be cut in line.
const BACK_SIZE_TOLERANCE_MM: f64 = 0.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarkStyle {
    #[default]
    Off,
    /// Short lines in the margins at every edge of the block.
    Ticks,
    /// A full line down the middle of each gap.
    Gaps,
}

/// How a cut mark is stroked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarkLine {
    #[default]
    Solid,
    Dashed,
    Dotted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct MarkOptions {
    pub style: MarkStyle,
    pub line: MarkLine,
    pub width_mm: f64,
    /// `#rrggbb`.
    pub color: String,
    pub length_mm: f64,
    /// Distance from the edge of the piece (plus the bleed) to the start of a tick.
    pub offset_mm: f64,
    /// Duplex on the other side: marks on the back sheets too, round the backs, for backs that are
    /// cut on their own instead of through both sides at once. Off, a back sheet has none.
    pub on_backs: bool,
    /// Ticks: also a small cross, its arms `length_mm` long, in the middle of each place where a gap
    /// between columns crosses a gap between rows, so the inside can be cut without a ruler across
    /// the sheet.
    pub inner_crosses: bool,
}

impl Default for MarkOptions {
    fn default() -> Self {
        Self {
            style: MarkStyle::Off,
            line: MarkLine::Solid,
            width_mm: 0.25,
            color: "#000000".into(),
            length_mm: 3.0,
            offset_mm: 1.0,
            on_backs: false,
            inner_crosses: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BleedSource {
    /// Reflect the edge strip of the piece over its edge.
    #[default]
    Mirror,
    /// Use what the source PDF has in the gap around the piece.
    Source,
    /// A plain fill of the colour of the piece's edge (`Finishing::edge_colors`, found by the
    /// app from a small render), under the piece. A piece without a colour is mirrored.
    Edge,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct BleedOptions {
    pub mm: f64,
    pub source: BleedSource,
}

impl Default for BleedOptions {
    fn default() -> Self {
        Self {
            mm: 0.0,
            source: BleedSource::Mirror,
        }
    }
}

/// The paper edge a sheet is turned over.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Flip {
    #[default]
    Long,
    Short,
}

/// Where the backs go: on a sheet of their own, printed on the other side of the paper
/// (`Duplex`), or beside each front on the same side, to fold (`Gutterfold`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackLayout {
    #[default]
    Duplex,
    Gutterfold,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct DuplexOptions {
    pub on: bool,
    pub layout: BackLayout,
    /// Gutterfold: the back beside the front (vertical fold) or below it (horizontal).
    pub fold: FoldAxis,
    /// Gutterfold: space between a front and its back, with the fold line in the middle.
    pub fold_gap_mm: f64,
    /// Gutterfold: the pairs are cut apart instead of folded. No fold line, cut marks round the
    /// front and the back each, and the gap at the fold is a plain gap.
    pub cut_apart: bool,
    /// Gutterfold: turn every back a half turn. `None` follows the fold: a back below its front
    /// is printed upside down so it reads right way up once folded; a back beside it is not, and
    /// neither is a back that is cut apart.
    pub back_upside_down: Option<bool>,
    pub flip: Flip,
    /// Moves everything on every back sheet, in the printed sheet (right is positive).
    pub offset_x_mm: f64,
    /// Down is positive.
    pub offset_y_mm: f64,
    /// The back of every piece that has no back of its own.
    pub common_back: Option<CardId>,
    /// The common back's own turn, as for `BackPair::turn`.
    pub common_back_turn: Turn,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct FinishOptions {
    pub marks: MarkOptions,
    pub bleed: BleedOptions,
    pub duplex: DuplexOptions,
    pub background: BackgroundOptions,
}

/// Plain colours painted under everything: the whole sheet, and a rectangle behind each piece
/// (with its bleed). They show only where the source leaves the page empty. `#rrggbb`; `None`
/// paints nothing, so the paper shows.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct BackgroundOptions {
    pub sheet: Option<String>,
    pub pieces: Option<String>,
}

/// `back` is the back of `card`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BackPair {
    pub card: CardId,
    pub back: CardId,
    /// The back's own turn (the user's, in the library): how it is turned to face the same way as
    /// its front, on top of the turn the flip or the fold needs.
    #[serde(default)]
    pub turn: Turn,
}

/// The colour of a piece's edge, for the `Edge` bleed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EdgeColor {
    pub card: CardId,
    pub color: [u8; 3],
}

/// What the finishing needs from the user: the options, the backs chosen per piece, and the
/// colours of the pieces' edges for the `Edge` bleed.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Finishing {
    pub options: FinishOptions,
    pub backs: Vec<BackPair>,
    pub edge_colors: Vec<EdgeColor>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    #[default]
    Front,
    Back,
}

/// The bleed of a sheet, as the exporter paints it.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct SheetBleed {
    pub mm: f64,
    #[serde(default)]
    pub source: BleedSource,
}

/// The `Edge` bleed of one placement: a fill of `color` over the piece grown by the bleed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EdgeFill {
    /// Index into the sheet's placements.
    pub placement: usize,
    pub color: [u8; 3],
}

/// The `Edge` bleed fills of a sheet's placements that have a colour; empty for another bleed.
fn edge_fills(sheet: &OutputSheet, colors: &HashMap<CardId, [u8; 3]>) -> Vec<EdgeFill> {
    if sheet.bleed.source != BleedSource::Edge || sheet.bleed.mm <= 0.0 {
        return Vec::new();
    }
    sheet
        .placements
        .iter()
        .enumerate()
        .filter_map(|(placement, p)| {
            colors
                .get(&p.card_id)
                .map(|&color| EdgeFill { placement, color })
        })
        .collect()
}

/// The plain colours of a sheet, as the exporter paints them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct SheetBackground {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet: Option<[u8; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pieces: Option<[u8; 3]>,
}

impl SheetBackground {
    pub fn is_none(&self) -> bool {
        self.sheet.is_none() && self.pieces.is_none()
    }
}

/// Cut marks of a sheet: stroked lines in points.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SheetMarks {
    pub width_pt: f64,
    pub color: [u8; 3],
    #[serde(default)]
    pub line: MarkLine,
    /// The dash pattern in points, on and off lengths in turn; empty for a solid line. A dotted line has
    /// dashes of length 0 drawn with round caps, so each is a dot as wide as the line.
    #[serde(default)]
    pub dash: Vec<f64>,
    /// `[x1, y1, x2, y2]`.
    pub lines: Vec<[f64; 4]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SheetWarning {
    MarksOffPage,
    GapTooNarrowForLine,
    BleedOverlapsNeighbour,
    BleedOffPage,
    BackSizeDiffers,
    BleedExceedsSourceGap,
}

fn invalid(detail: &str) -> Error {
    Error::InvalidSheet(detail.into())
}

/// `#rrggbb` as bytes.
pub fn parse_color(hex: &str) -> Result<[u8; 3]> {
    let digits = hex.strip_prefix('#').unwrap_or("");
    if digits.len() != 6 || !digits.is_ascii() {
        return Err(invalid("a mark colour must be #rrggbb"));
    }
    let byte = |i: usize| {
        u8::from_str_radix(&digits[i..i + 2], 16)
            .map_err(|_| invalid("a mark colour must be #rrggbb"))
    };
    Ok([byte(0)?, byte(2)?, byte(4)?])
}

fn check_range(name: &str, v: f64, min: f64, max: f64) -> Result<()> {
    if v.is_finite() && (min..=max).contains(&v) {
        Ok(())
    } else {
        Err(invalid(&format!(
            "{name} must be between {min} and {max} mm"
        )))
    }
}

fn validate(options: &FinishOptions) -> Result<()> {
    let m = &options.marks;
    check_range("the mark width", m.width_mm, 0.05, 2.0)?;
    check_range("the mark length", m.length_mm, 1.0, 10.0)?;
    check_range("the mark distance", m.offset_mm, 0.0, 10.0)?;
    parse_color(&m.color)?;
    check_range("the bleed", options.bleed.mm, 0.0, MAX_BLEED_MM)?;
    let d = &options.duplex;
    check_range(
        "the back X offset",
        d.offset_x_mm,
        -MAX_DUPLEX_OFFSET_MM,
        MAX_DUPLEX_OFFSET_MM,
    )?;
    check_range(
        "the back Y offset",
        d.offset_y_mm,
        -MAX_DUPLEX_OFFSET_MM,
        MAX_DUPLEX_OFFSET_MM,
    )?;
    check_range("the gap at the fold", d.fold_gap_mm, 0.0, MAX_FOLD_GAP_MM)?;
    sheet_background(&options.background)?;
    Ok(())
}

fn sheet_background(options: &BackgroundOptions) -> Result<SheetBackground> {
    let parse = |c: &Option<String>| c.as_deref().map(parse_color).transpose();
    Ok(SheetBackground {
        sheet: parse(&options.sheet)?,
        pieces: parse(&options.pieces)?,
    })
}

/// Whether the backs go beside the fronts, to fold.
fn gutterfold(options: &FinishOptions) -> bool {
    options.duplex.on && options.duplex.layout == BackLayout::Gutterfold
}

/// The pagination options the finishing needs: with gutterfold, every slot keeps room for the
/// piece's back.
pub fn paginate_options(options: &PaginateOptions, finishing: &Finishing) -> PaginateOptions {
    let d = &finishing.options.duplex;
    PaginateOptions {
        fold: gutterfold(&finishing.options).then_some(Fold {
            axis: d.fold,
            gap_mm: d.fold_gap_mm,
        }),
        ..*options
    }
}

/// Plans the sheets and finishes them, as the preview and the export both do: the one place
/// where the finishing can shape the plan (gutterfold slots). Gutterfold needs a sheet grid, so
/// "same as source" is refused with it.
pub fn plan_and_finish(
    documents: &[DocumentSource],
    settings: &[CardSetting],
    layout: &PrintLayout,
    options: &PaginateOptions,
    finishing: &Finishing,
) -> Result<(Vec<OutputSheet>, Vec<PageIssue>)> {
    if gutterfold(&finishing.options) && matches!(layout, PrintLayout::SameAsSource) {
        return Err(invalid(
            "gutterfold needs a sheet grid (Auto or Rows x columns), not \"same as source\"",
        ));
    }
    let planned = plan_print_in(
        documents,
        settings,
        layout,
        &paginate_options(options, finishing),
    )?;
    finish_sheets(planned, documents, finishing)
}

fn push_unique(warnings: &mut Vec<SheetWarning>, w: SheetWarning) {
    if !warnings.contains(&w) {
        warnings.push(w);
    }
}

// ---------------------------------------------------------------------------------------------
// Cut marks

fn bounds(rects: &[Rect]) -> Option<Rect> {
    let first = rects.first()?;
    let (mut x0, mut y0, mut x1, mut y1) = (
        first.x,
        first.y,
        first.x + first.width,
        first.y + first.height,
    );
    for r in rects {
        x0 = x0.min(r.x);
        y0 = y0.min(r.y);
        x1 = x1.max(r.x + r.width);
        y1 = y1.max(r.y + r.height);
    }
    Some(Rect::new(x0, y0, x1 - x0, y1 - y0))
}

fn distinct(mut values: Vec<f64>) -> Vec<f64> {
    values.sort_by(|a, b| a.total_cmp(b));
    values.dedup_by(|a, b| (*a - *b).abs() < EPS);
    values
}

/// The spans `[start, end]` along one axis where gaps between pieces are: the union of the
/// pieces' spans, then the spaces between its parts. Touching or overlapping spans give a gap of
/// zero or less and are not listed here but counted in the second value (`touching`).
fn gaps_along(spans: &mut [(f64, f64)]) -> (Vec<(f64, f64)>, usize) {
    spans.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut gaps = Vec::new();
    let mut touching = 0;
    let mut end = spans[0].1;
    for &(start, stop) in &spans[1..] {
        if start > end + EPS {
            gaps.push((end, start));
        } else if (start - end).abs() <= EPS {
            touching += 1;
        }
        end = end.max(stop);
    }
    (gaps, touching)
}

/// The crosses where a gap between columns meets a gap between rows, `length` (points) to each
/// side of the middle, added to `lines`. Only where a piece has a corner at that crossing, so an
/// empty end of a short last row gets none past its last piece. Returns false when some gap is
/// too narrow for a line (or there is none), as the gap lines do.
fn inner_crosses(
    rects: &[Rect],
    options: &MarkOptions,
    length: f64,
    lines: &mut Vec<[f64; 4]>,
) -> bool {
    let needed = mm_to_pt(options.width_mm + GAP_LINE_CLEARANCE_MM);
    let (columns, touching_x) = gaps_along(
        &mut rects
            .iter()
            .map(|r| (r.x, r.x + r.width))
            .collect::<Vec<_>>(),
    );
    let (rows, touching_y) = gaps_along(
        &mut rects
            .iter()
            .map(|r| (r.y, r.y + r.height))
            .collect::<Vec<_>>(),
    );
    let mut fits = touching_x == 0 && touching_y == 0;
    let wide = |gaps: Vec<(f64, f64)>, fits: &mut bool| -> Vec<(f64, f64)> {
        gaps.into_iter()
            .filter(|(a, b)| {
                let ok = b - a >= needed;
                *fits &= ok;
                ok
            })
            .collect()
    };
    let (columns, rows) = (wide(columns, &mut fits), wide(rows, &mut fits));
    let near = |a: f64, b: f64| (a - b).abs() < EPS;
    for &(x0, x1) in &columns {
        for &(y0, y1) in &rows {
            let cornered = rects.iter().any(|r| {
                let (rx, ry) = ([r.x, r.x + r.width], [r.y, r.y + r.height]);
                rx.iter().any(|&x| near(x, x0) || near(x, x1))
                    && ry.iter().any(|&y| near(y, y0) || near(y, y1))
            });
            if !cornered {
                continue;
            }
            let (mx, my) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
            lines.push([mx - length, my, mx + length, my]);
            lines.push([mx, my - length, mx, my + length]);
        }
    }
    fits
}

/// Cut marks around `rects`: the pieces, or with gutterfold each folded pair as one.
fn marks_for(
    rects: &[Rect],
    page: PageSize,
    options: &MarkOptions,
    bleed_pt: f64,
    warnings: &mut Vec<SheetWarning>,
) -> Result<Option<SheetMarks>> {
    if options.style == MarkStyle::Off || rects.is_empty() {
        return Ok(None);
    }
    let block = bounds(rects).expect("there is at least one placement");
    let (left, top) = (block.x, block.y);
    let (right, bottom) = (block.x + block.width, block.y + block.height);
    let length = mm_to_pt(options.length_mm);
    let mut lines: Vec<[f64; 4]> = Vec::new();

    match options.style {
        MarkStyle::Off => {}
        MarkStyle::Ticks => {
            let start = bleed_pt + mm_to_pt(options.offset_mm);
            let xs = distinct(rects.iter().flat_map(|r| [r.x, r.x + r.width]).collect());
            let ys = distinct(rects.iter().flat_map(|r| [r.y, r.y + r.height]).collect());
            for x in xs {
                lines.push([x, top - start - length, x, top - start]);
                lines.push([x, bottom + start, x, bottom + start + length]);
            }
            for y in ys {
                lines.push([left - start - length, y, left - start, y]);
                lines.push([right + start, y, right + start + length, y]);
            }
            if options.inner_crosses && !inner_crosses(rects, options, length, &mut lines) {
                push_unique(warnings, SheetWarning::GapTooNarrowForLine);
            }
        }
        MarkStyle::Gaps => {
            let needed = mm_to_pt(options.width_mm + GAP_LINE_CLEARANCE_MM);
            let mut narrow = false;
            let mut across = |spans: &mut Vec<(f64, f64)>, vertical: bool| {
                let (gaps, touching) = gaps_along(spans);
                narrow |= touching > 0;
                for (a, b) in gaps {
                    if b - a < needed {
                        narrow = true;
                        continue;
                    }
                    let mid = (a + b) / 2.0;
                    lines.push(if vertical {
                        [mid, top - length, mid, bottom + length]
                    } else {
                        [left - length, mid, right + length, mid]
                    });
                }
            };
            across(
                &mut rects.iter().map(|r| (r.x, r.x + r.width)).collect(),
                true,
            );
            across(
                &mut rects.iter().map(|r| (r.y, r.y + r.height)).collect(),
                false,
            );
            if narrow {
                push_unique(warnings, SheetWarning::GapTooNarrowForLine);
            }
        }
    }

    let off_page = lines.iter().any(|l| {
        [(l[0], l[1]), (l[2], l[3])].iter().any(|&(x, y)| {
            x < -EPS || y < -EPS || x > page.width_pt + EPS || y > page.height_pt + EPS
        })
    });
    if off_page {
        push_unique(warnings, SheetWarning::MarksOffPage);
    }
    if lines.is_empty() {
        return Ok(None);
    }
    let width_pt = mm_to_pt(options.width_mm);
    Ok(Some(SheetMarks {
        width_pt,
        color: parse_color(&options.color)?,
        line: options.line,
        dash: dash_pattern(options.line, width_pt),
        lines,
    }))
}

/// The dash pattern of a mark `width_pt` wide: dashes of 2 mm with 1 mm gaps, dots 0.75 mm apart, both
/// stretched for a thick line so the gaps never close up.
pub fn dash_pattern(line: MarkLine, width_pt: f64) -> Vec<f64> {
    match line {
        MarkLine::Solid => Vec::new(),
        MarkLine::Dashed => vec![
            mm_to_pt(2.0).max(4.0 * width_pt),
            mm_to_pt(1.0).max(2.0 * width_pt),
        ],
        MarkLine::Dotted => vec![0.0, mm_to_pt(0.75).max(2.5 * width_pt)],
    }
}

// ---------------------------------------------------------------------------------------------
// Bleed

/// One piece of bleed to paint: draw the source page again with `reflect` applied (in source
/// page coordinates, top-left origin), seen only through `quad`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BleedRegion {
    /// Where the bleed shows, in source page coordinates.
    pub quad: [Point; 4],
    /// Maps the source page onto itself so the part of the piece next to its edge lands in
    /// `quad`. The identity for bleed taken from the source.
    pub reflect: Affine,
}

/// Reflection over the line through `p` with unit direction `d`.
fn reflection(p: Point, d: Point) -> Affine {
    let (m11, m12, m22) = (
        2.0 * d.x * d.x - 1.0,
        2.0 * d.x * d.y,
        2.0 * d.y * d.y - 1.0,
    );
    Affine {
        m11,
        m12,
        m21: m12,
        m22,
        tx: p.x - (m11 * p.x + m12 * p.y),
        ty: p.y - (m12 * p.x + m22 * p.y),
    }
}

/// The regions of bleed `b` (points) around a piece of the source page, in source page
/// coordinates. `Mirror` gives four edge strips and four corner squares; `Source` one region, the
/// piece grown by `b` on every side.
pub fn bleed_regions(source: &OrientedRect, b: f64, how: BleedSource) -> Vec<BleedRegion> {
    let (sin, cos) = source.angle_deg.to_radians().sin_cos();
    let (u, v) = (Point { x: cos, y: sin }, Point { x: -sin, y: cos });
    let c = source.center;
    let at = |lu: f64, lv: f64| Point {
        x: c.x + lu * u.x + lv * v.x,
        y: c.y + lu * u.y + lv * v.y,
    };
    let (hw, hh) = (source.width / 2.0, source.height / 2.0);
    let quad =
        |u0: f64, u1: f64, v0: f64, v1: f64| [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
    if how == BleedSource::Source {
        return vec![BleedRegion {
            quad: quad(-hw - b, hw + b, -hh - b, hh + b),
            reflect: Affine::IDENTITY,
        }];
    }
    let left = reflection(at(-hw, 0.0), v);
    let right = reflection(at(hw, 0.0), v);
    let top = reflection(at(0.0, -hh), u);
    let bottom = reflection(at(0.0, hh), u);
    vec![
        BleedRegion {
            quad: quad(-hw - b, -hw, -hh, hh),
            reflect: left,
        },
        BleedRegion {
            quad: quad(hw, hw + b, -hh, hh),
            reflect: right,
        },
        BleedRegion {
            quad: quad(-hw, hw, -hh - b, -hh),
            reflect: top,
        },
        BleedRegion {
            quad: quad(-hw, hw, hh, hh + b),
            reflect: bottom,
        },
        BleedRegion {
            quad: quad(-hw - b, -hw, -hh - b, -hh),
            reflect: left.after(&top),
        },
        BleedRegion {
            quad: quad(hw, hw + b, -hh - b, -hh),
            reflect: right.after(&top),
        },
        BleedRegion {
            quad: quad(-hw - b, -hw, hh, hh + b),
            reflect: left.after(&bottom),
        },
        BleedRegion {
            quad: quad(hw, hw + b, hh, hh + b),
            reflect: right.after(&bottom),
        },
    ]
}

fn grow(r: &Rect, b: f64) -> Rect {
    Rect::new(r.x - b, r.y - b, r.width + 2.0 * b, r.height + 2.0 * b)
}

fn overlaps(a: &Rect, b: &Rect) -> bool {
    a.x < b.x + b.width - EPS
        && b.x < a.x + a.width - EPS
        && a.y < b.y + b.height - EPS
        && b.y < a.y + a.height - EPS
}

/// Warnings about the bleed around `rects` (the pieces, or with gutterfold each pair, whose two
/// halves share the fold edge and cover each other's bleed there).
fn bleed_warnings(sheet: &OutputSheet, rects: &[Rect], warnings: &mut Vec<SheetWarning>) {
    let b = mm_to_pt(sheet.bleed.mm);
    if b <= 0.0 {
        return;
    }
    let page = Rect::new(0.0, 0.0, sheet.page.width_pt, sheet.page.height_pt);
    let grown: Vec<Rect> = rects.iter().map(|r| grow(r, b)).collect();
    if grown.iter().any(|r| {
        r.x < page.x - EPS
            || r.y < page.y - EPS
            || r.x + r.width > page.width + EPS
            || r.y + r.height > page.height + EPS
    }) {
        push_unique(warnings, SheetWarning::BleedOffPage);
    }
    'outer: for (i, a) in grown.iter().enumerate() {
        for other in &grown[i + 1..] {
            if overlaps(a, other) {
                push_unique(warnings, SheetWarning::BleedOverlapsNeighbour);
                break 'outer;
            }
        }
    }
}

/// For every card, the room around it in the source page: the smallest gap to another card of the
/// same page, measured on the axis where they are further apart (so a card that only touches a
/// neighbour's corner region is judged by the nearer axis). Cards alone on their page have none.
fn source_gaps(cards: &[Card]) -> HashMap<CardId, f64> {
    let boxes: Vec<(CardId, Rect)> = cards
        .iter()
        .map(|c| {
            let corners = c.source.corners();
            let xs = corners.map(|p| p.x);
            let ys = corners.map(|p| p.y);
            let (x0, x1) = (
                xs.iter().cloned().fold(f64::MAX, f64::min),
                xs.iter().cloned().fold(f64::MIN, f64::max),
            );
            let (y0, y1) = (
                ys.iter().cloned().fold(f64::MAX, f64::min),
                ys.iter().cloned().fold(f64::MIN, f64::max),
            );
            (c.id, Rect::new(x0, y0, x1 - x0, y1 - y0))
        })
        .collect();
    let mut by_page: HashMap<(DocumentId, usize), Vec<usize>> = HashMap::new();
    for (i, (id, _)) in boxes.iter().enumerate() {
        by_page
            .entry((id.document_id(), id.page_index()))
            .or_default()
            .push(i);
    }
    let mut gaps = HashMap::new();
    for page in by_page.values() {
        for &i in page {
            let a = boxes[i].1;
            let mut least = f64::INFINITY;
            for &j in page {
                if i == j {
                    continue;
                }
                let b = boxes[j].1;
                let dx = (b.x - (a.x + a.width)).max(a.x - (b.x + b.width));
                let dy = (b.y - (a.y + a.height)).max(a.y - (b.y + b.height));
                least = least.min(dx.max(dy));
            }
            gaps.insert(boxes[i].0, least);
        }
    }
    gaps
}

// ---------------------------------------------------------------------------------------------
// Duplex

/// The turn a back needs so that, with the paper flipped, it reads right way up. Flipping over
/// the vertical axis reverses the sense of a turn; over the horizontal axis it also puts the
/// card head to foot.
fn back_turn(front: Turn, mirror_x: bool) -> Turn {
    let degrees = if mirror_x {
        -front.degrees()
    } else {
        180.0 - front.degrees()
    };
    Turn::try_from(degrees.rem_euclid(360.0) as u16).expect("a multiple of 90")
}

/// The back printed for `card` and its own turn: its pair's, or the common back.
fn back_of(
    card: CardId,
    duplex: &DuplexOptions,
    pairs: &HashMap<CardId, (CardId, Turn)>,
) -> Option<(CardId, Turn)> {
    pairs
        .get(&card)
        .copied()
        .or(duplex.common_back.map(|b| (b, duplex.common_back_turn)))
}

fn add_turns(a: Turn, b: Turn) -> Turn {
    Turn::try_from(((a.degrees() + b.degrees()) as u16) % 360).expect("a multiple of 90")
}

/// Whether the back of a sheet is the front mirrored left to right (turned over a vertical
/// edge) rather than top to bottom: the long edge of a portrait page, the short edge of a
/// landscape one.
pub(crate) fn mirrors_x(page: &PageSize, flip: Flip) -> bool {
    let portrait = page.width_pt <= page.height_pt;
    (flip == Flip::Long) == portrait
}

fn back_sheet(
    front: &OutputSheet,
    duplex: &DuplexOptions,
    pairs: &HashMap<CardId, (CardId, Turn)>,
    cards: &HashMap<CardId, Card>,
) -> Result<Option<OutputSheet>> {
    let page = front.page;
    let mirror_x = mirrors_x(&page, duplex.flip);
    let (dx, dy) = (mm_to_pt(duplex.offset_x_mm), mm_to_pt(duplex.offset_y_mm));
    let mut placements = Vec::new();
    let mut warnings = Vec::new();
    for p in &front.placements {
        let Some((back_id, own)) = back_of(p.card_id, duplex, pairs) else {
            continue;
        };
        let back = cards
            .get(&back_id)
            .ok_or_else(|| invalid("a back refers to a piece that does not exist"))?;
        let turn = add_turns(back_turn(p.turn, mirror_x), own);
        let sized = Card {
            scale: p.scale,
            scale_y: p.scale_y,
            turn,
            ..*back
        };
        let (w, h) = sized.final_size();
        let f = p.destination;
        let mirrored = if mirror_x {
            Point {
                x: page.width_pt - (f.x + f.width / 2.0),
                y: f.y + f.height / 2.0,
            }
        } else {
            Point {
                x: f.x + f.width / 2.0,
                y: page.height_pt - (f.y + f.height / 2.0),
            }
        };
        if (w - f.width).abs() > mm_to_pt(BACK_SIZE_TOLERANCE_MM)
            || (h - f.height).abs() > mm_to_pt(BACK_SIZE_TOLERANCE_MM)
        {
            push_unique(&mut warnings, SheetWarning::BackSizeDiffers);
        }
        placements.push(SheetPlacement {
            card_id: back_id,
            source: back.source,
            destination: Rect::new(mirrored.x - w / 2.0 + dx, mirrored.y - h / 2.0 + dy, w, h),
            turn,
            scale: p.scale,
            scale_y: p.scale_y,
        });
    }
    if placements.is_empty() {
        return Ok(None);
    }
    let mut sheet = OutputSheet::new(page, placements);
    sheet.side = Side::Back;
    sheet.bleed = front.bleed;
    sheet.background = front.background;
    let rects: Vec<Rect> = sheet.placements.iter().map(|p| p.destination).collect();
    bleed_warnings(&sheet, &rects, &mut warnings);
    sheet.warnings = warnings;
    Ok(Some(sheet))
}

/// Gutterfold: puts each front's back in the room the plan left beside it (or below it), turned
/// so it reads right way up once folded, and returns the outlines for the cut marks and the bleed
/// (each pair, or each front and back when they are cut apart) and the fold lines (none when cut
/// apart).
fn fold_backs(
    sheet: &mut OutputSheet,
    duplex: &DuplexOptions,
    pairs: &HashMap<CardId, (CardId, Turn)>,
    cards: &HashMap<CardId, Card>,
    warnings: &mut Vec<SheetWarning>,
) -> Result<(Vec<Rect>, Vec<[f64; 4]>)> {
    let gap = mm_to_pt(duplex.fold_gap_mm);
    let vertical = duplex.fold == FoldAxis::Vertical;
    let upside_down = duplex
        .back_upside_down
        .unwrap_or(!vertical && !duplex.cut_apart);
    let mut outlines = Vec::new();
    let mut folds = Vec::new();
    let mut backs = Vec::new();
    for p in &sheet.placements {
        let f = p.destination;
        // The room for the back: the same size as the front, past the fold.
        let room = if vertical {
            Rect::new(f.x + f.width + gap, f.y, f.width, f.height)
        } else {
            Rect::new(f.x, f.y + f.height + gap, f.width, f.height)
        };
        if duplex.cut_apart {
            outlines.extend([f, room]);
        } else {
            outlines.push(bounds(&[f, room]).expect("two rects"));
            folds.push(if vertical {
                let x = f.x + f.width + gap / 2.0;
                [x, f.y, x, f.y + f.height]
            } else {
                let y = f.y + f.height + gap / 2.0;
                [f.x, y, f.x + f.width, y]
            });
        }
        let Some((back_id, own)) = back_of(p.card_id, duplex, pairs) else {
            continue;
        };
        let back = cards
            .get(&back_id)
            .ok_or_else(|| invalid("a back refers to a piece that does not exist"))?;
        let fold_turn = if upside_down { Turn::R180 } else { Turn::R0 };
        let turn = add_turns(add_turns(p.turn, fold_turn), own);
        let sized = Card {
            scale: p.scale,
            scale_y: p.scale_y,
            turn,
            ..*back
        };
        let (w, h) = sized.final_size();
        if (w - f.width).abs() > mm_to_pt(BACK_SIZE_TOLERANCE_MM)
            || (h - f.height).abs() > mm_to_pt(BACK_SIZE_TOLERANCE_MM)
        {
            push_unique(warnings, SheetWarning::BackSizeDiffers);
        }
        backs.push(SheetPlacement {
            card_id: back_id,
            source: back.source,
            // Centred in its room, like a smaller piece in its slot.
            destination: Rect::new(
                room.x + (room.width - w) / 2.0,
                room.y + (room.height - h) / 2.0,
                w,
                h,
            ),
            turn,
            scale: p.scale,
            scale_y: p.scale_y,
        });
    }
    sheet.placements.extend(backs);
    Ok((outlines, folds))
}

// ---------------------------------------------------------------------------------------------

/// Applies bleed, cut marks and duplex backs to `sheets`. `documents` are the sources the cards
/// come from (the backs are looked up there). The second value lists the pages that cannot be
/// exported as asked: with the bleed taken from the source, a piece with less room around it than
/// the bleed.
pub fn finish_sheets(
    sheets: Vec<OutputSheet>,
    documents: &[DocumentSource],
    finishing: &Finishing,
) -> Result<(Vec<OutputSheet>, Vec<PageIssue>)> {
    let options = &finishing.options;
    validate(options)?;
    let background = sheet_background(&options.background)?;
    let wanted = options.marks.style != MarkStyle::Off
        || options.bleed.mm > 0.0
        || options.duplex.on
        || !background.is_none();
    if !wanted {
        return Ok((sheets, Vec::new()));
    }
    let cards = extract_all_cards(documents)?;
    let by_id: HashMap<CardId, Card> = cards.iter().map(|c| (c.id, *c)).collect();
    let pairs: HashMap<CardId, (CardId, Turn)> = finishing
        .backs
        .iter()
        .map(|p| (p.card, (p.back, p.turn)))
        .collect();
    let colors: HashMap<CardId, [u8; 3]> = finishing
        .edge_colors
        .iter()
        .map(|e| (e.card, e.color))
        .collect();
    let bleed = SheetBleed {
        mm: options.bleed.mm,
        source: options.bleed.source,
    };
    let bleed_pt = mm_to_pt(bleed.mm);
    if bleed_pt > 0.0 {
        for c in &cards {
            if bleed_pt > c.source.width.min(c.source.height) / 2.0 {
                return Err(invalid("the bleed is larger than half of a piece"));
            }
        }
    }
    let gaps = if bleed_pt > 0.0 && bleed.source == BleedSource::Source {
        source_gaps(&cards)
    } else {
        HashMap::new()
    };

    let folding = gutterfold(options);
    let mut out = Vec::with_capacity(sheets.len() * if options.duplex.on { 2 } else { 1 });
    let mut issues: Vec<PageIssue> = Vec::new();
    for mut sheet in sheets {
        sheet.bleed = bleed;
        sheet.background = background;
        let mut warnings = Vec::new();
        // With gutterfold a front and its back are one piece of paper: marks and bleed go round
        // the pair (or round each of them, when the pairs are cut apart).
        let outlines = if folding {
            let (outlines, folds) =
                fold_backs(&mut sheet, &options.duplex, &pairs, &by_id, &mut warnings)?;
            sheet.folds = folds;
            outlines
        } else {
            sheet.placements.iter().map(|p| p.destination).collect()
        };
        bleed_warnings(&sheet, &outlines, &mut warnings);
        sheet.marks = marks_for(
            &outlines,
            sheet.page,
            &options.marks,
            bleed_pt,
            &mut warnings,
        )?;
        let mut back = if options.duplex.on && !folding {
            back_sheet(&sheet, &options.duplex, &pairs, &by_id)?
        } else {
            None
        };
        if let Some(b) = back.as_mut().filter(|_| options.marks.on_backs) {
            let rects: Vec<Rect> = b.placements.iter().map(|p| p.destination).collect();
            b.marks = marks_for(&rects, b.page, &options.marks, bleed_pt, &mut b.warnings)?;
        }
        if let Some(b) = back.as_mut() {
            b.edge_fills = edge_fills(b, &colors);
        }
        sheet.edge_fills = edge_fills(&sheet, &colors);
        sheet.warnings = warnings;
        out.push(sheet);
        out.extend(back);
    }

    if !gaps.is_empty() {
        for sheet in &mut out {
            let mut short = false;
            for p in &sheet.placements {
                let gap = gaps.get(&p.card_id).copied().unwrap_or(f64::INFINITY);
                if gap < bleed_pt - EPS {
                    short = true;
                    let error = Error::BleedExceedsSourceGap {
                        gap_mm: pt_to_mm(gap.max(0.0)),
                        bleed_mm: bleed.mm,
                    };
                    let issue = PageIssue::new(p.card_id.page_index(), &error)
                        .in_document(p.card_id.document_id());
                    if !issues.iter().any(|i| {
                        i.document_id == issue.document_id && i.page_index == issue.page_index
                    }) {
                        issues.push(issue);
                    }
                }
            }
            if short {
                push_unique(&mut sheet.warnings, SheetWarning::BleedExceedsSourceGap);
            }
        }
        issues.sort_by_key(|i| (i.document_id, i.page_index));
    }
    Ok((out, issues))
}
