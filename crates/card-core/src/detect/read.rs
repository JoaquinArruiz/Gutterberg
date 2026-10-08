//! Reads a page through pdfium into [`PageData`]: its objects with their boxes in the displayed page
//! (the frame the UI and the layout use) and a small grey render. This is the only part of
//! detection that needs pdfium; the engines work on the data.

use super::{GreyImage, ObjectKind, PageData, PageObject, GREY_LONG_SIDE_PX};
use crate::error::{Error, Result};
use crate::geometry::{PageSize, Rect};
use crate::render::get_page;
use pdfium_render::prelude::*;

/// Axis-aligned means within this many points.
const AXIS_TOLERANCE_PT: f64 = 0.05;

fn pdfium_err(e: PdfiumError) -> Error {
    Error::Pdfium(e.to_string())
}

/// Maps points of the page's own space (origin bottom-left, as objects report them) to the
/// displayed page (origin top-left, rotated clockwise by `/Rotate`).
#[derive(Debug, Clone, Copy)]
pub struct DisplayFrame {
    /// The visible box `[x0, y0, x1, y1]` in page space.
    pub raw: [f64; 4],
    /// Clockwise rotation: 0, 90, 180 or 270.
    pub rotate: i64,
}

impl DisplayFrame {
    pub fn point(&self, x: f64, y: f64) -> (f64, f64) {
        let [x0, y0, x1, y1] = self.raw;
        match self.rotate {
            90 => (y - y0, x - x0),
            180 => (x1 - x, y - y0),
            270 => (y1 - y, x1 - x),
            _ => (x - x0, y1 - y),
        }
    }

    /// The box of the four corners of a page-space rectangle, in the displayed page.
    pub fn rect(&self, corners: &[(f64, f64)]) -> Option<Rect> {
        let mapped: Vec<(f64, f64)> = corners.iter().map(|&(x, y)| self.point(x, y)).collect();
        bounds_of(&mapped)
    }
}

fn bounds_of(points: &[(f64, f64)]) -> Option<Rect> {
    let first = points.first()?;
    let (mut x0, mut y0, mut x1, mut y1) = (first.0, first.1, first.0, first.1);
    for &(x, y) in points {
        x0 = x0.min(x);
        y0 = y0.min(y);
        x1 = x1.max(x);
        y1 = y1.max(y);
    }
    Some(Rect::new(x0, y0, x1 - x0, y1 - y0))
}

/// What a path with these points is: a rectangle, a straight horizontal or vertical stroke, or
/// nothing detection cares about. `points` are the corners of the path in order; a path that comes
/// back to its start repeats the first point at the end.
pub fn classify_path(points: &[(f64, f64)]) -> Option<(ObjectKind, Rect)> {
    let mut p: Vec<(f64, f64)> = points.to_vec();
    let same = |a: (f64, f64), b: (f64, f64)| {
        (a.0 - b.0).abs() < AXIS_TOLERANCE_PT && (a.1 - b.1).abs() < AXIS_TOLERANCE_PT
    };
    if p.len() > 1 && same(p[0], p[p.len() - 1]) {
        p.pop();
    }
    let r = bounds_of(&p)?;
    let on_edge = |q: &(f64, f64)| {
        ((q.0 - r.x).abs() < AXIS_TOLERANCE_PT || (q.0 - r.x - r.width).abs() < AXIS_TOLERANCE_PT)
            && ((q.1 - r.y).abs() < AXIS_TOLERANCE_PT
                || (q.1 - r.y - r.height).abs() < AXIS_TOLERANCE_PT)
    };
    match p.len() {
        2 | 3 if r.width < AXIS_TOLERANCE_PT || r.height < AXIS_TOLERANCE_PT => {
            Some((ObjectKind::Line, r))
        }
        // Four corners, each on a corner of the box: an axis-aligned rectangle.
        4 if p.iter().all(on_edge)
            && r.width > AXIS_TOLERANCE_PT
            && r.height > AXIS_TOLERANCE_PT =>
        {
            let distinct = |i: usize, j: usize| !same(p[i], p[j]);
            (distinct(0, 1) && distinct(1, 2) && distinct(2, 3) && distinct(3, 0))
                .then_some((ObjectKind::Rect, r))
        }
        _ => None,
    }
}

fn path_points(
    path: &PdfPagePathObject,
    matrix: PdfMatrix,
    frame: &DisplayFrame,
) -> Option<Vec<(f64, f64)>> {
    let segments = path.segments();
    let segments = segments.transform(matrix);
    let mut points = Vec::new();
    for s in segments.iter() {
        match s.segment_type() {
            PdfPathSegmentType::MoveTo | PdfPathSegmentType::LineTo => {
                points.push(frame.point(s.x().value as f64, s.y().value as f64));
            }
            // Curves are not rectangles.
            PdfPathSegmentType::BezierTo => return None,
            PdfPathSegmentType::Unknown => return None,
        }
    }
    Some(points)
}

/// Adds the usable objects of `objects` (a page, or the content of a form) to `out`.
fn collect<'a>(
    objects: impl Iterator<Item = PdfPageObject<'a>>,
    form: Option<PdfMatrix>,
    frame: &DisplayFrame,
    out: &mut Vec<PageObject>,
    open_forms: bool,
) {
    for object in objects {
        match object.object_type() {
            PdfPageObjectType::Image => {
                let Ok(q) = object.bounds() else { continue };
                let q = match form {
                    Some(m) => q.transform(m),
                    None => q,
                };
                let corners = [
                    (q.x1().value as f64, q.y1().value as f64),
                    (q.x2().value as f64, q.y2().value as f64),
                    (q.x3().value as f64, q.y3().value as f64),
                    (q.x4().value as f64, q.y4().value as f64),
                ];
                if let Some(rect) = frame.rect(&corners) {
                    out.push(PageObject {
                        kind: ObjectKind::Image,
                        rect,
                    });
                }
            }
            PdfPageObjectType::Path => {
                let Some(path) = object.as_path_object() else {
                    continue;
                };
                let Ok(own) = object.matrix() else { continue };
                let matrix = match form {
                    Some(m) => own.multiply(m),
                    None => own,
                };
                if let Some(points) = path_points(path, matrix, frame) {
                    if let Some((kind, rect)) = classify_path(&points) {
                        out.push(PageObject { kind, rect });
                    }
                }
            }
            // A page whose whole content is one form (some producers wrap everything in one) is
            // opened one level down. With several forms they are stamps, each clipped to what it
            // shows (as in an exported sheet) while its content reaches past, so they are left alone.
            PdfPageObjectType::XObjectForm if open_forms => {
                let Some(f) = object.as_x_object_form_object() else {
                    continue;
                };
                let Ok(m) = object.matrix() else { continue };
                collect(f.iter(), Some(m), frame, out, false);
            }
            _ => {}
        }
    }
}

fn grey_render(page: &PdfPage, size: PageSize) -> Result<GreyImage> {
    let long = size.width_pt.max(size.height_pt);
    let k = GREY_LONG_SIDE_PX as f64 / long;
    let (w, h) = (
        (size.width_pt * k).round().max(1.0) as i32,
        (size.height_pt * k).round().max(1.0) as i32,
    );
    let cfg = PdfRenderConfig::new().set_target_size(w, h);
    let img = page
        .render_with_config(&cfg)
        .map_err(pdfium_err)?
        .as_image()
        .map_err(pdfium_err)?
        .to_luma8();
    let (width, height) = (img.width() as usize, img.height() as usize);
    Ok(GreyImage {
        width,
        height,
        data: img.into_raw(),
        pt_per_px_x: size.width_pt / width as f64,
        pt_per_px_y: size.height_pt / height as f64,
    })
}

/// The size of a page as displayed and the map from its own space to it.
fn page_frame(page: &PdfPage) -> Result<(PageSize, DisplayFrame)> {
    let size = PageSize {
        width_pt: page.width().value as f64,
        height_pt: page.height().value as f64,
    };
    let bounds = page
        .boundaries()
        .bounding()
        .map(|b| b.bounds)
        .map_err(pdfium_err)?;
    let rotate = match page.rotation().map_err(pdfium_err)? {
        PdfPageRenderRotation::None => 0,
        PdfPageRenderRotation::Degrees90 => 90,
        PdfPageRenderRotation::Degrees180 => 180,
        PdfPageRenderRotation::Degrees270 => 270,
    };
    let frame = DisplayFrame {
        raw: [
            bounds.left().value as f64,
            bounds.bottom().value as f64,
            bounds.right().value as f64,
            bounds.top().value as f64,
        ],
        rotate,
    };
    Ok((size, frame))
}

fn page_objects(page: &PdfPage, frame: &DisplayFrame) -> Vec<PageObject> {
    let mut objects = Vec::new();
    let forms = page
        .objects()
        .iter()
        .filter(|o| o.object_type() == PdfPageObjectType::XObjectForm)
        .count();
    collect(page.objects().iter(), None, frame, &mut objects, forms == 1);
    objects
}

/// The objects and a grey render of page `page_index` of `doc`.
pub fn read_page_data(doc: &PdfDocument, page_index: usize) -> Result<PageData> {
    let page = get_page(doc, page_index)?;
    let (size, frame) = page_frame(&page)?;
    Ok(PageData {
        size,
        objects: page_objects(&page, &frame),
        grey: Some(grey_render(&page, size)?),
    })
}

/// Only the page's size and the boxes of its objects (no render): what a text-only request describes.
pub fn read_objects(doc: &PdfDocument, page_index: usize) -> Result<(PageSize, Vec<PageObject>)> {
    let page = get_page(doc, page_index)?;
    let (size, frame) = page_frame(&page)?;
    Ok((size, page_objects(&page, &frame)))
}

/// What a page is, in numbers and words, without showing it.
#[derive(Debug, Clone, PartialEq)]
pub struct PageSummary {
    pub page_index: usize,
    pub size: PageSize,
    pub images: usize,
    pub paths: usize,
    pub texts: usize,
    /// The start of the page's own text.
    pub text: String,
}

/// Longest text kept in a summary (characters).
const SUMMARY_TEXT_CHARS: usize = 2000;

pub fn read_summary(doc: &PdfDocument, page_index: usize) -> Result<PageSummary> {
    let page = get_page(doc, page_index)?;
    let size = PageSize {
        width_pt: page.width().value as f64,
        height_pt: page.height().value as f64,
    };
    let (mut images, mut paths, mut texts) = (0, 0, 0);
    for object in page.objects().iter() {
        match object.object_type() {
            PdfPageObjectType::Image => images += 1,
            PdfPageObjectType::Path => paths += 1,
            PdfPageObjectType::Text => texts += 1,
            _ => {}
        }
    }
    let text = page
        .text()
        .map(|t| t.all().chars().take(SUMMARY_TEXT_CHARS).collect())
        .unwrap_or_default();
    Ok(PageSummary {
        page_index,
        size,
        images,
        paths,
        texts,
        text,
    })
}
