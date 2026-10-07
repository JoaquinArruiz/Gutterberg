//! Generates a synthetic Print-and-Play page (A4, 3x3 cards of 63.5 x 88 mm
//! packed edge to edge) with vector art and live text. Used by tests and the
//! spike CLI so the pipeline can be verified without a real PnP file.

use crate::geometry::Rect;
use crate::layout::GridLayout;
use crate::units::mm_to_pt;
use lopdf::{dictionary, Dictionary, Document, Object, Stream};

pub const A4_MM: (f64, f64) = (210.0, 297.0);
pub const CARD_MM: (f64, f64) = (63.5, 88.0);

/// The grid that matches [`sample_pdf`], with the given gap.
pub fn sample_grid(gap_mm: f64) -> GridLayout {
    let (w, h) = (CARD_MM.0 * 3.0, CARD_MM.1 * 3.0);
    GridLayout {
        bounds: Rect::new(
            (A4_MM.0 - w) / 2.0 / A4_MM.0,
            (A4_MM.1 - h) / 2.0 / A4_MM.1,
            w / A4_MM.0,
            h / A4_MM.1,
        ),
        rows: 3,
        columns: 3,
        source_gap_x_mm: 0.0,
        source_gap_y_mm: 0.0,
        gap_x_mm: gap_mm,
        gap_y_mm: gap_mm,
        margin_top_mm: 0.0,
        margin_right_mm: 0.0,
        margin_bottom_mm: 0.0,
        margin_left_mm: 0.0,
        output_page: None,
        fit_page: false,
    }
}

/// The grid for [`sample_pdf`] after it has been viewed through `page_box` (`[x0, y0, x1, y1]`,
/// CropBox/MediaBox in page space) and a clockwise `rotate` of 0, 90, 180 or 270. Bounds are
/// normalised against the displayed (rotated) page, as the UI does.
pub fn sample_grid_for(page_box: [f64; 4], rotate: i64, gap_mm: f64) -> GridLayout {
    let (pw, ph) = (mm_to_pt(A4_MM.0), mm_to_pt(A4_MM.1));
    let (cw, ch) = (mm_to_pt(CARD_MM.0), mm_to_pt(CARD_MM.1));
    // The card block in page space, relative to the page box, bottom-left origin.
    let u0 = (pw - cw * 3.0) / 2.0 - page_box[0];
    let v0 = (ph - ch * 3.0) / 2.0 - page_box[1];
    let (u1, v1) = (u0 + cw * 3.0, v0 + ch * 3.0);
    let (w, h) = (page_box[2] - page_box[0], page_box[3] - page_box[1]);
    // Clockwise rotation of a point, then the displayed page size.
    let map = |u: f64, v: f64| match rotate {
        90 => (v, w - u),
        180 => (w - u, h - v),
        270 => (h - v, u),
        _ => (u, v),
    };
    let (dw, dh) = if rotate % 180 == 0 { (w, h) } else { (h, w) };
    let (a, b) = (map(u0, v0), map(u1, v1));
    let (x0, x1) = (a.0.min(b.0), a.0.max(b.0));
    let (y0, y1) = (a.1.min(b.1), a.1.max(b.1));
    GridLayout {
        bounds: Rect::new(x0 / dw, (dh - y1) / dh, (x1 - x0) / dw, (y1 - y0) / dh),
        ..sample_grid(gap_mm)
    }
}

fn first_page_mut(doc: &mut Document) -> &mut Dictionary {
    let id = *doc.get_pages().values().next().expect("a page");
    doc.get_dictionary_mut(id).expect("page dictionary")
}

/// Show the sample page rotated clockwise by `angle` degrees.
pub fn set_rotate(doc: &mut Document, angle: i64) {
    first_page_mut(doc).set("Rotate", angle);
}

/// Give the sample page a CropBox.
pub fn set_crop_box(doc: &mut Document, b: [f64; 4]) {
    let v: Vec<Object> = b.iter().map(|x| Object::Real(*x as f32)).collect();
    first_page_mut(doc).set("CropBox", v);
}

/// Move the page's MediaBox (and Rotate, if any) up to the `/Pages` node, so the page
/// inherits them.
pub fn inherit_page_attributes(doc: &mut Document) {
    let page = first_page_mut(doc);
    let moved: Vec<_> = [&b"MediaBox"[..], b"Rotate"]
        .iter()
        .filter_map(|k| page.remove(k).map(|v| (k.to_vec(), v)))
        .collect();
    let parent = page.get(b"Parent").and_then(|p| p.as_reference()).unwrap();
    let node = doc.get_dictionary_mut(parent).unwrap();
    for (k, v) in moved {
        node.set(k, v);
    }
}

/// Add a one-entry outline whose destination is the sample page.
pub fn add_outlines(doc: &mut Document) {
    let page_id = *doc.get_pages().values().next().expect("a page");
    let root = doc.new_object_id();
    let item = doc.add_object(dictionary! {
        "Title" => Object::string_literal("Cards"),
        "Parent" => root,
        "Dest" => vec![page_id.into(), "Fit".into()],
    });
    doc.objects.insert(
        root,
        Object::Dictionary(dictionary! {
            "Type" => "Outlines", "First" => item, "Last" => item, "Count" => 1,
        }),
    );
    let catalog = doc
        .trailer
        .get(b"Root")
        .and_then(|r| r.as_reference())
        .unwrap();
    doc.get_dictionary_mut(catalog)
        .unwrap()
        .set("Outlines", root);
}

pub fn sample_pdf() -> Document {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica-Bold",
    });
    let (pw, ph) = (mm_to_pt(A4_MM.0), mm_to_pt(A4_MM.1));
    let (cw, ch) = (mm_to_pt(CARD_MM.0), mm_to_pt(CARD_MM.1));
    let (left, bottom) = ((pw - cw * 3.0) / 2.0, (ph - ch * 3.0) / 2.0);

    let mut ops = String::new();
    for r in 0..3 {
        for c in 0..3 {
            let n = r * 3 + c + 1;
            let x = left + c as f64 * cw;
            let y = bottom + (2 - r) as f64 * ch;
            let hue = (n as f64) / 9.0;
            ops.push_str(&format!(
                "{:.3} {:.3} {:.3} rg\n{x:.3} {y:.3} {cw:.3} {ch:.3} re f\n",
                0.3 + 0.5 * hue,
                0.8 - 0.5 * hue,
                0.5
            ));
            // Full-bleed edge stroke so clipping errors are visible.
            ops.push_str(&format!(
                "0 0 0 RG 1.5 w\n{x:.3} {y:.3} {cw:.3} {ch:.3} re S\n"
            ));
            // Vector circle (4 béziers).
            let (cx, cy, rad) = (x + cw / 2.0, y + ch / 2.0, cw * 0.3);
            let k = 0.5523 * rad;
            ops.push_str(&format!(
                "1 1 1 rg\n{:.3} {:.3} m\n{:.3} {:.3} {:.3} {:.3} {:.3} {:.3} c\n{:.3} {:.3} {:.3} {:.3} {:.3} {:.3} c\n{:.3} {:.3} {:.3} {:.3} {:.3} {:.3} c\n{:.3} {:.3} {:.3} {:.3} {:.3} {:.3} c\nf\n",
                cx + rad, cy,
                cx + rad, cy + k, cx + k, cy + rad, cx, cy + rad,
                cx - k, cy + rad, cx - rad, cy + k, cx - rad, cy,
                cx - rad, cy - k, cx - k, cy - rad, cx, cy - rad,
                cx + k, cy - rad, cx + rad, cy - k, cx + rad, cy,
            ));
            ops.push_str(&format!(
                "0 g\nBT /F1 40 Tf {:.3} {:.3} Td ({n}) Tj ET\n",
                cx - 11.0,
                cy - 14.0
            ));
        }
    }
    let content_id = doc.add_object(Stream::new(dictionary! {}, ops.into_bytes()));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), Object::Real(pw as f32), Object::Real(ph as f32)],
        "Resources" => dictionary! { "Font" => dictionary! { "F1" => font_id } },
        "Contents" => content_id,
    });
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1,
        }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    doc
}

/// [`sample_pdf`] repeated `count` times (the pages share their content), for multi-page
/// tests such as a rules page followed by card sections.
pub fn sample_pdf_pages(count: usize) -> Document {
    let mut doc = sample_pdf();
    let first = *doc.get_pages().values().next().expect("sample has a page");
    let pages_id = doc
        .get_dictionary(first)
        .and_then(|d| d.get(b"Parent"))
        .and_then(|p| p.as_reference())
        .expect("page has a parent");
    let template = doc.get_dictionary(first).expect("page dictionary").clone();
    let mut kids: Vec<Object> = vec![first.into()];
    for _ in 1..count {
        kids.push(doc.add_object(template.clone()).into());
    }
    let root = doc.get_dictionary_mut(pages_id).expect("pages dictionary");
    root.set("Count", count as i64);
    root.set("Kids", Object::Array(kids));
    doc
}
