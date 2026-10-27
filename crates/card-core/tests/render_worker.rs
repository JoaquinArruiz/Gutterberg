//! Needs the pdfium shared library; skipped (with a note) when unavailable.
//! One test only: pdfium binds once per process, and the worker owns that binding.
use card_core::card::OrientedRect;
use card_core::geometry::{Point, Rect};
use card_core::render_worker::{RenderKind, RenderWorker};
use card_core::sample::{sample_pdf, sample_pdf_pages, A4_MM, CARD_MM};
use card_core::units::mm_to_pt;
use card_core::Error;
use std::sync::Arc;

#[test]
fn worker_renders_from_open_documents_and_drops_superseded_requests() {
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
        w.render_page(RenderKind::Page, 0, 0, 200),
        Err(Error::NoDocument)
    ));

    let path = std::env::temp_dir().join("card-core-worker-test.pdf");
    sample_pdf().save(&path).unwrap();
    assert_eq!(w.open(0, path).unwrap().page_count, 1);
    let png = w.render_page(RenderKind::Thumbnail, 0, 0, 200).unwrap();
    assert_eq!(&png[1..4], b"PNG");
    let quarter = Rect::new(0.25, 0.5, 0.25, 0.1);
    let png = w
        .render_region(RenderKind::Magnifier, 0, 0, quarter, 2000)
        .unwrap();
    assert_eq!(image::load_from_memory(&png).unwrap().width(), 500);
    // A piece for the sheet preview leaves what the page does not paint clear: every pixel of the
    // white render is opaque, and the clear one has see-through pixels where the page is empty.
    let alpha = |png: &[u8]| -> Vec<u8> {
        let img = image::load_from_memory(png).unwrap().to_rgba8();
        img.pixels().map(|p| p.0[3]).collect()
    };
    let corner = Rect::new(0.0, 0.0, 0.02, 0.02);
    let white = w
        .render_region(RenderKind::Page, 0, 0, corner, 2000)
        .unwrap();
    assert!(alpha(&white).iter().all(|&a| a == 255));
    let clear = w
        .render_piece_region(RenderKind::Page, 0, 0, corner, 2000)
        .unwrap();
    assert!(alpha(&clear).iter().any(|&a| a < 255));
    // The edge colour of an empty corner of the page is the paper's.
    let corner_piece = OrientedRect {
        center: Point { x: 6.0, y: 6.0 },
        width: 8.0,
        height: 8.0,
        angle_deg: 0.0,
    };
    assert_eq!(
        w.edge_colors(0, vec![(0, corner_piece)]).unwrap(),
        vec![[255, 255, 255]]
    );
    // The first sample card is filled (0.356, 0.744, 0.5), with a black outline and a white circle.
    let (cw, ch) = (mm_to_pt(CARD_MM.0), mm_to_pt(CARD_MM.1));
    let (pw, ph) = (mm_to_pt(A4_MM.0), mm_to_pt(A4_MM.1));
    let first = OrientedRect {
        center: Point {
            x: (pw - 3.0 * cw) / 2.0 + cw / 2.0,
            y: (ph - 3.0 * ch) / 2.0 + ch / 2.0,
        },
        width: cw,
        height: ch,
        angle_deg: 0.0,
    };
    let [color] = w.edge_colors(0, vec![(0, first)]).unwrap()[..] else {
        panic!("one colour");
    };
    for (got, want) in color.iter().zip([91, 190, 128]) {
        assert!(got.abs_diff(want) <= 3, "{color:?}");
    }

    // A burst of magnifier requests: stale ones are dropped, never failed otherwise.
    let full = Rect::new(0.0, 0.0, 1.0, 1.0);
    let handles: Vec<_> = (0..20)
        .map(|_| {
            let w = w.clone();
            std::thread::spawn(move || w.render_region(RenderKind::Magnifier, 0, 0, full, 3000))
        })
        .collect();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert!(results
        .iter()
        .all(|r| r.is_ok() || matches!(r, Err(Error::Superseded))));
    assert!(results.iter().any(|r| r.is_ok()));
    // The most recent request is never dropped.
    assert!(w
        .render_region(RenderKind::Magnifier, 0, 0, full, 3000)
        .is_ok());

    // A second document lives beside the first, and closing one leaves the other.
    let second = std::env::temp_dir().join("card-core-worker-test-2.pdf");
    sample_pdf_pages(3).save(&second).unwrap();
    assert_eq!(w.open(1, second).unwrap().page_count, 3);
    assert!(w.render_page(RenderKind::Page, 1, 2, 100).is_ok());
    assert!(w.render_page(RenderKind::Page, 0, 0, 100).is_ok());
    assert!(matches!(
        w.render_page(RenderKind::Page, 7, 0, 100),
        Err(Error::NoDocument)
    ));
    w.close(Some(1)).unwrap();
    assert!(matches!(
        w.render_page(RenderKind::Page, 1, 0, 100),
        Err(Error::NoDocument)
    ));
    assert!(w.render_page(RenderKind::Page, 0, 0, 100).is_ok());
    w.close(None).unwrap();
    assert!(matches!(
        w.render_page(RenderKind::Page, 0, 0, 100),
        Err(Error::NoDocument)
    ));
}
