//! Needs the pdfium shared library; skipped (with a note) when unavailable.
use card_core::render::{bind_pdfium, document_info, render_page_png};
use card_core::sample::sample_pdf;

#[test]
fn info_and_png_preview() {
    let Ok(pdfium) = bind_pdfium(None) else {
        eprintln!("SKIPPED: pdfium not available (set PDFIUM_LIB_PATH)");
        return;
    };
    let path = std::env::temp_dir().join("card-core-render-test.pdf");
    sample_pdf().save(&path).unwrap();
    let info = document_info(&pdfium, &path).unwrap();
    assert_eq!(info.page_count, 1);
    assert!((info.pages[0].width_pt - 595.28).abs() < 0.1);
    let png = render_page_png(&pdfium, &path, 0, 400).unwrap();
    assert_eq!(&png[1..4], b"PNG");
    assert!(render_page_png(&pdfium, &path, 5, 400).is_err());
}
