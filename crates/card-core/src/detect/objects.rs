//! Engine 1: the page's own objects. Many publisher PDFs place every piece as an image or draw it
//! as a rectangle; several of the same size in a regular arrangement are the grid, to a fraction
//! of a millimetre. Crop marks in the margins that line up with it confirm it.

use super::{
    cluster, min_piece_pt, Detector, EngineResult, Note, ObjectKind, PageData, PageObject,
    Proposal, ProposalKind, PAGE_FRACTION, POSITION_TOLERANCE_MM, SIZE_TOLERANCE_MM,
};
use crate::geometry::Rect;
use crate::units::{mm_to_pt, pt_to_mm};
use std::collections::HashSet;

/// Confidence of a grid whose every cell has an object and whose pitch is regular.
const COMPLETE: f64 = 0.95;
const MISSING_CELLS_PENALTY: f64 = 0.25;
/// Two or three objects are a hint, not proof.
const FEW_OBJECTS_CAP: f64 = 0.6;
const CROP_MARKS_BONUS: f64 = 0.04;
const CROP_MARKS_CAP: f64 = 0.99;
/// Crop marks needed to count (two on each axis, say).
const CROP_MARKS_NEEDED: usize = 4;
/// How close a crop mark must be to a piece boundary (mm).
const CROP_MARK_TOLERANCE_MM: f64 = 0.5;

pub struct ObjectsEngine;

impl Detector for ObjectsEngine {
    fn engine(&self) -> &'static str {
        "pdf-objects"
    }

    fn detect(&self, page: &PageData) -> EngineResult {
        let min = min_piece_pt();
        let (pw, ph) = (page.size.width_pt, page.size.height_pt);
        let tol = mm_to_pt(POSITION_TOLERANCE_MM);
        let mut candidates: Vec<Rect> = Vec::new();
        for o in &page.objects {
            let r = o.rect;
            let usable = matches!(o.kind, ObjectKind::Image | ObjectKind::Rect)
                && r.width >= min
                && r.height >= min
                && !(r.width > PAGE_FRACTION * pw && r.height > PAGE_FRACTION * ph);
            // A fill and a stroke of the same rectangle are one candidate.
            let seen = candidates.iter().any(|c| {
                (c.x - r.x).abs() < tol
                    && (c.y - r.y).abs() < tol
                    && (c.width - r.width).abs() < tol
                    && (c.height - r.height).abs() < tol
            });
            if usable && !seen {
                candidates.push(r);
            }
        }

        // Candidates of one size.
        let size_tol = mm_to_pt(SIZE_TOLERANCE_MM);
        let mut groups: Vec<Vec<Rect>> = Vec::new();
        for r in candidates {
            match groups.iter_mut().find(|g| {
                (g[0].width - r.width).abs() <= size_tol
                    && (g[0].height - r.height).abs() <= size_tol
            }) {
                Some(g) => g.push(r),
                None => groups.push(vec![r]),
            }
        }

        let lines: Vec<&PageObject> = page
            .objects
            .iter()
            .filter(|o| o.kind == ObjectKind::Line)
            .collect();
        let proposals = groups
            .iter()
            .filter(|g| g.len() >= 2)
            .filter_map(|g| fit_grid(g, &lines))
            .collect();
        EngineResult {
            proposals,
            reasons: Vec::new(),
        }
    }
}

/// The grid that `items` (all one size) form, if they sit on regular columns and rows.
fn fit_grid(items: &[Rect], lines: &[&PageObject]) -> Option<Proposal> {
    let tol = mm_to_pt(POSITION_TOLERANCE_MM);
    let n = items.len() as f64;
    let (w, h) = (
        items.iter().map(|r| r.width).sum::<f64>() / n,
        items.iter().map(|r| r.height).sum::<f64>() / n,
    );
    let columns = cluster(&items.iter().map(|r| r.x).collect::<Vec<_>>(), tol);
    let rows = cluster(&items.iter().map(|r| r.y).collect::<Vec<_>>(), tol);

    let pitches = |c: &[(f64, usize)]| -> Option<f64> {
        if c.len() < 2 {
            return Some(0.0);
        }
        let steps: Vec<f64> = c.windows(2).map(|p| p[1].0 - p[0].0).collect();
        let (lo, hi) = steps
            .iter()
            .fold((f64::MAX, f64::MIN), |(lo, hi), s| (lo.min(*s), hi.max(*s)));
        (hi - lo <= tol).then(|| steps.iter().sum::<f64>() / steps.len() as f64)
    };
    let (pitch_x, pitch_y) = (pitches(&columns)?, pitches(&rows)?);
    let gap = |pitch: f64, side: f64, count: usize| -> Option<f64> {
        if count < 2 {
            return Some(0.0);
        }
        let g = pitch - side;
        if g < -tol {
            None // the objects overlap: not a grid of pieces
        } else {
            Some(if g < tol { 0.0 } else { g })
        }
    };
    let (gap_x, gap_y) = (
        gap(pitch_x, w, columns.len())?,
        gap(pitch_y, h, rows.len())?,
    );

    let nearest = |c: &[(f64, usize)], v: f64| -> usize {
        c.iter()
            .enumerate()
            .min_by(|a, b| (a.1 .0 - v).abs().total_cmp(&(b.1 .0 - v).abs()))
            .map(|(i, _)| i)
            .unwrap_or(0)
    };
    let cells: HashSet<(usize, usize)> = items
        .iter()
        .map(|r| (nearest(&rows, r.y), nearest(&columns, r.x)))
        .collect();
    let full = cells.len() == rows.len() * columns.len();

    let left = columns[0].0;
    let top = rows[0].0;
    let right = columns[columns.len() - 1].0 + w;
    let bottom = rows[rows.len() - 1].0 + h;
    let bounds = Rect::new(left, top, right - left, bottom - top);

    let mut notes = Vec::new();
    let mut confidence = COMPLETE;
    if !full {
        confidence -= MISSING_CELLS_PENALTY;
        notes.push(Note::MissingCells);
    }
    if cells.len() < 4 {
        confidence = confidence.min(FEW_OBJECTS_CAP);
        notes.push(Note::FewObjects);
    }
    if crop_marks_match(lines, bounds, &columns, &rows, w, h) {
        confidence = (confidence + CROP_MARKS_BONUS).min(CROP_MARKS_CAP);
        notes.push(Note::CropMarks);
    }
    Some(Proposal {
        kind: ProposalKind::Grid {
            bounds,
            rows: rows.len(),
            columns: columns.len(),
            source_gap_x_mm: pt_to_mm(gap_x),
            source_gap_y_mm: pt_to_mm(gap_y),
        },
        confidence,
        engine: "pdf-objects".into(),
        notes,
    })
}

/// Whether thin lines outside the block line up with the boundaries between pieces.
fn crop_marks_match(
    lines: &[&PageObject],
    bounds: Rect,
    columns: &[(f64, usize)],
    rows: &[(f64, usize)],
    w: f64,
    h: f64,
) -> bool {
    let tol = mm_to_pt(CROP_MARK_TOLERANCE_MM);
    let xs: Vec<f64> = columns.iter().flat_map(|c| [c.0, c.0 + w]).collect();
    let ys: Vec<f64> = rows.iter().flat_map(|r| [r.0, r.0 + h]).collect();
    let inside = |r: &Rect| {
        r.x >= bounds.x - tol
            && r.y >= bounds.y - tol
            && r.x + r.width <= bounds.x + bounds.width + tol
            && r.y + r.height <= bounds.y + bounds.height + tol
    };
    let matched = lines
        .iter()
        .filter(|l| !inside(&l.rect))
        .filter(|l| {
            let r = l.rect;
            if r.width < r.height {
                xs.iter().any(|x| (x - r.x - r.width / 2.0).abs() <= tol)
            } else {
                ys.iter().any(|y| (y - r.y - r.height / 2.0).abs() <= tol)
            }
        })
        .count();
    matched >= CROP_MARKS_NEEDED
}
