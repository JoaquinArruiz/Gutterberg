//! The strong straight edges of a page, for sticky snapping: the lines a region's or a piece's side
//! should stick to while it is drawn, moved or resized. Unlike the engines this proposes nothing; it
//! only lists where the edges are.
//!
//! Two sources, in points with a top-left origin, in the page as displayed:
//! - the sides of the page's drawn rectangles and images and its cut lines, which are exact;
//! - long runs of strong contrast in the grey render, for flat pictures and scans. Art inside a
//!   piece makes short runs and is dropped; piece borders and cut lines make long ones.

use super::{GreyImage, ObjectKind, PageData};
use crate::geometry::PageSize;
use crate::units::{mm_to_pt, pt_to_mm};
use serde::{Deserialize, Serialize};

/// Shortest edge kept (mm): anything shorter is art.
pub const MIN_EDGE_MM: f64 = 5.0;
/// Most edges kept per axis, the strongest first, so the answer stays small.
pub const MAX_EDGES_PER_AXIS: usize = 300;
/// A step of at least this many grey levels across a pixel counts as contrast.
const MIN_CONTRAST: i32 = 32;
/// Runs this close across (pixels) are one edge; the positions of one edge spread no further.
const MERGE_PX: f64 = 2.0;
/// Pixels a run may miss along its length (noise in a scan) without breaking.
const GAP_PX: usize = 1;
/// Runs shorter than this (pixels) are not looked at, before merging.
const MIN_RUN_PX: usize = 3;
/// Object sides closer than this (points) across are one edge.
const OBJECT_TOLERANCE_PT: f64 = 0.3;
/// A render edge this long (mm) or longer is at full strength, given full contrast.
const FULL_LENGTH_MM: f64 = 50.0;

/// An edge running down the page at `x`, from `y0` to `y1`. Points, top-left origin.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct VerticalEdge {
    pub x: f64,
    pub y0: f64,
    pub y1: f64,
    /// 0 to 1: the sides of objects are 1, a render edge by its contrast and length.
    pub strength: f64,
}

/// An edge running across the page at `y`, from `x0` to `x1`. Points, top-left origin.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct HorizontalEdge {
    pub y: f64,
    pub x0: f64,
    pub x1: f64,
    pub strength: f64,
}

/// The straight edges of a page, at most [`MAX_EDGES_PER_AXIS`] of each, in reading order.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PageEdges {
    pub vertical: Vec<VerticalEdge>,
    pub horizontal: Vec<HorizontalEdge>,
}

/// An edge along one axis: `at` across it, `from..to` along it.
#[derive(Debug, Clone, Copy)]
struct Line {
    at: f64,
    from: f64,
    to: f64,
    strength: f64,
}

impl Line {
    fn length(&self) -> f64 {
        self.to - self.from
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Axis {
    /// Edges that run down the page: across is x.
    Vertical,
    /// Edges that run across the page: across is y.
    Horizontal,
}

/// The strong straight edges of `page`: the sides of its objects, then the long contrast runs of its
/// grey render that no object explains.
pub fn page_edges(page: &PageData) -> PageEdges {
    let mut out = [Axis::Vertical, Axis::Horizontal].map(|axis| {
        let mut lines = object_lines(page, axis);
        if let Some(img) = &page.grey {
            let across_pt = match axis {
                Axis::Vertical => img.pt_per_px_x,
                Axis::Horizontal => img.pt_per_px_y,
            };
            let near = MERGE_PX * across_pt;
            let known = lines.clone();
            lines.extend(render_lines(img, axis).into_iter().filter(|r| {
                let mid = (r.from + r.to) / 2.0;
                !known.iter().any(|o| {
                    (o.at - r.at).abs() <= near && o.from - near <= mid && mid <= o.to + near
                })
            }));
        }
        strongest(lines)
    });
    let horizontal = std::mem::take(&mut out[1]);
    let vertical = std::mem::take(&mut out[0]);
    PageEdges {
        vertical: vertical
            .into_iter()
            .map(|l| VerticalEdge {
                x: l.at,
                y0: l.from,
                y1: l.to,
                strength: l.strength,
            })
            .collect(),
        horizontal: horizontal
            .into_iter()
            .map(|l| HorizontalEdge {
                y: l.at,
                x0: l.from,
                x1: l.to,
                strength: l.strength,
            })
            .collect(),
    }
}

/// The [`MAX_EDGES_PER_AXIS`] strongest (then longest) lines, in reading order.
fn strongest(mut lines: Vec<Line>) -> Vec<Line> {
    lines.sort_by(|a, b| {
        b.strength
            .total_cmp(&a.strength)
            .then(b.length().total_cmp(&a.length()))
    });
    lines.truncate(MAX_EDGES_PER_AXIS);
    lines.sort_by(|a, b| a.at.total_cmp(&b.at).then(a.from.total_cmp(&b.from)));
    lines
}

/// The sides of rectangles and images and the cut lines along `axis`, those on one line and
/// touching joined into one. Sides on the page's own border are left out: the page is a target of
/// its own.
fn object_lines(page: &PageData, axis: Axis) -> Vec<Line> {
    let min = mm_to_pt(MIN_EDGE_MM);
    let tol = OBJECT_TOLERANCE_PT;
    let mut sides: Vec<Line> = Vec::new();
    for o in &page.objects {
        let r = o.rect;
        let (at0, at1, from, to) = match axis {
            Axis::Vertical => (r.x, r.x + r.width, r.y, r.y + r.height),
            Axis::Horizontal => (r.y, r.y + r.height, r.x, r.x + r.width),
        };
        let line = |at| Line {
            at,
            from,
            to,
            strength: 1.0,
        };
        match o.kind {
            ObjectKind::Rect | ObjectKind::Image => {
                sides.push(line(at0));
                sides.push(line(at1));
            }
            // A stroke is an edge along its length only.
            ObjectKind::Line if at1 - at0 < to - from => sides.push(line((at0 + at1) / 2.0)),
            ObjectKind::Line => {}
        }
    }
    let extent = across_extent(page.size, axis);
    sides.retain(|l| l.length() >= tol && l.at > tol && l.at < extent - tol);
    sides.sort_by(|a, b| a.at.total_cmp(&b.at).then(a.from.total_cmp(&b.from)));

    let mut joined: Vec<Line> = Vec::new();
    for s in sides {
        // The latest line at about the same position that this one touches.
        let into = joined
            .iter_mut()
            .rev()
            .take_while(|j| s.at - j.at <= tol)
            .find(|j| s.from <= j.to + tol && s.to >= j.from - tol);
        match into {
            Some(j) => {
                j.from = j.from.min(s.from);
                j.to = j.to.max(s.to);
            }
            None => joined.push(s),
        }
    }
    joined.retain(|l| l.length() >= min);
    joined
}

fn across_extent(size: PageSize, axis: Axis) -> f64 {
    match axis {
        Axis::Vertical => size.width_pt,
        Axis::Horizontal => size.height_pt,
    }
}

/// A run of same-sign contrast along one pixel column (or row).
#[derive(Debug, Clone, Copy)]
struct Run {
    /// Pixel centre across, in pixels.
    at: f64,
    /// Pixels along, `from..to`.
    from: usize,
    to: usize,
    rising: bool,
    contrast: f64,
    pixels: usize,
}

/// Runs of neighbouring columns merged into one edge.
#[derive(Debug, Clone, Copy)]
struct Group {
    first_at: f64,
    from: usize,
    to: usize,
    rising: bool,
    /// Sum of `at` weighted by contrast, and the weight.
    at_sum: f64,
    contrast: f64,
    pixels: usize,
}

impl Group {
    fn of(r: &Run) -> Self {
        Group {
            first_at: r.at,
            from: r.from,
            to: r.to,
            rising: r.rising,
            at_sum: r.at * r.contrast,
            contrast: r.contrast,
            pixels: r.pixels,
        }
    }

    fn takes(&self, r: &Run) -> bool {
        self.rising == r.rising
            && r.at - self.first_at <= MERGE_PX
            && r.from <= self.to + GAP_PX
            && r.to + GAP_PX >= self.from
    }

    fn add(&mut self, r: &Run) {
        self.from = self.from.min(r.from);
        self.to = self.to.max(r.to);
        self.at_sum += r.at * r.contrast;
        self.contrast += r.contrast;
        self.pixels += r.pixels;
    }
}

/// The long contrast runs of `img` along `axis`, in points.
fn render_lines(img: &GreyImage, axis: Axis) -> Vec<Line> {
    let (across, along, across_pt, along_pt) = match axis {
        Axis::Vertical => (img.width, img.height, img.pt_per_px_x, img.pt_per_px_y),
        Axis::Horizontal => (img.height, img.width, img.pt_per_px_y, img.pt_per_px_x),
    };
    if across < 3 || along < MIN_RUN_PX {
        return Vec::new();
    }
    let at = |a: usize, b: usize| -> i32 {
        match axis {
            Axis::Vertical => img.at(a, b) as i32,
            Axis::Horizontal => img.at(b, a) as i32,
        }
    };

    let mut open: Vec<Group> = Vec::new();
    let mut done: Vec<Group> = Vec::new();
    let mut runs: Vec<Run> = Vec::new();
    for a in 1..across - 1 {
        let centre = a as f64 + 0.5;
        // Groups that no run from here on can join.
        let (keep, close): (Vec<Group>, Vec<Group>) = open
            .into_iter()
            .partition(|g| centre - g.first_at <= MERGE_PX);
        open = keep;
        done.extend(close);

        runs.clear();
        let mut current: Option<Run> = None;
        let mut last_hit = 0;
        for b in 0..along {
            // Central difference: the whole step of an edge that falls between two pixels.
            let d = at(a + 1, b) - at(a - 1, b);
            let strong = d.abs() >= MIN_CONTRAST;
            if let Some(run) = current.as_mut() {
                if strong && (d > 0) == run.rising {
                    run.to = b + 1;
                    run.contrast += d.abs() as f64;
                    run.pixels += 1;
                    last_hit = b;
                    continue;
                }
                if strong || b - last_hit > GAP_PX {
                    let run = current.take().unwrap();
                    if run.to - run.from >= MIN_RUN_PX {
                        runs.push(run);
                    }
                }
            }
            if strong && current.is_none() {
                current = Some(Run {
                    at: centre,
                    from: b,
                    to: b + 1,
                    rising: d > 0,
                    contrast: d.abs() as f64,
                    pixels: 1,
                });
                last_hit = b;
            }
        }
        if let Some(run) = current {
            if run.to - run.from >= MIN_RUN_PX {
                runs.push(run);
            }
        }

        for r in &runs {
            match open.iter_mut().find(|g| g.takes(r)) {
                Some(g) => g.add(r),
                None => open.push(Group::of(r)),
            }
        }
    }
    done.extend(open);

    let min = mm_to_pt(MIN_EDGE_MM);
    done.into_iter()
        .filter_map(|g| {
            let line = Line {
                at: g.at_sum / g.contrast * across_pt,
                from: g.from as f64 * along_pt,
                to: g.to as f64 * along_pt,
                strength: 0.0,
            };
            if line.length() < min {
                return None;
            }
            let contrast = (g.contrast / g.pixels as f64 / 255.0).min(1.0);
            let length = (pt_to_mm(line.length()) / FULL_LENGTH_MM).min(1.0);
            Some(Line {
                strength: contrast * length,
                ..line
            })
        })
        .collect()
}
