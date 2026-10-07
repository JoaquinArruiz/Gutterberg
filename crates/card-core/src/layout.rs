//! The single source of truth for card geometry.
//!
//! All rectangles produced here are in PDF points with a **top-left origin**,
//! relative to the source page box (`source`) or the output page
//! (`destination`). The React preview and the PDF exporter must both consume
//! this output rather than re-deriving spacing maths.

use crate::card::{CardId, DocumentId, OrientedRect};
use crate::error::{Error, Result};
use crate::geometry::{PageSize, Rect};
use crate::units::{mm_to_pt, pt_to_mm};
use serde::{Deserialize, Serialize};

/// User-facing grid description. `bounds` is normalized (0..1) relative to the
/// source page, top-left origin, and covers the whole card block *including*
/// any gaps already present in the source.
///
/// Source gap and output gap are independent: cards are cut out at their source
/// positions and re-placed with exactly the output gap, so a 2 mm source gap
/// with a 5 mm output gap yields 5 mm (not 7 mm).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GridLayout {
    pub bounds: Rect,
    pub rows: usize,
    pub columns: usize,
    /// Gap between cards already present in the source (mm).
    #[serde(default)]
    pub source_gap_x_mm: f64,
    #[serde(default)]
    pub source_gap_y_mm: f64,
    /// Gap between cards wanted in the output (mm).
    pub gap_x_mm: f64,
    pub gap_y_mm: f64,
    /// Output page margins (mm). The card block is centred inside them.
    #[serde(default)]
    pub margin_top_mm: f64,
    #[serde(default)]
    pub margin_right_mm: f64,
    #[serde(default)]
    pub margin_bottom_mm: f64,
    #[serde(default)]
    pub margin_left_mm: f64,
    /// Output page size; `None` = same as the source page.
    #[serde(default)]
    pub output_page: Option<PageSize>,
    /// Size the output page around the cards (margins + cards + gaps) instead
    /// of using `output_page`. Cards are never scaled.
    #[serde(default)]
    pub fit_page: bool,
}

/// One card's location in the source page. Everything after this step works on
/// `SourceCard`s, so irregular layouts only need a different generator.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SourceCard {
    /// Row-major index (0-based).
    pub index: usize,
    pub row: usize,
    pub column: usize,
    /// Points, top-left origin.
    pub rect: Rect,
}

impl SourceCard {
    /// Identity of this card on `page_index` of `document_id`.
    pub fn id(&self, document_id: DocumentId, page_index: usize) -> CardId {
        CardId::Grid {
            document_id,
            page_index,
            row: self.row,
            column: self.column,
        }
    }

    /// The source area as an oriented rectangle. Grid cards are never rotated.
    pub fn oriented(&self) -> OrientedRect {
        OrientedRect::from_rect(self.rect)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CardPlacement {
    /// Row-major index (0-based).
    pub index: usize,
    /// Region of the source page (points, top-left origin).
    pub source: Rect,
    /// Position on the output page (points, top-left origin). Same size as
    /// `source`: spacing is inserted, cards are never scaled.
    pub destination: Rect,
}

/// How far the laid-out cards (plus margins) extend beyond the output page.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Overflow {
    pub width_mm: f64,
    pub height_mm: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LayoutResult {
    pub output_page: PageSize,
    pub placements: Vec<CardPlacement>,
    pub card_width_mm: f64,
    pub card_height_mm: f64,
    /// Set when the cards do not fit; they are never shrunk to make them fit.
    pub overflow: Option<Overflow>,
}

fn validate(grid: &GridLayout) -> Result<()> {
    let b = grid.bounds;
    if grid.rows == 0 || grid.columns == 0 {
        return Err(Error::InvalidGrid("rows and columns must be >= 1".into()));
    }
    if !(b.width > 0.0 && b.height > 0.0)
        || b.x < 0.0
        || b.y < 0.0
        || b.x + b.width > 1.0 + 1e-9
        || b.y + b.height > 1.0 + 1e-9
    {
        return Err(Error::InvalidGrid(format!(
            "bounds outside the page: {b:?}"
        )));
    }
    for g in [
        grid.gap_x_mm,
        grid.gap_y_mm,
        grid.source_gap_x_mm,
        grid.source_gap_y_mm,
        grid.margin_top_mm,
        grid.margin_right_mm,
        grid.margin_bottom_mm,
        grid.margin_left_mm,
    ] {
        if g < 0.0 || !g.is_finite() {
            return Err(Error::InvalidGrid("gaps and margins must be >= 0".into()));
        }
    }
    if let Some(p) = grid.output_page {
        if !(p.width_pt > 0.0 && p.height_pt > 0.0) {
            return Err(Error::InvalidGrid(
                "output page must have a positive size".into(),
            ));
        }
    }
    Ok(())
}

/// Where each card sits in the source page. Card size is
/// `(bounds - source gaps) / n`, so it is correct whether or not the source
/// already has spacing.
pub fn source_cards(source_page: PageSize, grid: &GridLayout) -> Result<Vec<SourceCard>> {
    validate(grid)?;
    let b = grid.bounds;
    let (rows, cols) = (grid.rows, grid.columns);
    let gap_x = mm_to_pt(grid.source_gap_x_mm);
    let gap_y = mm_to_pt(grid.source_gap_y_mm);
    let region = Rect::new(
        b.x * source_page.width_pt,
        b.y * source_page.height_pt,
        b.width * source_page.width_pt,
        b.height * source_page.height_pt,
    );
    let card_w = (region.width - gap_x * (cols - 1) as f64) / cols as f64;
    let card_h = (region.height - gap_y * (rows - 1) as f64) / rows as f64;
    if !(card_w > 0.0 && card_h > 0.0) {
        return Err(Error::InvalidGrid(
            "source gaps leave no room for the cards".into(),
        ));
    }
    let mut cards = Vec::with_capacity(rows * cols);
    for r in 0..rows {
        for c in 0..cols {
            cards.push(SourceCard {
                index: r * cols + c,
                row: r,
                column: c,
                rect: Rect::new(
                    region.x + c as f64 * (card_w + gap_x),
                    region.y + r as f64 * (card_h + gap_y),
                    card_w,
                    card_h,
                ),
            });
        }
    }
    Ok(cards)
}

/// Compute card placements. `output_page` is the fallback page size when the
/// grid does not specify one (default: the source page size). The spaced-out
/// card block is centred inside the margins. Source gaps only decide where
/// cards are read from; they have no effect on destination spacing.
pub fn calculate_layout(
    source_page: PageSize,
    grid: &GridLayout,
    output_page: Option<PageSize>,
) -> Result<LayoutResult> {
    let cards = source_cards(source_page, grid)?;
    let (rows, cols) = (grid.rows, grid.columns);
    let (card_w, card_h) = (cards[0].rect.width, cards[0].rect.height);

    let gap_x = mm_to_pt(grid.gap_x_mm);
    let gap_y = mm_to_pt(grid.gap_y_mm);
    let (m_top, m_right) = (mm_to_pt(grid.margin_top_mm), mm_to_pt(grid.margin_right_mm));
    let (m_bottom, m_left) = (
        mm_to_pt(grid.margin_bottom_mm),
        mm_to_pt(grid.margin_left_mm),
    );

    let total_w = card_w * cols as f64 + gap_x * (cols - 1) as f64;
    let total_h = card_h * rows as f64 + gap_y * (rows - 1) as f64;

    let out = if grid.fit_page {
        PageSize {
            width_pt: m_left + total_w + m_right,
            height_pt: m_top + total_h + m_bottom,
        }
    } else {
        grid.output_page.or(output_page).unwrap_or(source_page)
    };

    // Small epsilon so an exactly-fitting layout isn't flagged by float noise.
    let over_w = (m_left + total_w + m_right - out.width_pt).max(0.0);
    let over_h = (m_top + total_h + m_bottom - out.height_pt).max(0.0);
    let overflow = (over_w > 1e-6 || over_h > 1e-6).then(|| Overflow {
        width_mm: pt_to_mm(over_w),
        height_mm: pt_to_mm(over_h),
    });

    // Centre inside the margins; when it doesn't fit, anchor at the margin.
    let origin_x = m_left + ((out.width_pt - m_left - m_right - total_w) / 2.0).max(0.0);
    let origin_y = m_top + ((out.height_pt - m_top - m_bottom - total_h) / 2.0).max(0.0);

    let placements = cards
        .iter()
        .map(|c| CardPlacement {
            index: c.index,
            source: c.rect,
            destination: Rect::new(
                origin_x + c.column as f64 * (card_w + gap_x),
                origin_y + c.row as f64 * (card_h + gap_y),
                card_w,
                card_h,
            ),
        })
        .collect();

    Ok(LayoutResult {
        output_page: out,
        placements,
        card_width_mm: pt_to_mm(card_w),
        card_height_mm: pt_to_mm(card_h),
        overflow,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_cards_have_ids_and_unrotated_sources() {
        let grid = GridLayout {
            rows: 2,
            columns: 3,
            ..base()
        };
        let page = PageSize {
            width_pt: 300.0,
            height_pt: 200.0,
        };
        let cards = source_cards(page, &grid).unwrap();
        let card = cards[4]; // row 1, column 1
        assert_eq!(
            card.id(7, 5),
            CardId::Grid {
                document_id: 7,
                page_index: 5,
                row: 1,
                column: 1
            }
        );
        let o = card.oriented();
        assert_eq!(o.angle_deg, 0.0);
        assert_eq!(o.as_rect(), Some(card.rect));
    }

    fn base() -> GridLayout {
        GridLayout {
            bounds: Rect::new(0.0, 0.0, 1.0, 1.0),
            rows: 1,
            columns: 1,
            source_gap_x_mm: 0.0,
            source_gap_y_mm: 0.0,
            gap_x_mm: 0.0,
            gap_y_mm: 0.0,
            margin_top_mm: 0.0,
            margin_right_mm: 0.0,
            margin_bottom_mm: 0.0,
            margin_left_mm: 0.0,
            output_page: None,
            fit_page: false,
        }
    }

    fn mm_page(w: f64, h: f64) -> PageSize {
        PageSize {
            width_pt: mm_to_pt(w),
            height_pt: mm_to_pt(h),
        }
    }

    fn a4() -> PageSize {
        PageSize {
            width_pt: 595.2756,
            height_pt: 841.8898,
        }
    }

    #[test]
    fn card_size_is_preserved_and_gap_inserted() {
        let grid = GridLayout {
            bounds: Rect::new(0.1, 0.1, 0.8, 0.8),
            rows: 3,
            columns: 3,
            source_gap_x_mm: 0.0,
            source_gap_y_mm: 0.0,
            gap_x_mm: 3.0,
            gap_y_mm: 3.0,
            ..base()
        };
        let l = calculate_layout(a4(), &grid, None).unwrap();
        assert_eq!(l.placements.len(), 9);
        for p in &l.placements {
            assert_eq!(p.source.width, p.destination.width);
            assert_eq!(p.source.height, p.destination.height);
        }
        let gap_x = l.placements[1].destination.x
            - (l.placements[0].destination.x + l.placements[0].destination.width);
        assert!((pt_to_mm(gap_x) - 3.0).abs() < 1e-9);
        let gap_y = l.placements[3].destination.y
            - (l.placements[0].destination.y + l.placements[0].destination.height);
        assert!((pt_to_mm(gap_y) - 3.0).abs() < 1e-9);
    }

    #[test]
    fn rejects_overflow() {
        let grid = GridLayout {
            bounds: Rect::new(0.0, 0.0, 1.0, 1.0),
            rows: 3,
            columns: 3,
            source_gap_x_mm: 0.0,
            source_gap_y_mm: 0.0,
            gap_x_mm: 3.0,
            gap_y_mm: 3.0,
            ..base()
        };
        let l = calculate_layout(a4(), &grid, None).unwrap();
        let o = l.overflow.expect("overflow reported");
        assert!((o.width_mm - 6.0).abs() < 1e-6 && (o.height_mm - 6.0).abs() < 1e-6);
        // Cards keep their size even when they don't fit.
        assert_eq!(
            l.placements[0].source.width,
            l.placements[0].destination.width
        );
    }

    #[test]
    fn source_gap_is_replaced_not_added() {
        // 3 cards of 60 mm with 2 mm source gaps: 184 mm wide block.
        let w = 3.0 * 60.0 + 2.0 * 2.0;
        let grid = GridLayout {
            bounds: Rect::new(0.05, 0.1, w / 210.0, 0.3),
            rows: 1,
            columns: 3,
            source_gap_x_mm: 2.0,
            source_gap_y_mm: 0.0,
            gap_x_mm: 5.0,
            gap_y_mm: 0.0,
            ..base()
        };
        let page = PageSize {
            width_pt: mm_to_pt(210.0),
            height_pt: mm_to_pt(297.0),
        };
        let l = calculate_layout(page, &grid, None).unwrap();
        assert!((pt_to_mm(l.placements[0].source.width) - 60.0).abs() < 1e-9);
        let src_gap =
            l.placements[1].source.x - (l.placements[0].source.x + l.placements[0].source.width);
        assert!((pt_to_mm(src_gap) - 2.0).abs() < 1e-9);
        let out_gap = l.placements[1].destination.x
            - (l.placements[0].destination.x + l.placements[0].destination.width);
        assert!((pt_to_mm(out_gap) - 5.0).abs() < 1e-9);
    }

    /// 3 cards x 63.5 mm, `src` mm apart in the source, laid out `out` mm apart.
    fn three_across(src: f64, out: f64) -> LayoutResult {
        let w = 3.0 * 63.5 + 2.0 * src;
        let grid = GridLayout {
            bounds: Rect::new(0.0, 0.0, w / 297.0, 88.0 / 210.0),
            columns: 3,
            source_gap_x_mm: src,
            gap_x_mm: out,
            ..base()
        };
        calculate_layout(mm_page(297.0, 210.0), &grid, None).unwrap()
    }

    #[test]
    fn output_x_positions_without_source_gap() {
        let l = three_across(0.0, 3.0);
        let x0 = l.placements[0].destination.x;
        for (i, p) in l.placements.iter().enumerate() {
            assert!((pt_to_mm(p.destination.x - x0) - (63.5 + 3.0) * i as f64).abs() < 1e-9);
        }
    }

    #[test]
    fn source_gap_does_not_leak_into_output() {
        let with = three_across(2.0, 5.0);
        let without = three_across(0.0, 5.0);
        for (a, b) in with.placements.iter().zip(&without.placements) {
            assert!((a.destination.x - b.destination.x).abs() < 1e-9);
            assert!((a.destination.width - b.destination.width).abs() < 1e-9);
        }
        // ...but the source rects do follow the source gap.
        let s = &with.placements;
        assert!((pt_to_mm(s[1].source.x - s[0].source.x) - 65.5).abs() < 1e-9);
    }

    #[test]
    fn horizontal_and_vertical_gaps_are_independent() {
        let grid = GridLayout {
            bounds: Rect::new(0.0, 0.0, 0.8, 0.8),
            rows: 2,
            columns: 2,
            source_gap_x_mm: 1.0,
            source_gap_y_mm: 4.0,
            gap_x_mm: 2.0,
            gap_y_mm: 7.0,
            ..base()
        };
        let l = calculate_layout(a4(), &grid, None).unwrap();
        let p = &l.placements;
        let ox = p[1].destination.x - (p[0].destination.x + p[0].destination.width);
        let oy = p[2].destination.y - (p[0].destination.y + p[0].destination.height);
        let sx = p[1].source.x - (p[0].source.x + p[0].source.width);
        let sy = p[2].source.y - (p[0].source.y + p[0].source.height);
        assert!((pt_to_mm(ox) - 2.0).abs() < 1e-9 && (pt_to_mm(oy) - 7.0).abs() < 1e-9);
        assert!((pt_to_mm(sx) - 1.0).abs() < 1e-9 && (pt_to_mm(sy) - 4.0).abs() < 1e-9);
    }

    #[test]
    fn single_row_and_column_are_valid_with_gaps_set() {
        let grid = GridLayout {
            bounds: Rect::new(0.1, 0.1, 0.3, 0.3),
            source_gap_x_mm: 9.0,
            source_gap_y_mm: 9.0,
            gap_x_mm: 9.0,
            gap_y_mm: 9.0,
            ..base()
        };
        let l = calculate_layout(a4(), &grid, None).unwrap();
        assert_eq!(l.placements.len(), 1);
        assert!(l.placements[0].source.width.is_finite() && l.overflow.is_none());
        assert!((l.placements[0].source.width - 0.3 * a4().width_pt).abs() < 1e-9);
    }

    #[test]
    fn destination_size_equals_source_size() {
        let l = three_across(2.0, 5.0);
        for p in &l.placements {
            assert_eq!(p.source.width, p.destination.width);
            assert_eq!(p.source.height, p.destination.height);
        }
    }

    #[test]
    fn overflow_is_reported_per_axis_and_cards_are_not_scaled() {
        let grid = GridLayout {
            bounds: Rect::new(0.0, 0.0, 190.5 / 210.0, 88.0 / 297.0),
            columns: 3,
            gap_x_mm: 10.0, // 190.5 + 20 = 210.5 > 210
            ..base()
        };
        let l = calculate_layout(a4(), &grid, None).unwrap();
        let o = l.overflow.unwrap();
        assert!((o.width_mm - 0.5).abs() < 1e-3 && o.height_mm == 0.0);
    }

    #[test]
    fn margins_count_towards_overflow_and_centre_the_block() {
        let grid = GridLayout {
            bounds: Rect::new(0.0, 0.0, 100.0 / 210.0, 100.0 / 297.0),
            margin_left_mm: 20.0,
            margin_right_mm: 0.0,
            ..base()
        };
        let l = calculate_layout(a4(), &grid, None).unwrap();
        assert!(l.overflow.is_none());
        // Block centred in the 190 mm wide area right of the left margin.
        assert!((pt_to_mm(l.placements[0].destination.x) - (20.0 + 45.0)).abs() < 1e-6);
        let tight = GridLayout {
            margin_right_mm: 100.0,
            ..grid
        };
        assert!(calculate_layout(a4(), &tight, None)
            .unwrap()
            .overflow
            .is_some());
    }

    #[test]
    fn fit_page_wraps_the_cards_and_margins() {
        let grid = GridLayout {
            bounds: Rect::new(0.0, 0.0, 190.5 / 210.0, 88.0 / 297.0),
            columns: 3,
            gap_x_mm: 10.0,
            margin_left_mm: 5.0,
            margin_right_mm: 5.0,
            margin_top_mm: 2.0,
            margin_bottom_mm: 3.0,
            fit_page: true,
            ..base()
        };
        let l = calculate_layout(mm_page(210.0, 297.0), &grid, None).unwrap();
        assert!(l.overflow.is_none());
        assert!((pt_to_mm(l.output_page.width_pt) - (190.5 + 20.0 + 10.0)).abs() < 1e-6);
        assert!((pt_to_mm(l.output_page.height_pt) - (88.0 + 5.0)).abs() < 1e-6);
        assert!((pt_to_mm(l.placements[0].destination.x) - 5.0).abs() < 1e-6);
        assert!((pt_to_mm(l.placements[0].destination.y) - 2.0).abs() < 1e-6);
    }
}
