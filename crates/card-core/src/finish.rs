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
    extract_all_cards, Affine, Card, DocumentSource, OutputSheet, SheetPlacement, Turn,
};
use crate::units::{mm_to_pt, pt_to_mm};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const MAX_BLEED_MM: f64 = 5.0;
pub const MAX_DUPLEX_OFFSET_MM: f64 = 10.0;

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct MarkOptions {
    pub style: MarkStyle,
    pub width_mm: f64,
    /// `#rrggbb`.
    pub color: String,
    pub length_mm: f64,
    /// Distance from the edge of the piece (plus the bleed) to the start of a tick.
    pub offset_mm: f64,
}

impl Default for MarkOptions {
    fn default() -> Self {
        Self {
            style: MarkStyle::Off,
            width_mm: 0.25,
            color: "#000000".into(),
            length_mm: 3.0,
            offset_mm: 1.0,
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

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct DuplexOptions {
    pub on: bool,
    pub flip: Flip,
    /// Moves everything on every back sheet, in the printed sheet (right is positive).
    pub offset_x_mm: f64,
    /// Down is positive.
    pub offset_y_mm: f64,
    /// The back of every piece that has no back of its own.
    pub common_back: Option<CardId>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct FinishOptions {
    pub marks: MarkOptions,
    pub bleed: BleedOptions,
    pub duplex: DuplexOptions,
}

/// `back` is the back of `card`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BackPair {
    pub card: CardId,
    pub back: CardId,
}

/// What the finishing needs from the user: the options and the backs chosen per piece.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Finishing {
    pub options: FinishOptions,
    pub backs: Vec<BackPair>,
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

/// Cut marks of a sheet: stroked lines in points.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SheetMarks {
    pub width_pt: f64,
    pub color: [u8; 3],
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
    Ok(())
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

fn marks_for(
    placements: &[SheetPlacement],
    page: PageSize,
    options: &MarkOptions,
    bleed_pt: f64,
    warnings: &mut Vec<SheetWarning>,
) -> Result<Option<SheetMarks>> {
    if options.style == MarkStyle::Off || placements.is_empty() {
        return Ok(None);
    }
    let rects: Vec<Rect> = placements.iter().map(|p| p.destination).collect();
    let block = bounds(&rects).expect("there is at least one placement");
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
    Ok(Some(SheetMarks {
        width_pt: mm_to_pt(options.width_mm),
        color: parse_color(&options.color)?,
        lines,
    }))
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

fn bleed_warnings(sheet: &OutputSheet, warnings: &mut Vec<SheetWarning>) {
    let b = mm_to_pt(sheet.bleed.mm);
    if b <= 0.0 {
        return;
    }
    let page = Rect::new(0.0, 0.0, sheet.page.width_pt, sheet.page.height_pt);
    let grown: Vec<Rect> = sheet
        .placements
        .iter()
        .map(|p| grow(&p.destination, b))
        .collect();
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

fn back_sheet(
    front: &OutputSheet,
    duplex: &DuplexOptions,
    pairs: &HashMap<CardId, CardId>,
    cards: &HashMap<CardId, Card>,
) -> Result<Option<OutputSheet>> {
    let page = front.page;
    let portrait = page.width_pt <= page.height_pt;
    let mirror_x = (duplex.flip == Flip::Long) == portrait;
    let (dx, dy) = (mm_to_pt(duplex.offset_x_mm), mm_to_pt(duplex.offset_y_mm));
    let mut placements = Vec::new();
    let mut warnings = Vec::new();
    for p in &front.placements {
        let Some(back_id) = pairs.get(&p.card_id).copied().or(duplex.common_back) else {
            continue;
        };
        let back = cards
            .get(&back_id)
            .ok_or_else(|| invalid("a back refers to a piece that does not exist"))?;
        let turn = back_turn(p.turn, mirror_x);
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
    bleed_warnings(&sheet, &mut warnings);
    sheet.warnings = warnings;
    Ok(Some(sheet))
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
    let wanted =
        options.marks.style != MarkStyle::Off || options.bleed.mm > 0.0 || options.duplex.on;
    if !wanted {
        return Ok((sheets, Vec::new()));
    }
    let cards = extract_all_cards(documents)?;
    let by_id: HashMap<CardId, Card> = cards.iter().map(|c| (c.id, *c)).collect();
    let pairs: HashMap<CardId, CardId> = finishing.backs.iter().map(|p| (p.card, p.back)).collect();
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

    let mut out = Vec::with_capacity(sheets.len() * if options.duplex.on { 2 } else { 1 });
    let mut issues: Vec<PageIssue> = Vec::new();
    for mut sheet in sheets {
        sheet.bleed = bleed;
        let mut warnings = Vec::new();
        bleed_warnings(&sheet, &mut warnings);
        sheet.marks = marks_for(
            &sheet.placements,
            sheet.page,
            &options.marks,
            bleed_pt,
            &mut warnings,
        )?;
        let back = if options.duplex.on {
            back_sheet(&sheet, &options.duplex, &pairs, &by_id)?
        } else {
            None
        };
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
