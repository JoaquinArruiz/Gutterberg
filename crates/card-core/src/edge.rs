//! The colour of a piece's edge, for the `Edge` bleed: where to look (a band just inside the
//! piece's edge) and what colour wins (the most common one there). The render that supplies the
//! pixels is in `render::edge_colors_in`; this part needs no pdfium.

use crate::card::OrientedRect;
use crate::geometry::Point;

/// Points sampled along each side of the band.
const ALONG: usize = 24;
/// The band, as fractions of the piece's shorter side measured in from its edge.
const DEPTHS: [f64; 3] = [0.03, 0.05, 0.07];

/// Points (same space as `rect`) in a thin band just inside each edge of `rect`, away from the
/// corners, which are often rounded or empty.
pub fn band_points(rect: &OrientedRect) -> Vec<Point> {
    let (sin, cos) = rect.angle_deg.to_radians().sin_cos();
    let (hw, hh) = (rect.width / 2.0, rect.height / 2.0);
    let short = rect.width.min(rect.height);
    let at = |lu: f64, lv: f64| Point {
        x: rect.center.x + lu * cos - lv * sin,
        y: rect.center.y + lu * sin + lv * cos,
    };
    let mut points = Vec::with_capacity(ALONG * DEPTHS.len() * 4);
    for depth in DEPTHS.map(|d| d * short) {
        for i in 0..ALONG {
            // From 10% to 90% along the side.
            let t = 0.1 + 0.8 * (i as f64 + 0.5) / ALONG as f64;
            let (u, v) = (-hw + t * rect.width, -hh + t * rect.height);
            points.extend([
                at(u, -hh + depth),
                at(u, hh - depth),
                at(-hw + depth, v),
                at(hw - depth, v),
            ]);
        }
    }
    points
}

/// The most common colour of `samples`, after grouping colours that differ only a little, as the
/// average of that group. White when there are none.
pub fn dominant_color(samples: &[[u8; 3]]) -> [u8; 3] {
    let bucket = |c: &[u8; 3]| c.map(|v| v >> 4);
    let mut counts: std::collections::HashMap<[u8; 3], usize> = Default::default();
    for c in samples {
        *counts.entry(bucket(c)).or_default() += 1;
    }
    // Ties go to the darker group, so the order of a hash map never decides.
    let Some(best) = counts
        .into_iter()
        .max_by_key(|(b, n)| (*n, std::cmp::Reverse(b.map(u32::from).iter().sum::<u32>())))
        .map(|(b, _)| b)
    else {
        return [255, 255, 255];
    };
    let chosen: Vec<&[u8; 3]> = samples.iter().filter(|c| bucket(c) == best).collect();
    let mean = |i: usize| {
        let sum: usize = chosen.iter().map(|c| usize::from(c[i])).sum();
        ((sum + chosen.len() / 2) / chosen.len()) as u8
    };
    [mean(0), mean(1), mean(2)]
}
