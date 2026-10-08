//! Engine 3: blobs, for scans and loose pieces on a plain background. The background is the
//! tone along the page border; whatever differs from it is cut into connected blobs, and the
//! smallest rotated rectangle around each blob is one piece, tilt included.

use super::{
    Detector, EngineResult, GreyImage, Note, PageData, Proposal, ProposalKind, INFERRED_CAP,
    PAGE_FRACTION,
};
use crate::card::OrientedRect;
use crate::geometry::Point;
use crate::units::mm_to_pt;

/// The background must differ from the foreground by at least this many grey levels.
const MIN_CONTRAST: f64 = 40.0;
/// A blob whose hull fills less of its rectangle than this is not a clean piece.
const CLEAN_FILL: f64 = 0.85;
/// Fill that counts as a perfect score; the score falls to 0 at `FILL_FLOOR`.
const FILL_PERFECT: f64 = 0.95;
const FILL_FLOOR: f64 = 0.75;
/// Sizes within this spread (share of the median) count as consistent.
const SIZE_SPREAD: f64 = 0.05;
const EDGE_FACTOR: f64 = 0.7;
const SINGLE_FACTOR: f64 = 0.6;
const UNCLEAN_FACTOR: f64 = 0.6;

pub struct BlobsEngine;

impl Detector for BlobsEngine {
    fn engine(&self) -> &'static str {
        "blobs"
    }

    fn detect(&self, page: &PageData) -> EngineResult {
        let Some(img) = &page.grey else {
            return EngineResult::default();
        };
        let Some(mask) = foreground(img) else {
            return EngineResult::default();
        };
        let (w, h) = (img.width, img.height);
        let mask = close(&open(&mask, w, h), w, h);
        let scale = img.pt_per_px_x;
        let min_side = mm_to_pt(super::MIN_PIECE_MM) / scale;
        let (page_w, page_h) = (page.size.width_pt / scale, page.size.height_pt / scale);

        let mut clean: Vec<(OrientedRect, f64, bool)> = Vec::new();
        let (mut unclean, mut page_sized) = (0usize, 0usize);
        for blob in components(&mask, w, h) {
            if blob.bounds.2 < min_side || blob.bounds.3 < min_side {
                continue;
            }
            if blob.bounds.2 > PAGE_FRACTION * page_w && blob.bounds.3 > PAGE_FRACTION * page_h {
                page_sized += 1;
                continue;
            }
            let hull = convex_hull(blob.outline);
            let Some(rect) = min_area_rect(&hull) else {
                continue;
            };
            let fill = polygon_area(&hull) / (rect.width * rect.height).max(1e-9);
            if rect.width < min_side || rect.height < min_side {
                continue;
            }
            if fill < CLEAN_FILL {
                unclean += 1;
                continue;
            }
            let touches = blob.touches_edge;
            clean.push((rect, fill, touches));
        }

        if clean.is_empty() {
            let reasons = if unclean + page_sized > 0 {
                vec![Note::MergedPieces]
            } else {
                Vec::new()
            };
            return EngineResult {
                proposals: Vec::new(),
                reasons,
            };
        }

        let mean_score = clean
            .iter()
            .map(|(_, fill, _)| ((fill - FILL_FLOOR) / (FILL_PERFECT - FILL_FLOOR)).clamp(0.0, 1.0))
            .sum::<f64>()
            / clean.len() as f64;
        let mut sizes: Vec<f64> = clean
            .iter()
            .map(|(r, _, _)| r.width.max(r.height))
            .collect();
        sizes.sort_by(|a, b| a.total_cmp(b));
        let median = sizes[sizes.len() / 2];
        let spread = (sizes[sizes.len() - 1] - sizes[0]) / median;
        let consistency = if spread <= SIZE_SPREAD {
            1.0
        } else {
            (1.0 - (spread - SIZE_SPREAD)).max(0.8)
        };

        let mut notes = Vec::new();
        let mut confidence = mean_score * consistency;
        if spread > SIZE_SPREAD {
            notes.push(Note::UnevenSizes);
        }
        if clean.len() == 1 {
            confidence *= SINGLE_FACTOR;
            notes.push(Note::OnePiece);
        }
        if clean.iter().any(|(_, _, t)| *t) {
            confidence *= EDGE_FACTOR;
            notes.push(Note::TouchesEdge);
        }
        if unclean > 0 {
            confidence *= UNCLEAN_FACTOR;
            notes.push(Note::MergedPieces);
        }

        let mut rects: Vec<OrientedRect> = clean
            .into_iter()
            .map(|(r, _, _)| OrientedRect {
                center: Point {
                    x: r.center.x * scale,
                    y: r.center.y * scale,
                },
                width: r.width * scale,
                height: r.height * scale,
                angle_deg: r.angle_deg,
            })
            .collect();
        reading_order(&mut rects);
        EngineResult {
            proposals: vec![Proposal {
                kind: ProposalKind::Rects { rects },
                confidence: confidence.min(INFERRED_CAP),
                engine: "blobs".into(),
                notes,
            }],
            reasons: Vec::new(),
        }
    }
}

/// Rows from top to bottom, each left to right.
fn reading_order(rects: &mut [OrientedRect]) {
    rects.sort_by(|a, b| a.center.y.total_cmp(&b.center.y));
    let mut heights: Vec<f64> = rects.iter().map(|r| r.height.min(r.width)).collect();
    heights.sort_by(|a, b| a.total_cmp(b));
    let band = heights[heights.len() / 2] * 0.5;
    let mut start = 0;
    while start < rects.len() {
        let top = rects[start].center.y;
        let mut end = start;
        while end < rects.len() && rects[end].center.y - top <= band {
            end += 1;
        }
        rects[start..end].sort_by(|a, b| a.center.x.total_cmp(&b.center.x));
        start = end;
    }
}

/// Pixels that differ from the background tone, or None when the page has no clear foreground.
fn foreground(img: &GreyImage) -> Option<Vec<bool>> {
    let (w, h) = (img.width, img.height);
    let m = (w.min(h) / 50).max(1);
    let mut border: Vec<u8> = Vec::new();
    for y in 0..h {
        for x in 0..w {
            if x < m || y < m || x >= w - m || y >= h - m {
                border.push(img.at(x, y));
            }
        }
    }
    border.sort_unstable();
    let background = border[border.len() / 2] as i32;
    let diff: Vec<u8> = img
        .data
        .iter()
        .map(|v| (*v as i32 - background).unsigned_abs().min(255) as u8)
        .collect();

    // Otsu's threshold on the difference.
    let mut histogram = [0f64; 256];
    for d in &diff {
        histogram[*d as usize] += 1.0;
    }
    let total: f64 = histogram.iter().sum();
    let sum_all: f64 = histogram
        .iter()
        .enumerate()
        .map(|(i, c)| i as f64 * c)
        .sum();
    let (mut weight_b, mut sum_b, mut best, mut threshold) = (0.0, 0.0, 0.0, 0usize);
    for (t, count) in histogram.iter().enumerate() {
        weight_b += count;
        if weight_b == 0.0 {
            continue;
        }
        let weight_f = total - weight_b;
        if weight_f == 0.0 {
            break;
        }
        sum_b += t as f64 * count;
        let (mean_b, mean_f) = (sum_b / weight_b, (sum_all - sum_b) / weight_f);
        let between = weight_b * weight_f * (mean_b - mean_f) * (mean_b - mean_f);
        if between > best {
            best = between;
            threshold = t;
        }
    }
    let max = diff.iter().copied().max().unwrap_or(0) as f64;
    if max < MIN_CONTRAST {
        return None;
    }
    // Never so low that scanner noise is foreground.
    let threshold = threshold.max((MIN_CONTRAST / 2.0) as usize);
    Some(diff.iter().map(|d| *d as usize > threshold).collect())
}

/// 3x3 dilation (`grow`) or erosion of a mask.
fn morph(mask: &[bool], w: usize, h: usize, grow: bool) -> Vec<bool> {
    let pass = |src: &[bool], horizontal: bool| -> Vec<bool> {
        let mut out = vec![false; src.len()];
        for y in 0..h {
            for x in 0..w {
                let at = |dx: isize, dy: isize| -> bool {
                    let (nx, ny) = (x as isize + dx, y as isize + dy);
                    if nx < 0 || ny < 0 || nx >= w as isize || ny >= h as isize {
                        // Outside the image is background for erosion and nothing for dilation.
                        return false;
                    }
                    src[ny as usize * w + nx as usize]
                };
                let (a, b, c) = if horizontal {
                    (at(-1, 0), at(0, 0), at(1, 0))
                } else {
                    (at(0, -1), at(0, 0), at(0, 1))
                };
                out[y * w + x] = if grow { a || b || c } else { a && b && c };
            }
        }
        out
    };
    pass(&pass(mask, true), false)
}

/// Removes specks: erode, then dilate.
fn open(mask: &[bool], w: usize, h: usize) -> Vec<bool> {
    morph(&morph(mask, w, h, false), w, h, true)
}

/// Fills hairline gaps and holes: dilate, then erode.
fn close(mask: &[bool], w: usize, h: usize) -> Vec<bool> {
    morph(&morph(mask, w, h, true), w, h, false)
}

struct Blob {
    /// Corners of the pixels on the blob's boundary.
    outline: Vec<(f64, f64)>,
    /// `(x, y, width, height)` in pixels.
    bounds: (f64, f64, f64, f64),
    touches_edge: bool,
}

/// 4-connected components of the mask.
fn components(mask: &[bool], w: usize, h: usize) -> Vec<Blob> {
    let mut seen = vec![false; mask.len()];
    let mut blobs = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    for start in 0..mask.len() {
        if !mask[start] || seen[start] {
            continue;
        }
        let mut outline = Vec::new();
        let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0usize, 0usize);
        stack.push(start);
        seen[start] = true;
        while let Some(i) = stack.pop() {
            let (x, y) = (i % w, i / w);
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
            let mut boundary = false;
            for (dx, dy) in [(-1isize, 0isize), (1, 0), (0, -1), (0, 1)] {
                let (nx, ny) = (x as isize + dx, y as isize + dy);
                if nx < 0 || ny < 0 || nx >= w as isize || ny >= h as isize {
                    boundary = true;
                    continue;
                }
                let j = ny as usize * w + nx as usize;
                if !mask[j] {
                    boundary = true;
                } else if !seen[j] {
                    seen[j] = true;
                    stack.push(j);
                }
            }
            if boundary {
                let (fx, fy) = (x as f64, y as f64);
                outline.extend([
                    (fx, fy),
                    (fx + 1.0, fy),
                    (fx, fy + 1.0),
                    (fx + 1.0, fy + 1.0),
                ]);
            }
        }
        blobs.push(Blob {
            outline,
            bounds: (
                x0 as f64,
                y0 as f64,
                (x1 - x0 + 1) as f64,
                (y1 - y0 + 1) as f64,
            ),
            touches_edge: x0 == 0 || y0 == 0 || x1 == w - 1 || y1 == h - 1,
        });
    }
    blobs
}

fn cross(o: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0)
}

/// Andrew's monotone chain; the hull in order, without repeating the first point.
fn convex_hull(mut points: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    points.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    points.dedup();
    if points.len() < 3 {
        return points;
    }
    let mut hull: Vec<(f64, f64)> = Vec::new();
    for pass in 0..2 {
        let start = hull.len();
        let iter: Box<dyn Iterator<Item = &(f64, f64)>> = if pass == 0 {
            Box::new(points.iter())
        } else {
            Box::new(points.iter().rev())
        };
        for &p in iter {
            while hull.len() >= start + 2
                && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0
            {
                hull.pop();
            }
            hull.push(p);
        }
        hull.pop();
    }
    hull
}

fn polygon_area(p: &[(f64, f64)]) -> f64 {
    let mut a = 0.0;
    for i in 0..p.len() {
        let (x0, y0) = p[i];
        let (x1, y1) = p[(i + 1) % p.len()];
        a += x0 * y1 - x1 * y0;
    }
    a.abs() / 2.0
}

/// The smallest rectangle around a convex polygon (rotating calipers over its edges), as an
/// `OrientedRect` in the polygon's units with the angle in -45..=45 degrees (clockwise with y down).
fn min_area_rect(hull: &[(f64, f64)]) -> Option<OrientedRect> {
    if hull.len() < 3 {
        return None;
    }
    let mut best: Option<(f64, OrientedRect)> = None;
    for i in 0..hull.len() {
        let (a, b) = (hull[i], hull[(i + 1) % hull.len()]);
        let len = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
        if len < 1e-9 {
            continue;
        }
        let u = ((b.0 - a.0) / len, (b.1 - a.1) / len);
        let v = (-u.1, u.0);
        let (mut u0, mut u1, mut v0, mut v1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for p in hull {
            let pu = p.0 * u.0 + p.1 * u.1;
            let pv = p.0 * v.0 + p.1 * v.1;
            u0 = u0.min(pu);
            u1 = u1.max(pu);
            v0 = v0.min(pv);
            v1 = v1.max(pv);
        }
        let (mut width, mut height) = (u1 - u0, v1 - v0);
        let (cu, cv) = ((u0 + u1) / 2.0, (v0 + v1) / 2.0);
        let center = Point {
            x: cu * u.0 + cv * v.0,
            y: cu * u.1 + cv * v.1,
        };
        let mut angle = u.1.atan2(u.0).to_degrees();
        // Width along the nearer axis, angle within 45 degrees of it.
        while angle > 45.0 {
            angle -= 90.0;
            std::mem::swap(&mut width, &mut height);
        }
        while angle < -45.0 {
            angle += 90.0;
            std::mem::swap(&mut width, &mut height);
        }
        let area = width * height;
        if best.as_ref().is_none_or(|(a, _)| area < *a) {
            best = Some((
                area,
                OrientedRect {
                    center,
                    width,
                    height,
                    angle_deg: angle,
                },
            ));
        }
    }
    best.map(|(_, r)| r)
}
