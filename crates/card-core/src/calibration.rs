//! The duplex calibration sheet: a front and a back that show how far the printer moves the
//! back of a sheet. Printed on both sides at actual size and held up to a light, the crosshair
//! on the front crosses a ruler on the back at the number to type into "Back offset X / Y".
//!
//! Where the back marks go uses the same flip as `finish::back_sheet`, so the reading is the
//! offset in the back sheet's own frame (right and down are positive), which is what the
//! offset fields take. Vector only; the few words are set in the standard Helvetica font.

use crate::error::{Error, Result};
use crate::export::{fmt, save_atomically};
use crate::finish::{mirrors_x, Flip};
use crate::geometry::{PageSize, Point};
use crate::units::mm_to_pt;
use lopdf::{dictionary, Document, Object, Stream};
use serde::Deserialize;
use std::path::Path;

/// Distance of the corner crosshairs from the paper edge.
const INSET_MM: f64 = 22.0;
/// Half the length of a crosshair arm: it reaches past a ruler's end even when the printer is
/// 5 mm off.
const ARM_MM: f64 = 12.0;
/// How far a ruler sits from the crosshair's centre, so the two rulers of a place never cross.
const RULER_AT_MM: f64 = 7.0;
/// The rulers run from `-RANGE_MM` to `+RANGE_MM` around the nominal position.
const RANGE_MM: f64 = 5.0;
const STEP_MM: f64 = 0.5;
/// The longest line that checks the printer prints at actual size.
const SCALE_LINE_MM: f64 = 100.0;
/// The smallest page the sheet fits on.
const MIN_PAGE_MM: f64 = 80.0;
const FONT_PT: f64 = 5.0;

/// The words on the sheet, in the user's language (Latin-1 letters only; others print as `?`).
#[derive(Debug, Clone, Deserialize)]
pub struct CalibrationLabels {
    pub title: String,
    pub front: String,
    pub back: String,
    /// Printed under the 100 mm line of the front.
    pub actual_size: String,
}

/// The five places that are measured: the four corners and the centre.
pub fn crosshair_points(page: &PageSize) -> [Point; 5] {
    let (w, h) = (page.width_pt, page.height_pt);
    let m = mm_to_pt(INSET_MM);
    [
        Point { x: m, y: m },
        Point { x: w - m, y: m },
        Point { x: m, y: h - m },
        Point { x: w - m, y: h - m },
        Point {
            x: w / 2.0,
            y: h / 2.0,
        },
    ]
}

/// Where a front point lands on the back sheet once the paper is turned over.
pub fn back_point(page: &PageSize, flip: Flip, p: Point) -> Point {
    if mirrors_x(page, flip) {
        Point {
            x: page.width_pt - p.x,
            y: p.y,
        }
    } else {
        Point {
            x: p.x,
            y: page.height_pt - p.y,
        }
    }
}

fn line(ops: &mut String, h: f64, x1: f64, y1: f64, x2: f64, y2: f64) {
    ops.push_str(&format!(
        "{} {} m {} {} l S\n",
        fmt(x1),
        fmt(h - y1),
        fmt(x2),
        fmt(h - y2)
    ));
}

/// `s` as a PDF string in WinAnsi (Latin-1), with the characters PDF treats as syntax escaped.
fn pdf_text(s: &str) -> Vec<u8> {
    let mut out = Vec::new();
    for c in s.chars() {
        let b = match u32::from(c) {
            n @ 0x20..=0x7e | n @ 0xa0..=0xff => n as u8,
            _ => b'?',
        };
        if matches!(b, b'(' | b')' | b'\\') {
            out.push(b'\\');
        }
        out.push(b);
    }
    out
}

fn text(ops: &mut Vec<u8>, h: f64, x: f64, y: f64, size: f64, s: &str) {
    ops.extend_from_slice(
        format!("BT /F1 {} Tf {} {} Td (", fmt(size), fmt(x), fmt(h - y)).as_bytes(),
    );
    ops.extend(pdf_text(s));
    ops.extend_from_slice(b") Tj ET\n");
}

/// Approximate width of `s` in Helvetica, enough to centre a word.
fn text_width(s: &str, size: f64) -> f64 {
    s.chars().count() as f64 * size * 0.52
}

fn crosshair(ops: &mut String, h: f64, c: Point) {
    let a = mm_to_pt(ARM_MM);
    line(ops, h, c.x - a, c.y, c.x + a, c.y);
    line(ops, h, c.x, c.y - a, c.x, c.y + a);
}

/// A ruler beside `c`: along x (below it) when `horizontal`, else along y (to its right). A
/// crosshair line of the front crosses it at the offset. Ticks every half millimetre,
/// longer at each millimetre and at the ends and the middle; numbers every four millimetres along x and every two along y.
fn ruler(
    ops: &mut String,
    labels: &mut Vec<(f64, f64, String)>,
    h: f64,
    c: Point,
    horizontal: bool,
) {
    let steps = (RANGE_MM / STEP_MM) as i32;
    let at = mm_to_pt(RULER_AT_MM);
    let reach = mm_to_pt(RANGE_MM);
    let c = if horizontal {
        Point {
            x: c.x,
            y: c.y + at,
        }
    } else {
        Point {
            x: c.x + at,
            y: c.y,
        }
    };
    if horizontal {
        line(ops, h, c.x - reach, c.y, c.x + reach, c.y);
    } else {
        line(ops, h, c.x, c.y - reach, c.x, c.y + reach);
    }
    for i in -steps..=steps {
        let mm = f64::from(i) * STEP_MM;
        let along = mm_to_pt(mm);
        let len = if i == 0 || i.abs() == steps {
            mm_to_pt(2.5)
        } else if i % 2 == 0 {
            mm_to_pt(1.6)
        } else {
            mm_to_pt(0.9)
        };
        if horizontal {
            line(ops, h, c.x + along, c.y - len, c.x + along, c.y + len);
        } else {
            line(ops, h, c.x - len, c.y + along, c.x + len, c.y + along);
        }
        let every = if horizontal { 8 } else { 4 };
        if i % every == 0 && i != 0 && i.abs() < steps {
            let n = if mm > 0.0 {
                format!("+{mm:.0}")
            } else {
                format!("{mm:.0}")
            };
            if horizontal {
                labels.push((
                    c.x + along - text_width(&n, FONT_PT) / 2.0,
                    c.y + mm_to_pt(5.0),
                    n,
                ));
            } else {
                labels.push((c.x + mm_to_pt(3.2), c.y + along + FONT_PT * 0.35, n));
            }
        }
    }
    let (zx, zy) = if horizontal {
        (c.x - text_width("0", FONT_PT) / 2.0, c.y + mm_to_pt(5.0))
    } else {
        (c.x + mm_to_pt(3.2), c.y + FONT_PT * 0.35)
    };
    labels.push((zx, zy, "0".into()));
    ops.push('\n');
}

fn front_content(page: &PageSize, l: &CalibrationLabels) -> Vec<u8> {
    let (w, h) = (page.width_pt, page.height_pt);
    let mut marks = String::from("0 G 0.3 w\n");
    for p in crosshair_points(page) {
        crosshair(&mut marks, h, p);
    }
    let mut words = Vec::new();
    let centre = Point {
        x: w / 2.0,
        y: h / 2.0,
    };
    // The line that shows whether the printer prints at actual size.
    let scale_len = mm_to_pt(SCALE_LINE_MM);
    if w >= scale_len + 2.0 * mm_to_pt(INSET_MM) {
        let y = centre.y + mm_to_pt(14.0);
        let (x1, x2) = (centre.x - scale_len / 2.0, centre.x + scale_len / 2.0);
        let tick = mm_to_pt(2.0);
        line(&mut marks, h, x1, y, x2, y);
        line(&mut marks, h, x1, y - tick, x1, y + tick);
        line(&mut marks, h, x2, y - tick, x2, y + tick);
        text(
            &mut words,
            h,
            centre.x - text_width(&l.actual_size, FONT_PT * 1.4) / 2.0,
            y + mm_to_pt(5.0),
            FONT_PT * 1.4,
            &l.actual_size,
        );
    }
    let size = FONT_PT * 2.0;
    text(
        &mut words,
        h,
        centre.x - text_width(&l.title, size) / 2.0,
        mm_to_pt(8.0),
        size,
        &l.title,
    );
    text(
        &mut words,
        h,
        centre.x - text_width(&l.front, size) / 2.0,
        centre.y - mm_to_pt(14.0),
        size,
        &l.front,
    );
    let mut out = format!("q\n{marks}Q\n0 g\n").into_bytes();
    out.extend(words);
    out
}

fn back_content(page: &PageSize, flip: Flip, l: &CalibrationLabels) -> Vec<u8> {
    let (w, h) = (page.width_pt, page.height_pt);
    let mut marks = String::from("0 G 0.3 w\n");
    let mut numbers = Vec::new();
    for p in crosshair_points(page) {
        let c = back_point(page, flip, p);
        ruler(&mut marks, &mut numbers, h, c, true);
        ruler(&mut marks, &mut numbers, h, c, false);
    }
    let mut words = Vec::new();
    for (x, y, s) in numbers {
        text(&mut words, h, x, y, FONT_PT, &s);
    }
    let size = FONT_PT * 2.0;
    text(
        &mut words,
        h,
        w / 2.0 - text_width(&l.title, size) / 2.0,
        mm_to_pt(8.0),
        size,
        &l.title,
    );
    text(
        &mut words,
        h,
        w / 2.0 - text_width(&l.back, size) / 2.0,
        h / 2.0 - mm_to_pt(14.0),
        size,
        &l.back,
    );
    let mut out = format!("q\n{marks}Q\n0 g\n").into_bytes();
    out.extend(words);
    out
}

/// The two-page calibration PDF (front, back) for a sheet of `page` turned over `flip`.
pub fn calibration_pdf(
    page: &PageSize,
    flip: Flip,
    labels: &CalibrationLabels,
) -> Result<Document> {
    let min = mm_to_pt(MIN_PAGE_MM);
    if !(page.width_pt.is_finite() && page.height_pt.is_finite())
        || page.width_pt < min
        || page.height_pt < min
    {
        return Err(Error::InvalidSheet(format!(
            "the calibration sheet needs a page of at least {MIN_PAGE_MM} mm on each side"
        )));
    }
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });
    let mut kids = Vec::new();
    for content in [
        front_content(page, labels),
        back_content(page, flip, labels),
    ] {
        let content_id = doc.add_object(Stream::new(dictionary! {}, content));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id,
            "MediaBox" => vec![
                0.into(), 0.into(),
                Object::Real(page.width_pt as f32), Object::Real(page.height_pt as f32),
            ],
            "Resources" => dictionary! { "Font" => dictionary! { "F1" => font_id } },
            "Contents" => content_id,
        });
        kids.push(Object::Reference(page_id));
    }
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages", "Kids" => kids, "Count" => 2,
        }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    Ok(doc)
}

/// Writes the calibration sheet to `output`.
pub fn write_calibration_pdf(
    output: &Path,
    page: &PageSize,
    flip: Flip,
    labels: &CalibrationLabels,
) -> Result<()> {
    let mut doc = calibration_pdf(page, flip, labels)?;
    save_atomically(&mut doc, output)
}
