//! Needs the pdfium shared library; skipped (with a note) when unavailable.
use card_core::geometry::Rect;
use card_core::render::{bind_pdfium, document_info, render_page_png, render_region_png};
use card_core::sample::sample_pdf;
use pdfium_render::prelude::Pdfium;

/// pdfium, or None (after a note) when it is missing; a missing pdfium fails under CI.
fn pdfium_or_skip() -> Option<Pdfium> {
    match bind_pdfium(&[]) {
        Ok(p) => Some(p),
        Err(e) => {
            assert!(
                std::env::var_os("CI").is_none(),
                "pdfium not available in CI: {e}"
            );
            eprintln!("SKIPPED: pdfium not available (set PDFIUM_LIB_PATH)");
            None
        }
    }
}

/// pdfium binds once per process, and cargo runs a binary's tests on parallel threads, so every
/// test after the first (or racing with it) used to fail with "bindings already initialized".
#[test]
fn pdfium_can_be_bound_repeatedly_in_one_process() {
    let Some(first) = pdfium_or_skip() else {
        return;
    };
    let path = std::env::temp_dir().join("card-core-render-rebind.pdf");
    sample_pdf().save(&path).unwrap();
    for _ in 0..3 {
        let again = bind_pdfium(&[]).expect("a second bind shares the first");
        assert_eq!(document_info(&again, &path).unwrap().page_count, 1);
    }
    assert_eq!(document_info(&first, &path).unwrap().page_count, 1);
}

#[test]
fn info_and_png_preview() {
    let Some(pdfium) = pdfium_or_skip() else {
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

#[test]
fn region_png_is_only_the_region() {
    let Some(pdfium) = pdfium_or_skip() else {
        return;
    };
    let path = std::env::temp_dir().join("card-core-region-test.pdf");
    sample_pdf().save(&path).unwrap();
    // Quarter-width, tenth-height region of a page rendered 2000 px wide.
    let png = render_region_png(&pdfium, &path, 0, Rect::new(0.25, 0.5, 0.25, 0.1), 2000).unwrap();
    let img = image::load_from_memory(&png).unwrap();
    // Edges are floored/ceiled to whole pixels, so allow one pixel of slack.
    assert_eq!(img.width(), 500);
    assert!((283..=284).contains(&img.height()), "{}", img.height());
}
