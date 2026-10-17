//! Pictures of single pieces, as Pair backs with AI sends them: the box around each piece at a given long side,
//! showing the piece itself. Skipped when pdfium is not available (set `PDFIUM_LIB_PATH`).
use card_core::card::{PageGroup, PageGroupKind, PageRange};
use card_core::export::page_size;
use card_core::render::{bind_pdfium, render_page_png, render_pieces_in};
use card_core::sample::{sample_grid, sample_pdf};
use card_core::sheet::extract_cards;

#[test]
fn each_piece_is_its_own_picture_at_the_long_side_asked_for() {
    let Ok(pdfium) = bind_pdfium(&[]) else {
        assert!(
            std::env::var_os("CI").is_none(),
            "pdfium not available in CI"
        );
        eprintln!("SKIPPED pdfium render: pdfium not available (set PDFIUM_LIB_PATH)");
        return;
    };
    let dir = std::env::temp_dir().join(format!("card-core-pieces-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("sample.pdf");
    sample_pdf().save(&path).unwrap();
    let page = page_size(&sample_pdf(), 0).unwrap();
    let group = PageGroup {
        pages: PageRange { first: 0, last: 0 },
        kind: PageGroupKind::grid(sample_grid(0.0)),
    };
    let cards = extract_cards(0, &[page], std::slice::from_ref(&group)).unwrap();
    let pieces: Vec<_> = cards.iter().take(2).map(|c| (0, c.source)).collect();

    let doc = pdfium.load_pdf_from_file(&path, None).unwrap();
    let pictures = render_pieces_in(&doc, &pieces, 256).unwrap();
    assert_eq!(pictures.len(), 2);

    let page_png = render_page_png(&pdfium, &path, 0, page.width_pt.round() as u32).unwrap();
    let whole = image::load_from_memory(&page_png).unwrap().to_rgba8();
    for (picture, (_, source)) in pictures.iter().zip(&pieces) {
        let rect = source.as_rect().unwrap();
        // The long side is the one asked for, and the shape is the piece's.
        assert!(
            picture.width.max(picture.height).abs_diff(256) <= 1,
            "{}x{}",
            picture.width,
            picture.height
        );
        let ratio = picture.width as f64 / picture.height as f64;
        assert!((ratio - rect.width / rect.height).abs() < 0.02, "{ratio}");
        // A point just inside the corner is what the page shows there.
        let img = image::load_from_memory(&picture.png).unwrap().to_rgba8();
        assert_eq!((img.width(), img.height()), (picture.width, picture.height));
        let k = img.width() as f64 / rect.width;
        let (u, v) = (rect.width * 0.1, rect.height * 0.1);
        let here = img.get_pixel((u * k) as u32, (v * k) as u32);
        let there = whole.get_pixel((rect.x + u) as u32, (rect.y + v) as u32);
        assert!(
            here.0.iter().zip(there.0).all(|(a, b)| a.abs_diff(b) <= 6),
            "{here:?} vs {there:?}"
        );
    }
}
