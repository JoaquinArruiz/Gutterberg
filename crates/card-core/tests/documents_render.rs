//! Renders a sheet that mixes cards of two PDFs with pdfium, to check each card really comes from
//! its own file. Skipped when pdfium is not available (set `PDFIUM_LIB_PATH`).
use card_core::card::{PageGroup, PageGroupKind, PageRange};
use card_core::export::{export_sheets_files, page_size};
use card_core::render::{bind_pdfium, render_page_png};
use card_core::sample::{sample_grid, sample_pdf};
use card_core::sheet::{extract_cards, paginate, Margins, PaginateOptions, SheetPage, SheetSpec};

fn rgb_at(img: &image::RgbaImage, x: f64, y: f64) -> [u8; 3] {
    let p = img.get_pixel(
        (x.round().max(0.0) as u32).min(img.width() - 1),
        (y.round().max(0.0) as u32).min(img.height() - 1),
    );
    [p[0], p[1], p[2]]
}

fn near(a: [u8; 3], b: [u8; 3]) -> bool {
    a.iter().zip(&b).all(|(x, y)| x.abs_diff(*y) <= 4)
}

#[test]
fn one_sheet_shows_a_card_from_each_of_two_pdfs() {
    let Ok(pdfium) = bind_pdfium(&[]) else {
        assert!(
            std::env::var_os("CI").is_none(),
            "pdfium not available in CI"
        );
        eprintln!("SKIPPED pdfium render: pdfium not available (set PDFIUM_LIB_PATH)");
        return;
    };
    let dir = std::env::temp_dir().join(format!("card-core-two-pdfs-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let page = page_size(&sample_pdf(), 0).unwrap();

    // The second PDF is the sample with its cards' blue taken out, so its cards are other colours.
    let mut other = sample_pdf();
    let id = *other.get_pages().values().next().unwrap();
    let content = String::from_utf8(other.get_page_content(id))
        .unwrap()
        .replace(" 0.500 rg", " 0.000 rg");
    other.change_page_content(id, content.into_bytes()).unwrap();

    let (path_a, path_b, out_path) = (dir.join("a.pdf"), dir.join("b.pdf"), dir.join("out.pdf"));
    sample_pdf().save(&path_a).unwrap();
    other.save(&path_b).unwrap();
    let render = |path: &std::path::Path| {
        let png = render_page_png(&pdfium, path, 0, page.width_pt.round() as u32).unwrap();
        image::load_from_memory(&png).unwrap().to_rgba8()
    };
    let (before_a, before_b) = (render(&path_a), render(&path_b));
    let scale = before_a.width() as f64 / page.width_pt;

    let group = PageGroup {
        pages: PageRange { first: 0, last: 0 },
        kind: PageGroupKind::Grid {
            grid: sample_grid(0.0),
        },
    };
    let first_of =
        |document_id| extract_cards(document_id, &[page], std::slice::from_ref(&group)).unwrap()[0];
    let (card_a, card_b) = (first_of(0), first_of(7));
    let rect = card_a.source.as_rect().unwrap();
    // A point just inside the card's top-left corner: plain fill, no text or circle.
    let (u, v) = (rect.width * 0.1, rect.height * 0.1);
    let want_a = rgb_at(&before_a, (rect.x + u) * scale, (rect.y + v) * scale);
    let want_b = rgb_at(&before_b, (rect.x + u) * scale, (rect.y + v) * scale);
    assert!(
        !near(want_a, want_b),
        "the two PDFs must differ: {want_a:?}"
    );

    let spec = SheetSpec {
        page: SheetPage::Size(page),
        rows: None,
        columns: None,
        gap_x_mm: 0.0,
        gap_y_mm: 0.0,
        margins: Margins::default(),
    };
    let sheets = paginate(
        &[(card_a, 1), (card_b, 1)],
        &spec,
        &PaginateOptions::default(),
    )
    .unwrap();
    assert_eq!(sheets.len(), 1);
    assert_eq!(sheets[0].placements.len(), 2);
    export_sheets_files(
        &[(0, path_a.as_path()), (7, path_b.as_path())],
        &out_path,
        &sheets,
    )
    .unwrap();
    let after = render(&out_path);

    for (placement, want) in sheets[0].placements.iter().zip([want_a, want_b]) {
        let d = placement.destination;
        let got = rgb_at(&after, (d.x + u) * scale, (d.y + v) * scale);
        assert!(
            near(got, want),
            "document {}: {got:?} is not {want:?}",
            placement.card_id.document_id()
        );
    }
}
