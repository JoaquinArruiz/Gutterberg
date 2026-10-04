//! Generates a synthetic Print-and-Play page (A4, 3x3 cards of 63.5 x 88 mm
//! packed edge to edge) with vector art and live text. Used by tests and the
//! spike CLI so the pipeline can be verified without a real PnP file.

use crate::geometry::Rect;
use crate::layout::GridLayout;
use crate::units::mm_to_pt;
use lopdf::{dictionary, Document, Object, Stream};

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
