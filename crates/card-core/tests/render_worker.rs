//! Needs the pdfium shared library; skipped (with a note) when unavailable.
//! One test only: pdfium binds once per process, and the worker owns that binding.
use card_core::geometry::Rect;
use card_core::render_worker::{RenderKind, RenderWorker};
use card_core::sample::sample_pdf;
use card_core::Error;
use std::sync::Arc;

#[test]
fn worker_renders_from_one_open_document_and_drops_superseded_requests() {
    let w = match RenderWorker::spawn(vec![]) {
        Ok(w) => Arc::new(w),
        Err(e) => {
            assert!(
                std::env::var_os("CI").is_none(),
                "pdfium not available in CI: {e}"
            );
            eprintln!("SKIPPED: pdfium not available (set PDFIUM_LIB_PATH)");
            return;
        }
    };
    assert!(matches!(
        w.render_page(RenderKind::Page, 0, 200),
        Err(Error::NoDocument)
    ));

    let path = std::env::temp_dir().join("card-core-worker-test.pdf");
    sample_pdf().save(&path).unwrap();
    assert_eq!(w.open(path).unwrap().page_count, 1);
    let png = w.render_page(RenderKind::Thumbnail, 0, 200).unwrap();
    assert_eq!(&png[1..4], b"PNG");
    let quarter = Rect::new(0.25, 0.5, 0.25, 0.1);
    let png = w
        .render_region(RenderKind::Magnifier, 0, quarter, 2000)
        .unwrap();
    assert_eq!(image::load_from_memory(&png).unwrap().width(), 500);

    // A burst of magnifier requests: stale ones are dropped, never failed otherwise.
    let full = Rect::new(0.0, 0.0, 1.0, 1.0);
    let handles: Vec<_> = (0..20)
        .map(|_| {
            let w = w.clone();
            std::thread::spawn(move || w.render_region(RenderKind::Magnifier, 0, full, 3000))
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert!(results
        .iter()
        .all(|r| r.is_ok() || matches!(r, Err(Error::Superseded))));
    assert!(results.iter().any(|r| r.is_ok()));
    // The most recent request is never dropped.
    assert!(w
        .render_region(RenderKind::Magnifier, 0, full, 3000)
        .is_ok());
}
