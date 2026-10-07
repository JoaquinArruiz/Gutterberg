//! The sheet engine: from a list of cards and quantities to output sheets.
//!
//! ```text
//! page groups --extract_cards--> cards --(+ quantity, turn, scale)--> paginate --> OutputSheet
//! ```
//!
//! Everything is in PDF points with a top-left origin. Cards are never scaled unless a card
//! carries an explicit `scale`; a card that does not fit the sheet is an error, never shrunk.
//! Export (`export::export_sheets`) turns the sheets into a PDF without rasterising anything.

use crate::card::{CardId, DocumentId, OrientedRect, PageGroup, PageGroupKind, PageRange};
use crate::error::{Error, Result};
use crate::geometry::{PageSize, Point, Rect};
use crate::layout::{calculate_fitting_layout, source_cards, LayoutResult};
use crate::units::{mm_to_pt, pt_to_mm};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Sizes closer than this (mm, on both sides) count as the same size when grouping.
pub const SIZE_TOLERANCE_MM: f64 = 0.5;

/// Quarter turns clockwise applied to a card on the sheet, so that all cards can face the same way.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(try_from = "u16", into = "u16")]
pub enum Turn {
    #[default]
    R0,
    R90,
    R180,
    R270,
}

impl Turn {
    pub fn degrees(self) -> f64 {
        match self {
            Turn::R0 => 0.0,
            Turn::R90 => 90.0,
            Turn::R180 => 180.0,
            Turn::R270 => 270.0,
        }
    }

    /// Whether width and height trade places.
    pub fn swaps_axes(self) -> bool {
        matches!(self, Turn::R90 | Turn::R270)
    }
}

impl TryFrom<u16> for Turn {
    type Error = String;

    fn try_from(degrees: u16) -> std::result::Result<Self, String> {
        match degrees {
            0 => Ok(Turn::R0),
            90 => Ok(Turn::R90),
            180 => Ok(Turn::R180),
            270 => Ok(Turn::R270),
            _ => Err(format!("a turn must be 0, 90, 180 or 270, not {degrees}")),
        }
    }
}

impl From<Turn> for u16 {
    fn from(t: Turn) -> u16 {
        t.degrees() as u16
    }
}

fn one() -> f64 {
    1.0
}

fn one_copy() -> usize {
    1
}

/// A card that can go on a sheet: where it comes from, and how it is shown.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Card {
    pub id: CardId,
    /// The area of the source page the card is cut from.
    pub source: OrientedRect,
    /// Explicit size factor, 1.0 unless the user set a real size or a percentage.
    #[serde(default = "one")]
    pub scale: f64,
    /// Output turn.
    #[serde(default)]
    pub turn: Turn,
}

impl Card {
    /// An unscaled, unturned card.
    pub fn new(id: CardId, source: OrientedRect) -> Self {
        Self {
            id,
            source,
            scale: 1.0,
            turn: Turn::R0,
        }
    }

    /// Size on the sheet (points): the source size times the scale, with width and height
    /// swapped for a quarter turn.
    pub fn final_size(&self) -> (f64, f64) {
        let (w, h) = (
            self.source.width * self.scale,
            self.source.height * self.scale,
        );
        if self.turn.swaps_axes() {
            (h, w)
        } else {
            (w, h)
        }
    }
}

/// Per-card choices made by the user; cards without one are printed once, unturned and unscaled,
/// after the cards that have one. The order of the list is the order cards are printed in.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CardSetting {
    pub id: CardId,
    #[serde(default = "one_copy")]
    pub quantity: usize,
    #[serde(default)]
    pub turn: Turn,
    #[serde(default = "one")]
    pub scale: f64,
}

fn check_range(range: PageRange, total_pages: usize) -> Result<()> {
    if range.first > range.last {
        return Err(Error::InvalidSheet(format!(
            "page range {}..{} is empty",
            range.first + 1,
            range.last + 1
        )));
    }
    if range.last >= total_pages {
        return Err(Error::PageOutOfRange(range.last, total_pages));
    }
    Ok(())
}

/// Every card of the page groups, in page order (row-major within a grid). Skipped pages give
/// none. Grid cards are unrotated with scale 1.0; a freeform group's cards map one to one onto
/// each page of its range.
pub fn extract_cards(
    document_id: DocumentId,
    pages: &[PageSize],
    groups: &[PageGroup],
) -> Result<Vec<Card>> {
    let mut cards = Vec::new();
    for g in groups {
        let range = g.pages;
        check_range(range, pages.len())?;
        let in_range = pages[range.first..=range.last].iter();
        for (page_index, &page) in (range.first..).zip(in_range) {
            match &g.kind {
                PageGroupKind::Skip => {}
                PageGroupKind::Grid { grid } => {
                    for sc in source_cards(page, grid)? {
                        cards.push(Card::new(sc.id(document_id, page_index), sc.oriented()));
                    }
                }
                PageGroupKind::Freeform { cards: drawn } => {
                    for (index, source) in drawn.iter().enumerate() {
                        let id = CardId::Freeform {
                            document_id,
                            page_index,
                            index,
                        };
                        cards.push(Card::new(id, *source));
                    }
                }
            }
        }
    }
    Ok(cards)
}

/// One source PDF as the planner sees it: the sizes of its pages (as the UI shows them, or
/// read from the file) and the page groups that say where its cards are.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocumentSource {
    pub document_id: DocumentId,
    #[serde(default)]
    pub pages: Vec<PageSize>,
    pub groups: Vec<PageGroup>,
}

/// Rejects two sources that claim the same document id: their cards would be told apart by
/// nothing.
fn check_documents(documents: &[DocumentSource]) -> Result<()> {
    for (i, d) in documents.iter().enumerate() {
        if documents[..i]
            .iter()
            .any(|e| e.document_id == d.document_id)
        {
            return Err(Error::InvalidSheet(format!(
                "document {} is listed twice",
                d.document_id
            )));
        }
    }
    Ok(())
}

/// [`extract_cards`] for several documents: each document's cards in page order, the
/// documents in the order given.
pub fn extract_all_cards(documents: &[DocumentSource]) -> Result<Vec<Card>> {
    check_documents(documents)?;
    let mut cards = Vec::new();
    for d in documents {
        cards.extend(extract_cards(d.document_id, &d.pages, &d.groups)?);
    }
    Ok(cards)
}

/// Output page size, or sized around the cards.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SheetPage {
    Size(PageSize),
    /// Margins + the rows x columns block + gaps. Needs `rows` and `columns`.
    Fit,
    /// The size of the source page of the first card. Resolved by [`plan_sheets`]; `paginate`
    /// itself needs a concrete size.
    SameAsSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Margins {
    #[serde(default)]
    pub top_mm: f64,
    #[serde(default)]
    pub right_mm: f64,
    #[serde(default)]
    pub bottom_mm: f64,
    #[serde(default)]
    pub left_mm: f64,
}

/// What a sheet looks like. `None` for rows or columns means as many as fit on the page.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SheetSpec {
    pub page: SheetPage,
    #[serde(default)]
    pub rows: Option<usize>,
    #[serde(default)]
    pub columns: Option<usize>,
    #[serde(default)]
    pub gap_x_mm: f64,
    #[serde(default)]
    pub gap_y_mm: f64,
    #[serde(default)]
    pub margins: Margins,
}

/// How copies are ordered: with quantities 4 x A, 2 x B, 3 x C.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Order {
    /// A A A A B B C C C
    #[default]
    Grouped,
    /// A B C A B C A C A: round-robin until each card runs out.
    Interleaved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct PaginateOptions {
    pub order: Order,
    /// One group of sheets per card size, each with a grid that fits it. When off, every
    /// card shares one grid whose slots are as large as the largest card.
    pub group_by_size: bool,
    /// Repeat the requested cards, in order, until the last sheet of each group is full.
    pub auto_fill: bool,
}

impl Default for PaginateOptions {
    fn default() -> Self {
        Self {
            order: Order::Grouped,
            group_by_size: true,
            auto_fill: false,
        }
    }
}

/// One card on one sheet.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SheetPlacement {
    pub card_id: CardId,
    pub source: OrientedRect,
    /// The upright box the card fills on the sheet (its final size, after scale and turn).
    pub destination: Rect,
    pub turn: Turn,
    pub scale: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OutputSheet {
    pub page: PageSize,
    pub placements: Vec<SheetPlacement>,
}

/// Most placements one call may produce; keeps a hostile quantity from exhausting memory.
const MAX_PLACEMENTS: usize = 1_000_000;

fn validate(spec: &SheetSpec) -> Result<()> {
    let m = spec.margins;
    let lengths = [
        spec.gap_x_mm,
        spec.gap_y_mm,
        m.top_mm,
        m.right_mm,
        m.bottom_mm,
        m.left_mm,
    ];
    if lengths.iter().any(|v| !v.is_finite() || *v < 0.0) {
        return Err(Error::InvalidSheet("gaps and margins must be >= 0".into()));
    }
    if spec.rows == Some(0) || spec.columns == Some(0) {
        return Err(Error::InvalidSheet("rows and columns must be >= 1".into()));
    }
    if spec.page == SheetPage::SameAsSource {
        return Err(Error::InvalidSheet(
            "the page size must be resolved first (use plan_sheets)".into(),
        ));
    }
    if let SheetPage::Size(p) = spec.page {
        if !(p.width_pt > 0.0 && p.height_pt > 0.0) {
            return Err(Error::InvalidSheet(
                "the page must have a positive size".into(),
            ));
        }
    }
    if spec.page == SheetPage::Fit && (spec.rows.is_none() || spec.columns.is_none()) {
        return Err(Error::InvalidSheet(
            "fitting the page to the cards needs rows and columns".into(),
        ));
    }
    Ok(())
}

/// A card as the layout sees it: its final size and how many copies are wanted.
#[derive(Clone, Copy)]
struct Entry<'a> {
    card: &'a Card,
    quantity: usize,
    width: f64,
    height: f64,
}

/// Copies in the order they go on the sheets, as indexes into `entries`.
fn copy_order(entries: &[Entry], order: Order) -> Vec<usize> {
    match order {
        Order::Grouped => entries
            .iter()
            .enumerate()
            .flat_map(|(i, e)| std::iter::repeat_n(i, e.quantity))
            .collect(),
        Order::Interleaved => {
            let rounds = entries.iter().map(|e| e.quantity).max().unwrap_or(0);
            (0..rounds)
                .flat_map(|round| {
                    entries
                        .iter()
                        .enumerate()
                        .filter(move |(_, e)| e.quantity > round)
                        .map(|(i, _)| i)
                })
                .collect()
        }
    }
}

/// How many slots of `size` with `gap` between them fit in `usable`.
fn fit_count(usable: f64, size: f64, gap: f64) -> usize {
    const EPS: f64 = 1e-6;
    if size > usable + EPS {
        0
    } else {
        ((usable + gap + EPS) / (size + gap)).floor() as usize
    }
}

fn does_not_fit(needed_w: f64, needed_h: f64, page_w: f64, page_h: f64) -> Error {
    Error::DoesNotFit {
        needed_w_mm: pt_to_mm(needed_w),
        needed_h_mm: pt_to_mm(needed_h),
        page_w_mm: pt_to_mm(page_w),
        page_h_mm: pt_to_mm(page_h),
    }
}

/// Lays out one group of cards that share a grid.
fn lay_out(
    entries: &[Entry],
    options: &PaginateOptions,
    spec: &SheetSpec,
) -> Result<Vec<OutputSheet>> {
    let mut copies = copy_order(entries, options.order);
    if copies.is_empty() {
        return Ok(Vec::new());
    }
    let slot_w = entries.iter().map(|e| e.width).fold(0.0, f64::max);
    let slot_h = entries.iter().map(|e| e.height).fold(0.0, f64::max);
    let (gap_x, gap_y) = (mm_to_pt(spec.gap_x_mm), mm_to_pt(spec.gap_y_mm));
    let m = spec.margins;
    let (m_top, m_right) = (mm_to_pt(m.top_mm), mm_to_pt(m.right_mm));
    let (m_bottom, m_left) = (mm_to_pt(m.bottom_mm), mm_to_pt(m.left_mm));

    let block = |cols: usize, rows: usize| {
        (
            slot_w * cols as f64 + gap_x * (cols - 1) as f64,
            slot_h * rows as f64 + gap_y * (rows - 1) as f64,
        )
    };

    let (page, cols, rows) = match spec.page {
        SheetPage::Size(page) => {
            let (usable_w, usable_h) = (
                page.width_pt - m_left - m_right,
                page.height_pt - m_top - m_bottom,
            );
            let (fit_cols, fit_rows) = (
                fit_count(usable_w, slot_w, gap_x),
                fit_count(usable_h, slot_h, gap_y),
            );
            if fit_cols == 0 || fit_rows == 0 {
                // Not even one card fits.
                return Err(does_not_fit(
                    slot_w + m_left + m_right,
                    slot_h + m_top + m_bottom,
                    page.width_pt,
                    page.height_pt,
                ));
            }
            let (cols, rows) = (
                spec.columns.unwrap_or(fit_cols),
                spec.rows.unwrap_or(fit_rows),
            );
            let (bw, bh) = block(cols, rows);
            if bw > usable_w + 1e-6 || bh > usable_h + 1e-6 {
                return Err(does_not_fit(
                    bw + m_left + m_right,
                    bh + m_top + m_bottom,
                    page.width_pt,
                    page.height_pt,
                ));
            }
            (page, cols, rows)
        }
        SheetPage::SameAsSource => unreachable!("rejected by validate"),
        SheetPage::Fit => {
            // `validate` guarantees both counts.
            let (cols, rows) = (spec.columns.unwrap_or(1), spec.rows.unwrap_or(1));
            let (bw, bh) = block(cols, rows);
            let page = PageSize {
                width_pt: m_left + bw + m_right,
                height_pt: m_top + bh + m_bottom,
            };
            (page, cols, rows)
        }
    };

    // The block of slots is centred inside the margins.
    let (bw, bh) = block(cols, rows);
    let origin_x = m_left + ((page.width_pt - m_left - m_right - bw) / 2.0).max(0.0);
    let origin_y = m_top + ((page.height_pt - m_top - m_bottom - bh) / 2.0).max(0.0);

    let per_sheet = cols * rows;
    if options.auto_fill {
        // Go round the requested sequence again until the last sheet is full.
        let n = copies.len();
        for k in n..n.div_ceil(per_sheet) * per_sheet {
            copies.push(copies[k % n]);
        }
    }
    let sheets = copies
        .chunks(per_sheet)
        .map(|chunk| {
            let placements = chunk
                .iter()
                .enumerate()
                .map(|(k, &i)| {
                    let e = &entries[i];
                    let (row, col) = (k / cols, k % cols);
                    let slot_x = origin_x + col as f64 * (slot_w + gap_x);
                    let slot_y = origin_y + row as f64 * (slot_h + gap_y);
                    SheetPlacement {
                        card_id: e.card.id,
                        source: e.card.source,
                        // Smaller cards sit in the middle of their slot.
                        destination: Rect::new(
                            slot_x + (slot_w - e.width) / 2.0,
                            slot_y + (slot_h - e.height) / 2.0,
                            e.width,
                            e.height,
                        ),
                        turn: e.card.turn,
                        scale: e.card.scale,
                    }
                })
                .collect();
            OutputSheet { page, placements }
        })
        .collect();
    Ok(sheets)
}

/// Puts cards on sheets: `quantity` copies of each card, in `options.order`, split into one
/// group of sheets per card size unless `options.group_by_size` is off.
pub fn paginate(
    cards: &[(Card, usize)],
    spec: &SheetSpec,
    options: &PaginateOptions,
) -> Result<Vec<OutputSheet>> {
    validate(spec)?;
    let mut entries: Vec<Entry> = Vec::new();
    let mut total: usize = 0;
    for (card, quantity) in cards {
        if !(card.scale.is_finite() && card.scale > 0.0) {
            return Err(Error::InvalidSheet("a card's scale must be above 0".into()));
        }
        let (width, height) = card.final_size();
        if !(width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0) {
            return Err(Error::InvalidSheet("a card has no size".into()));
        }
        total = total.saturating_add(*quantity);
        if total > MAX_PLACEMENTS {
            return Err(Error::InvalidSheet(format!(
                "more than {MAX_PLACEMENTS} cards were requested"
            )));
        }
        if *quantity > 0 {
            entries.push(Entry {
                card,
                quantity: *quantity,
                width,
                height,
            });
        }
    }

    let groups: Vec<Vec<Entry>> = if options.group_by_size {
        let tol = mm_to_pt(SIZE_TOLERANCE_MM);
        let mut groups: Vec<Vec<Entry>> = Vec::new();
        for e in entries {
            // Compare with the group's first card, so near sizes cannot drift into one another.
            let home = groups.iter_mut().find(|g| {
                (g[0].width - e.width).abs() <= tol && (g[0].height - e.height).abs() <= tol
            });
            match home {
                Some(g) => g.push(e),
                None => groups.push(vec![e]),
            }
        }
        groups
    } else {
        vec![entries]
    };

    let mut sheets = Vec::new();
    for g in &groups {
        sheets.extend(lay_out(g, options, spec)?);
    }
    Ok(sheets)
}

/// The sheets for a document with the default plan plus the user's per-card settings: every
/// card of the page groups, in order, once each unless a setting says otherwise.
pub fn plan_sheets(
    document_id: DocumentId,
    pages: &[PageSize],
    groups: &[PageGroup],
    settings: &[CardSetting],
    spec: &SheetSpec,
    options: &PaginateOptions,
) -> Result<Vec<OutputSheet>> {
    let document = DocumentSource {
        document_id,
        pages: pages.to_vec(),
        groups: groups.to_vec(),
    };
    plan_sheets_in(&[document], settings, spec, options)
}

/// [`plan_sheets`] for cards from several documents on the same sheets.
pub fn plan_sheets_in(
    documents: &[DocumentSource],
    settings: &[CardSetting],
    spec: &SheetSpec,
    options: &PaginateOptions,
) -> Result<Vec<OutputSheet>> {
    // Cards with a setting come first, in the order the settings list them (the user's own
    // order); the rest follow in page order with one copy each.
    let mut extracted: Vec<Option<Card>> = extract_all_cards(documents)?
        .into_iter()
        .map(Some)
        .collect();
    let position: HashMap<CardId, usize> = extracted
        .iter()
        .enumerate()
        .filter_map(|(i, c)| c.as_ref().map(|c| (c.id, i)))
        .collect();
    let mut cards: Vec<(Card, usize)> = Vec::with_capacity(extracted.len());
    for s in settings {
        // An unknown card, or one listed twice, is skipped.
        if let Some(mut card) = position.get(&s.id).and_then(|&i| extracted[i].take()) {
            card.turn = s.turn;
            card.scale = s.scale;
            cards.push((card, s.quantity));
        }
    }
    cards.extend(extracted.into_iter().flatten().map(|card| (card, 1)));
    let spec = match spec.page {
        SheetPage::SameAsSource => {
            // The first card that is actually printed decides the page size.
            let Some((first, _)) = cards.iter().find(|(_, quantity)| *quantity > 0) else {
                return Ok(Vec::new());
            };
            let size = documents
                .iter()
                .find(|d| d.document_id == first.id.document_id())
                .and_then(|d| d.pages.get(first.id.page_index()))
                .copied()
                .ok_or(Error::NoDocument)?;
            SheetSpec {
                page: SheetPage::Size(size),
                ..*spec
            }
        }
        _ => *spec,
    };
    paginate(&cards, &spec, options)
}

/// How the print stage lays cards out.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PrintLayout {
    /// Every grid page becomes one sheet with its own grid and the spacing, margins and
    /// page of its group: exactly what the Cards stage exports. Per-card settings and
    /// pagination options do not apply.
    SameAsSource,
    /// Cards go through [`plan_sheets`] with this sheet.
    Grid { spec: SheetSpec },
}

/// The sheet for one source page laid out by `calculate_layout` (all cards in order,
/// sheet grid = source grid).
pub fn sheet_from_layout(
    document_id: DocumentId,
    page_index: usize,
    columns: usize,
    layout: &LayoutResult,
) -> OutputSheet {
    OutputSheet {
        page: layout.output_page,
        placements: layout
            .placements
            .iter()
            .map(|p| SheetPlacement {
                card_id: CardId::Grid {
                    document_id,
                    page_index,
                    row: p.index / columns,
                    column: p.index % columns,
                },
                source: OrientedRect::from_rect(p.source),
                destination: p.destination,
                turn: Turn::R0,
                scale: 1.0,
            })
            .collect(),
    }
}

/// One sheet per grid page, as the Cards stage lays it out. Freeform groups have no grid and
/// give no sheet here.
pub fn source_sheets(
    document_id: DocumentId,
    pages: &[PageSize],
    groups: &[PageGroup],
) -> Result<Vec<OutputSheet>> {
    let mut sheets = Vec::new();
    source_sheets_into(&mut sheets, document_id, pages, groups)?;
    Ok(sheets)
}

/// [`source_sheets`] for several documents, one after the other.
pub fn source_sheets_in(documents: &[DocumentSource]) -> Result<Vec<OutputSheet>> {
    check_documents(documents)?;
    let mut sheets = Vec::new();
    for d in documents {
        source_sheets_into(&mut sheets, d.document_id, &d.pages, &d.groups)?;
    }
    Ok(sheets)
}

fn source_sheets_into(
    sheets: &mut Vec<OutputSheet>,
    document_id: DocumentId,
    pages: &[PageSize],
    groups: &[PageGroup],
) -> Result<()> {
    for g in groups {
        check_range(g.pages, pages.len())?;
        if let PageGroupKind::Grid { grid } = &g.kind {
            let in_range = pages[g.pages.first..=g.pages.last].iter();
            for (page_index, &page) in (g.pages.first..).zip(in_range) {
                let layout = calculate_fitting_layout(page, grid)?;
                sheets.push(sheet_from_layout(
                    document_id,
                    page_index,
                    grid.columns,
                    &layout,
                ));
            }
        }
    }
    Ok(())
}

/// The output sheets of the print stage for `layout`.
pub fn plan_print(
    document_id: DocumentId,
    pages: &[PageSize],
    groups: &[PageGroup],
    settings: &[CardSetting],
    layout: &PrintLayout,
    options: &PaginateOptions,
) -> Result<Vec<OutputSheet>> {
    match layout {
        PrintLayout::SameAsSource => source_sheets(document_id, pages, groups),
        PrintLayout::Grid { spec } => {
            plan_sheets(document_id, pages, groups, settings, spec, options)
        }
    }
}

/// [`plan_print`] for a project with several documents: their cards share the sheets.
pub fn plan_print_in(
    documents: &[DocumentSource],
    settings: &[CardSetting],
    layout: &PrintLayout,
    options: &PaginateOptions,
) -> Result<Vec<OutputSheet>> {
    match layout {
        PrintLayout::SameAsSource => source_sheets_in(documents),
        PrintLayout::Grid { spec } => plan_sheets_in(documents, settings, spec, options),
    }
}

/// A 2x3 affine map in top-left page coordinates:
/// `x' = m11 x + m12 y + tx`, `y' = m21 x + m22 y + ty`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Affine {
    pub m11: f64,
    pub m12: f64,
    pub m21: f64,
    pub m22: f64,
    pub tx: f64,
    pub ty: f64,
}

impl Affine {
    pub fn apply(&self, p: Point) -> Point {
        Point {
            x: self.m11 * p.x + self.m12 * p.y + self.tx,
            y: self.m21 * p.x + self.m22 * p.y + self.ty,
        }
    }
}

/// The map that takes a card from its source area to its box on the sheet: undo the source
/// angle, apply the output turn and the scale (all about the card's centre), then move the
/// centre to the centre of `destination`. Angles are clockwise on screen (y points down).
pub fn card_transform(source: &OrientedRect, scale: f64, turn: Turn, destination: &Rect) -> Affine {
    let angle = (turn.degrees() - source.angle_deg).to_radians();
    let (sin, cos) = angle.sin_cos();
    let (m11, m12, m21, m22) = (scale * cos, -scale * sin, scale * sin, scale * cos);
    let (cx, cy) = (
        destination.x + destination.width / 2.0,
        destination.y + destination.height / 2.0,
    );
    Affine {
        m11,
        m12,
        m21,
        m22,
        tx: cx - (m11 * source.center.x + m12 * source.center.y),
        ty: cy - (m21 * source.center.x + m22 * source.center.y),
    }
}
