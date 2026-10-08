//! Engine 2: repeating edges, for flat pages where the pieces are one picture. Summing the edge
//! strength down every pixel column (and across every row) makes piece borders tall peaks at a
//! regular spacing, while the art averages out. The spacing comes from autocorrelation; the
//! model that explains the most peaks wins (cells touching, or separated by plain gaps).

use super::{
    Detector, EngineResult, GreyImage, Note, PageData, Proposal, ProposalKind, INFERRED_CAP,
};
use crate::geometry::Rect;
use crate::units::pt_to_mm;

const MIN_PIECE_MM: f64 = super::MIN_PIECE_MM;
/// Pixels within this distance (mm) of a predicted boundary count as on it.
const BOUNDARY_TOLERANCE_MM: f64 = 0.6;
/// Window (mm) of the moving average removed from a profile, so only sharp peaks are left.
const BASELINE_MM: f64 = 5.0;
/// In a gap layout the gap is plain: its activity is at most this share of the piece's.
const PLAIN_GAP_SHARE: f64 = 0.2;
/// Peaks closer than this (mm) are one edge: a printed line gives one on each side, and two
/// lines that meet look like a gap that is no wider than the lines. Real gaps are wider.
const MERGE_MM: f64 = 1.2;
/// A peak must reach this share of the strongest one.
const PEAK_SHARE: f64 = 0.2;
/// Autocorrelation below this is no pattern at all.
const MIN_CORRELATION: f64 = 0.25;
/// Pitch candidates: autocorrelation maxima at least this share of the best.
const CANDIDATE_SHARE: f64 = 0.5;
const MAX_CANDIDATES: usize = 6;
const ANCHORS: usize = 5;
/// A model scoring under this explains too little of the page's edges.
const MIN_MODEL_SCORE: f64 = 0.4;
/// Ink differs from the page background by more than this (grey levels).
const INK_LEVEL: i32 = 24;

pub struct EdgesEngine;

/// One axis of a grid, in pixels.
#[derive(Debug, Clone, Copy)]
struct AxisFit {
    start: f64,
    cell: f64,
    gap: f64,
    count: usize,
    /// Autocorrelation at the pitch, 0 to 1.
    strength: f64,
    /// Share of the predicted boundaries that have a peak.
    regularity: f64,
}

impl Detector for EdgesEngine {
    fn engine(&self) -> &'static str {
        "edges"
    }

    fn detect(&self, page: &PageData) -> EngineResult {
        let Some(img) = &page.grey else {
            return EngineResult::default();
        };
        if img.width < 32 || img.height < 32 {
            return EngineResult::default();
        }
        let ink = ink_extent(img);
        let (cols, rows) = profiles(img);
        let mm_per_px_x = pt_to_mm(img.pt_per_px_x);
        let mm_per_px_y = pt_to_mm(img.pt_per_px_y);
        let fit_x = fit_axis(&cols, mm_per_px_x);
        let fit_y = fit_axis(&rows, mm_per_px_y);
        if fit_x.is_none() && fit_y.is_none() {
            return EngineResult {
                proposals: Vec::new(),
                reasons: vec![Note::NoRegularPattern],
            };
        }

        // An axis with no repeating pattern is one cell across the ink.
        let single = |extent: (f64, f64)| AxisFit {
            start: extent.0,
            cell: extent.1 - extent.0,
            gap: 0.0,
            count: 1,
            strength: 0.5,
            regularity: 0.8,
        };
        let ink_x = (ink.0 as f64, ink.2 as f64 + 1.0);
        let ink_y = (ink.1 as f64, ink.3 as f64 + 1.0);
        let (fx, fy) = (
            fit_x.unwrap_or_else(|| single(ink_x)),
            fit_y.unwrap_or_else(|| single(ink_y)),
        );
        if fx.count * fy.count < 2 {
            return EngineResult::default();
        }

        let to_pt_x = |px: f64| px * img.pt_per_px_x;
        let to_pt_y = |px: f64| px * img.pt_per_px_y;
        let x1 = fx.start + fx.count as f64 * fx.cell + (fx.count - 1) as f64 * fx.gap;
        let y1 = fy.start + fy.count as f64 * fy.cell + (fy.count - 1) as f64 * fy.gap;
        let bounds = Rect::new(
            to_pt_x(fx.start),
            to_pt_y(fy.start),
            to_pt_x(x1 - fx.start),
            to_pt_y(y1 - fy.start),
        );

        let ink_area = ((ink_x.1 - ink_x.0) * (ink_y.1 - ink_y.0)).max(1.0);
        let coverage = ((x1 - fx.start) * (y1 - fy.start) / ink_area).min(1.0);
        let strength = (fx.strength + fy.strength) / 2.0;
        let regularity = (fx.regularity + fy.regularity) / 2.0;
        let confidence = (0.5 * strength + 0.3 * regularity + 0.2 * coverage).min(INFERRED_CAP);

        let mut notes = Vec::new();
        if fit_x.is_none() || fit_y.is_none() {
            notes.push(Note::FewObjects);
        }
        EngineResult {
            proposals: vec![Proposal {
                kind: ProposalKind::Grid {
                    bounds,
                    rows: fy.count,
                    columns: fx.count,
                    source_gap_x_mm: fx.gap * mm_per_px_x,
                    source_gap_y_mm: fy.gap * mm_per_px_y,
                },
                confidence,
                engine: "edges".into(),
                notes,
            }],
            reasons: Vec::new(),
        }
    }
}

/// The box of the pixels that differ from the page background (the median of the page border):
/// `(x0, y0, x1, y1)`, inclusive. The whole image when nothing differs.
fn ink_extent(img: &GreyImage) -> (usize, usize, usize, usize) {
    let mut border: Vec<u8> = Vec::new();
    let m = (img.width.min(img.height) / 50).max(1);
    for y in 0..img.height {
        for x in 0..img.width {
            if x < m || y < m || x >= img.width - m || y >= img.height - m {
                border.push(img.at(x, y));
            }
        }
    }
    border.sort_unstable();
    let background = border[border.len() / 2] as i32;
    let (mut x0, mut y0, mut x1, mut y1) = (img.width, img.height, 0, 0);
    for y in 0..img.height {
        for x in 0..img.width {
            if (img.at(x, y) as i32 - background).abs() > INK_LEVEL {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
        }
    }
    if x1 < x0 || y1 < y0 {
        (0, 0, img.width - 1, img.height - 1)
    } else {
        (x0, y0, x1, y1)
    }
}

/// Edge strength summed down every column and across every row.
fn profiles(img: &GreyImage) -> (Vec<f64>, Vec<f64>) {
    let (w, h) = (img.width, img.height);
    let mut cols = vec![0.0; w];
    let mut rows = vec![0.0; h];
    for (y, row) in rows.iter_mut().enumerate() {
        for (x, col) in cols.iter_mut().enumerate() {
            let left = img.at(x.saturating_sub(1), y) as f64;
            let right = img.at((x + 1).min(w - 1), y) as f64;
            *col += (right - left).abs();
            let up = img.at(x, y.saturating_sub(1)) as f64;
            let down = img.at(x, (y + 1).min(h - 1)) as f64;
            *row += (down - up).abs();
        }
    }
    (cols, rows)
}

/// The profile with its slow envelope removed and negatives cut: what is left are sharp peaks.
fn sharpen(p: &[f64], window: usize) -> Vec<f64> {
    let n = p.len();
    let mut prefix = vec![0.0; n + 1];
    for i in 0..n {
        prefix[i + 1] = prefix[i] + p[i];
    }
    (0..n)
        .map(|i| {
            let (a, b) = (i.saturating_sub(window), (i + window + 1).min(n));
            (p[i] - (prefix[b] - prefix[a]) / (b - a) as f64).max(0.0)
        })
        .collect()
}

/// Pearson correlation of the profile with itself shifted by `lag`.
fn correlation(p: &[f64], lag: usize) -> f64 {
    let n = p.len() - lag;
    if n < 8 {
        return 0.0;
    }
    let (a, b) = (&p[..n], &p[lag..]);
    let (ma, mb) = (
        a.iter().sum::<f64>() / n as f64,
        b.iter().sum::<f64>() / n as f64,
    );
    let (mut cov, mut va, mut vb) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let (x, y) = (a[i] - ma, b[i] - mb);
        cov += x * y;
        va += x * x;
        vb += y * y;
    }
    if va <= 0.0 || vb <= 0.0 {
        0.0
    } else {
        cov / (va * vb).sqrt()
    }
}

fn parabola(l: f64, c: f64, r: f64) -> f64 {
    let d = l - 2.0 * c + r;
    if d.abs() < 1e-12 {
        0.0
    } else {
        (0.5 * (l - r) / d).clamp(-0.5, 0.5)
    }
}

/// Local maxima of `p` that reach `PEAK_SHARE` of the strongest, as `(position, height)` with the
/// position refined below a pixel. Position is the continuous coordinate of the edge.
fn peaks(p: &[f64]) -> Vec<(f64, f64)> {
    let max = p.iter().cloned().fold(0.0, f64::max);
    if max <= 0.0 {
        return Vec::new();
    }
    let mut out = Vec::new();
    for i in 1..p.len() - 1 {
        if p[i] >= PEAK_SHARE * max && p[i] >= p[i - 1] && p[i] > p[i + 1] {
            let shift = parabola(p[i - 1], p[i], p[i + 1]);
            out.push((i as f64 + shift + 0.5, p[i]));
        }
    }
    // Plateaus give two neighbours; keep the taller of peaks closer than a pixel and a half.
    out.dedup_by(|b, a| {
        if (b.0 - a.0).abs() < 1.5 {
            if b.1 > a.1 {
                *a = *b;
            }
            true
        } else {
            false
        }
    });
    out
}

/// Peaks within `distance` of each other become one at their height-weighted centre, with the
/// sum of their heights.
fn merge_close(found: Vec<(f64, f64)>, distance: f64) -> Vec<(f64, f64)> {
    let mut out: Vec<(f64, f64, f64)> = Vec::new(); // (sum of position * height, height, last position)
    for (pos, height) in found {
        match out.last_mut() {
            Some(g) if pos - g.2 <= distance => {
                g.0 += pos * height;
                g.1 += height;
                g.2 = pos;
            }
            _ => out.push((pos * height, height, pos)),
        }
    }
    out.into_iter().map(|(w, h, _)| (w / h, h)).collect()
}

/// A model of one axis: boundaries at `anchor + k * pitch` and, for cells separated by gaps, a
/// second set at `anchor + offset + k * pitch`.
struct Model {
    anchor: f64,
    pitch: f64,
    offset: Option<f64>,
}

impl Model {
    fn boundaries(&self, len: f64) -> Vec<f64> {
        let mut out = Vec::new();
        let k0 = (-self.anchor / self.pitch).floor() as i64 - 1;
        let k1 = ((len - self.anchor) / self.pitch).ceil() as i64 + 1;
        for k in k0..=k1 {
            let a = self.anchor + k as f64 * self.pitch;
            out.push(a);
            if let Some(o) = self.offset {
                out.push(a + o);
            }
        }
        out.retain(|b| *b >= 0.0 && *b <= len);
        out.sort_by(|a, b| a.total_cmp(b));
        out
    }
}

/// Fits `anchor + k * pitch` to the peaks the comb lands near, by least squares, a few times over:
/// the autocorrelation gives the pitch only to a fraction of a pixel, which adds up over a page.
fn refine(anchor: f64, pitch: f64, found: &[(f64, f64)], tol: f64, len: f64) -> (f64, f64) {
    let (mut anchor, mut pitch) = (anchor, pitch);
    for _ in 0..4 {
        let comb = Model {
            anchor,
            pitch,
            offset: None,
        };
        let points: Vec<(f64, f64)> = comb
            .boundaries(len)
            .iter()
            .filter_map(|b| {
                let k = ((b - anchor) / pitch).round();
                found
                    .iter()
                    .filter(|p| (p.0 - b).abs() <= 2.0 * tol)
                    .min_by(|x, y| (x.0 - b).abs().total_cmp(&(y.0 - b).abs()))
                    .map(|p| (k, p.0))
            })
            .collect();
        if points.len() < 3 {
            break;
        }
        let n = points.len() as f64;
        let (sk, sp) = points
            .iter()
            .fold((0.0, 0.0), |a, p| (a.0 + p.0, a.1 + p.1));
        let (mk, mp) = (sk / n, sp / n);
        let (num, den) = points.iter().fold((0.0, 0.0), |a, p| {
            (a.0 + (p.0 - mk) * (p.1 - mp), a.1 + (p.0 - mk) * (p.0 - mk))
        });
        if den <= 0.0 {
            break;
        }
        pitch = num / den;
        anchor = mp - pitch * mk;
    }
    (anchor, pitch)
}

/// How well `model` explains the peaks: the boundaries from the first to the last one that has a
/// peak (the run), with the share of them that do and the share of the peaks in the run that
/// they explain. Returns `(score, hit share, first, last)` over boundary indexes.
fn score(model: &Model, peaks: &[(f64, f64)], tol: f64, len: f64) -> (f64, f64, Vec<f64>) {
    let boundaries = model.boundaries(len);
    let hit = |b: f64| peaks.iter().any(|p| (p.0 - b).abs() <= tol);
    let Some(first) = boundaries.iter().position(|b| hit(*b)) else {
        return (0.0, 0.0, Vec::new());
    };
    let last = boundaries.iter().rposition(|b| hit(*b)).unwrap_or(first);
    let run = &boundaries[first..=last];
    let hits = run.iter().filter(|b| hit(**b)).count();
    let hit_share = hits as f64 / run.len() as f64;
    let (lo, hi) = (run[0] - tol, run[run.len() - 1] + tol);
    let in_run: f64 = peaks
        .iter()
        .filter(|p| p.0 >= lo && p.0 <= hi)
        .map(|p| p.1)
        .sum();
    let explained: f64 = peaks
        .iter()
        .filter(|p| run.iter().any(|b| (p.0 - b).abs() <= tol))
        .map(|p| p.1)
        .sum();
    let explained_share = if in_run > 0.0 {
        explained / in_run
    } else {
        0.0
    };
    (hit_share * explained_share, hit_share, run.to_vec())
}

/// Mean of the raw profile between `a` and `b`, leaving `margin` out at each end; `f64::MAX` when
/// the interval is empty or outside the profile.
fn activity(profile: &[f64], a: f64, b: f64, margin: f64) -> f64 {
    let (lo, hi) = ((a + margin).ceil(), (b - margin).floor());
    if lo < 0.0 || hi <= lo || hi as usize >= profile.len() {
        return f64::MAX;
    }
    let (lo, hi) = (lo as usize, hi as usize);
    profile[lo..=hi].iter().sum::<f64>() / (hi - lo + 1) as f64
}

/// The position of the peak nearest `x` within `tol`, else `x`.
fn snap(found: &[(f64, f64)], x: f64, tol: f64) -> f64 {
    found
        .iter()
        .filter(|p| (p.0 - x).abs() <= tol)
        .min_by(|a, b| (a.0 - x).abs().total_cmp(&(b.0 - x).abs()))
        .map_or(x, |p| p.0)
}

/// For a model with two edges per pitch: which interval is a piece, from how busy the two are over
/// the run. `None` when neither is plain enough to be a gap. `Some(true)` means the interval from
/// the anchor comb to the offset comb is the piece.
fn gap_side(
    profile: &[f64],
    model: &Model,
    run: &[f64],
    offset: f64,
    tol: f64,
    typical_peak: f64,
) -> Option<bool> {
    let (mut first, mut second) = (0.0, 0.0);
    for b in run {
        let phase = (b - model.anchor).rem_euclid(model.pitch);
        if phase > tol && model.pitch - phase > tol {
            continue; // a boundary of the other comb
        }
        let (a, c) = (
            activity(profile, *b, b + offset, tol),
            activity(profile, b + offset, b + model.pitch, tol),
        );
        if a != f64::MAX && c != f64::MAX {
            first += a;
            second += c;
        }
    }
    let (low, high) = (first.min(second), first.max(second));
    if high <= 0.02 * typical_peak {
        // Both flat: a gap is narrower than a piece.
        return Some(offset >= model.pitch - offset);
    }
    (low <= PLAIN_GAP_SHARE * high).then_some(first >= second)
}

/// Finds the repeating pattern along one axis of the edge profile, if there is one.
fn fit_axis(profile: &[f64], mm_per_px: f64) -> Option<AxisFit> {
    let n = profile.len();
    let px_per_mm = 1.0 / mm_per_px;
    let baseline = (BASELINE_MM * px_per_mm).round().max(3.0) as usize;
    let sharp = sharpen(profile, baseline);
    let tol = (BOUNDARY_TOLERANCE_MM * px_per_mm).max(1.5);
    let found = merge_close(peaks(&sharp), MERGE_MM * px_per_mm);
    if found.len() < 3 {
        return None;
    }
    let typical_peak = found.iter().map(|p| p.1).sum::<f64>() / found.len() as f64;

    // Candidate pitches: the best autocorrelation maxima.
    let min_lag = (MIN_PIECE_MM * px_per_mm).round() as usize;
    let max_lag = (n as f64 * 0.6) as usize;
    if min_lag + 3 >= max_lag {
        return None;
    }
    let corr: Vec<f64> = (0..=max_lag + 1)
        .map(|lag| {
            if lag < min_lag - 1 {
                0.0
            } else {
                correlation(&sharp, lag)
            }
        })
        .collect();
    let best = corr.iter().cloned().fold(0.0, f64::max);
    if best < MIN_CORRELATION {
        return None;
    }
    let mut lags: Vec<(usize, f64)> = (min_lag..=max_lag)
        .filter(|&l| {
            corr[l] >= CANDIDATE_SHARE * best && corr[l] >= corr[l - 1] && corr[l] > corr[l + 1]
        })
        .map(|l| (l, corr[l]))
        .collect();
    lags.sort_by(|a, b| b.1.total_cmp(&a.1));
    lags.truncate(MAX_CANDIDATES);

    let mut anchors: Vec<(f64, f64)> = found.clone();
    anchors.sort_by(|a, b| b.1.total_cmp(&a.1));
    anchors.truncate(ANCHORS);

    let len = n as f64;
    struct Winner {
        score: f64,
        model: Model,
        strength: f64,
        hit_share: f64,
        run: Vec<f64>,
        piece_first: bool,
    }
    let mut winner: Option<Winner> = None;
    for &(lag, c) in &lags {
        let pitch0 = lag as f64 + parabola(corr[lag - 1], corr[lag], corr[lag + 1]);
        for &(anchor0, _) in &anchors {
            let (anchor, pitch) = refine(anchor0, pitch0, &found, tol, len);
            // Single comb: pieces touch.
            let mut options = vec![Model {
                anchor,
                pitch,
                offset: None,
            }];
            // With gaps there are two edges per pitch: the offset is where the peaks that the
            // single comb does not explain fall, modulo the pitch.
            let mut offsets: Vec<f64> = found
                .iter()
                .map(|p| (p.0 - anchor).rem_euclid(pitch))
                .filter(|o| *o > tol && pitch - *o > tol)
                .collect();
            offsets.sort_by(|a, b| a.total_cmp(b));
            let mut tried: Vec<f64> = Vec::new();
            for o in offsets {
                if tried.iter().all(|t| (t - o).abs() > tol) {
                    tried.push(o);
                    options.push(Model {
                        anchor,
                        pitch,
                        offset: Some(o),
                    });
                }
            }
            for model in options {
                let (s, hit_share, run) = score(&model, &found, tol, len);
                if run.len() < 3 {
                    continue;
                }
                // Two edges per pitch only count when one of the intervals is a plain gap.
                let mut piece_first = true;
                if let Some(o) = model.offset {
                    match gap_side(profile, &model, &run, o, tol, typical_peak) {
                        Some(side) => piece_first = side,
                        None => continue,
                    }
                }
                // Prefer the plainer model on a near tie.
                let s = s - if model.offset.is_some() { 0.01 } else { 0.0 };
                if s > winner.as_ref().map_or(0.0, |w| w.score) {
                    winner = Some(Winner {
                        score: s,
                        model,
                        strength: c,
                        hit_share,
                        run,
                        piece_first,
                    });
                }
            }
        }
    }
    let w = winner?;
    if w.score < MIN_MODEL_SCORE {
        return None;
    }
    let (strength, regularity) = (w.strength.clamp(0.0, 1.0), w.hit_share);

    match w.model.offset {
        None => {
            // Pieces touch: the boundaries snapped to the peaks they are on.
            let edges: Vec<f64> = w.run.iter().map(|b| snap(&found, *b, tol)).collect();
            let count = edges.len() - 1;
            let (start, end) = (edges[0], edges[count]);
            Some(AxisFit {
                start,
                cell: (end - start) / count as f64,
                gap: 0.0,
                count,
                strength,
                regularity,
            })
        }
        Some(offset) => {
            // A piece starts at a boundary of the comb it follows, and ends `cell` later.
            let cell = if w.piece_first {
                offset
            } else {
                w.model.pitch - offset
            };
            let left_phase = if w.piece_first { 0.0 } else { offset };
            let lefts: Vec<f64> = w
                .run
                .iter()
                .cloned()
                .filter(|b| {
                    let phase = (b - w.model.anchor - left_phase).rem_euclid(w.model.pitch);
                    phase < tol || w.model.pitch - phase < tol
                })
                .filter(|l| w.run.iter().any(|r| (r - (l + cell)).abs() <= tol))
                .map(|l| snap(&found, l, tol))
                .collect();
            let count = lefts.len();
            if count == 0 {
                return None;
            }
            let rights: Vec<f64> = lefts.iter().map(|l| snap(&found, l + cell, tol)).collect();
            let cell = lefts.iter().zip(&rights).map(|(l, r)| r - l).sum::<f64>() / count as f64;
            let start = lefts[0];
            let end = rights[count - 1];
            let gap = if count > 1 {
                (end - start - count as f64 * cell) / (count - 1) as f64
            } else {
                w.model.pitch - cell
            };
            Some(AxisFit {
                start,
                cell,
                gap,
                count,
                strength,
                regularity,
            })
        }
    }
}
