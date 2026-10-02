//! The single source of truth for card geometry.
//!
//! All rectangles produced here are in PDF points with a **top-left origin**,
//! relative to the source page box (`source`) or the output page
//! (`destination`). The React preview and the PDF exporter must both consume
//! this output rather than re-deriving spacing maths.

use crate::error::{Error, Result};
use crate::geometry::{PageSize, Rect};
use crate::units::{mm_to_pt, pt_to_mm};
use serde::{Deserialize, Serialize};

/// User-facing grid description. `bounds` is normalized (0..1) relative to the
/// source page, top-left origin.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct GridLayout {
    pub bounds: Rect,
    pub rows: usize,
    pub columns: usize,
    pub gap_mm: f64,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LayoutResult {
    pub output_page: PageSize,
    pub placements: Vec<CardPlacement>,
    pub card_width_mm: f64,
    pub card_height_mm: f64,
}

/// Compute card placements. `output_page` defaults to the source page size.
/// The spaced-out card block is centred on the output page.
pub fn calculate_layout(
    source_page: PageSize,
    grid: &GridLayout,
    output_page: Option<PageSize>,
) -> Result<LayoutResult> {
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
        return Err(Error::InvalidGrid(format!("bounds outside the page: {b:?}")));
    }
    if grid.gap_mm < 0.0 || !grid.gap_mm.is_finite() {
        return Err(Error::InvalidGrid("gap must be >= 0".into()));
    }

    let out = output_page.unwrap_or(source_page);
    let gap = mm_to_pt(grid.gap_mm);
    let (rows, cols) = (grid.rows, grid.columns);

    let region = Rect::new(
        b.x * source_page.width_pt,
        b.y * source_page.height_pt,
        b.width * source_page.width_pt,
        b.height * source_page.height_pt,
    );
    let card_w = region.width / cols as f64;
    let card_h = region.height / rows as f64;

    let total_w = card_w * cols as f64 + gap * (cols - 1) as f64;
    let total_h = card_h * rows as f64 + gap * (rows - 1) as f64;
    // Small epsilon so an exactly-fitting layout isn't rejected by float noise.
    if total_w > out.width_pt + 1e-6 || total_h > out.height_pt + 1e-6 {
        return Err(Error::DoesNotFit {
            needed_w_mm: pt_to_mm(total_w),
            needed_h_mm: pt_to_mm(total_h),
            page_w_mm: pt_to_mm(out.width_pt),
            page_h_mm: pt_to_mm(out.height_pt),
        });
    }
    let origin_x = (out.width_pt - total_w) / 2.0;
    let origin_y = (out.height_pt - total_h) / 2.0;

    let mut placements = Vec::with_capacity(rows * cols);
    for r in 0..rows {
        for c in 0..cols {
            placements.push(CardPlacement {
                index: r * cols + c,
                source: Rect::new(
                    region.x + c as f64 * card_w,
                    region.y + r as f64 * card_h,
                    card_w,
                    card_h,
                ),
                destination: Rect::new(
                    origin_x + c as f64 * (card_w + gap),
                    origin_y + r as f64 * (card_h + gap),
                    card_w,
                    card_h,
                ),
            });
        }
    }

    Ok(LayoutResult {
        output_page: out,
        placements,
        card_width_mm: pt_to_mm(card_w),
        card_height_mm: pt_to_mm(card_h),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a4() -> PageSize {
        PageSize { width_pt: 595.2756, height_pt: 841.8898 }
    }

    #[test]
    fn card_size_is_preserved_and_gap_inserted() {
        let grid = GridLayout {
            bounds: Rect::new(0.1, 0.1, 0.8, 0.8),
            rows: 3,
            columns: 3,
            gap_mm: 3.0,
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
            gap_mm: 3.0,
        };
        assert!(matches!(
            calculate_layout(a4(), &grid, None),
            Err(Error::DoesNotFit { .. })
        ));
    }
}
