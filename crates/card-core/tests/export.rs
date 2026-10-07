use card_core::export::{export_document, page_size, ExportJob, PageJob};
use card_core::sample::{sample_grid, sample_pdf, CARD_MM};
use card_core::units::pt_to_mm;
use lopdf::{Document, Object};

fn export(gap: f64) -> Document {
    let mut doc = sample_pdf();
    let job = ExportJob {
        pages: vec![PageJob {
            page_index: 0,
            grid: sample_grid(gap),
        }],
    };
    export_document(&mut doc, &job).unwrap();
    // Round-trip through bytes to prove it is a valid, loadable file.
    let mut buf = Vec::new();
    doc.save_to(&mut buf).unwrap();
    Document::load_mem(&buf).unwrap()
}

#[test]
fn source_card_size_is_63_5_by_88() {
    let doc = sample_pdf();
    let size = page_size(&doc, 0).unwrap();
    let l = card_core::layout::calculate_layout(size, &sample_grid(3.0), None).unwrap();
    // Page box is stored as f32, hence the 1e-3 mm tolerance.
    assert!((l.card_width_mm - CARD_MM.0).abs() < 1e-3);
    assert!((l.card_height_mm - CARD_MM.1).abs() < 1e-3);
}

#[test]
fn export_is_one_page_with_nine_vector_placements() {
    let doc = export(3.0);
    let pages = doc.get_pages();
    assert_eq!(pages.len(), 1);
    let id = *pages.values().next().unwrap();
    let content = String::from_utf8(doc.get_page_content(id)).unwrap();
    assert_eq!(content.matches("/Src Do").count(), 9);

    // Clip rects keep the original card size exactly.
    for line in content.lines().filter(|l| l.ends_with(" re W n")) {
        let n: Vec<f64> = line
            .split_whitespace()
            .take(4)
            .map(|v| v.parse().unwrap())
            .collect();
        assert!((pt_to_mm(n[2]) - CARD_MM.0).abs() < 1e-3, "{line}");
        assert!((pt_to_mm(n[3]) - CARD_MM.1).abs() < 1e-3, "{line}");
    }

    // The original page content (text + vector ops) is reused, not rasterised.
    let resources = doc.get_dictionary(id).unwrap().get(b"Resources").unwrap();
    let xobj = resources
        .as_dict()
        .unwrap()
        .get(b"XObject")
        .unwrap()
        .as_dict()
        .unwrap();
    let form_id = xobj.get(b"Src").unwrap().as_reference().unwrap();
    let Object::Stream(form) = doc.get_object(form_id).unwrap() else {
        panic!("not a stream")
    };
    let body = String::from_utf8_lossy(&form.decompressed_content().unwrap()).to_string();
    assert!(body.contains("Tj") && body.contains(" c\n"));
    assert!(!doc.objects.values().any(|o| matches!(o,
        Object::Stream(s) if s.dict.get(b"Subtype").and_then(|v| v.as_name()).map(|n| n == b"Image").unwrap_or(false))));
}

#[test]
fn clip_is_applied_after_translation() {
    let doc = export(3.0);
    let id = *doc.get_pages().values().next().unwrap();
    let content = String::from_utf8(doc.get_page_content(id)).unwrap();
    for block in content.split("q\n").skip(1) {
        let cm = block.find(" cm").expect("cm");
        let clip = block.find(" re W n").expect("clip");
        assert!(cm < clip, "clip must come after cm: {block}");
    }
}

#[test]
fn too_large_gap_is_an_error_not_a_shrink() {
    let mut doc = sample_pdf();
    let job = ExportJob {
        pages: vec![PageJob {
            page_index: 0,
            grid: sample_grid(20.0),
        }],
    };
    assert!(export_document(&mut doc, &job).is_err());
}
