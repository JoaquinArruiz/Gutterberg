//! Renders finished sheets with pdfium: the bleed shows the piece's edge mirrored, and a back
//! sits where the mirror puts it. Skipped when pdfium is not available (set `PDFIUM_LIB_PATH`).
use card_core::card::{CardId, PageGroup, PageGroupKind, PageRange};
use card_core::export::{export_sheets, page_size};
use card_core::finish::{
    finish_sheets, BleedOptions, BleedSource, DuplexOptions, FinishOptions, Finishing, Flip,
};
use card_core::render::{bind_pdfium, render_page_png};
use card_core::sample::{sample_grid, sample_pdf};
use card_core::sheet::{
    plan_print_in, DocumentSource, Margins, PaginateOptions, PrintLayout, SheetPage, SheetSpec,
};
use card_core::units::mm_to_pt;

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
fn the_bleed_is_the_edge_of_the_piece_mirrored_and_the_back_sits_in_the_mirrored_slot() {
    let Ok(pdfium) = bind_pdfium(&[]) else {
        assert!(
            std::env::var_os("CI").is_none(),
            "pdfium not available in CI"
        );
        eprintln!("SKIPPED pdfium render: pdfium not available (set PDFIUM_LIB_PATH)");
        return;
    };
    let dir = std::env::temp_dir().join(format!("card-core-finish-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let page = page_size(&sample_pdf(), 0).unwrap();
    let src = dir.join("src.pdf");
    sample_pdf().save(&src).unwrap();
    let docs = [DocumentSource {
        document_id: 0,
        pages: vec![page],
        groups: vec![PageGroup {
            pages: PageRange { first: 0, last: 0 },
            kind: PageGroupKind::Grid {
                grid: sample_grid(0.0),
            },
        }],
    }];
    let spec = SheetSpec {
        page: SheetPage::SameAsSource,
        rows: Some(2),
        columns: Some(2),
        gap_x_mm: 8.0,
        gap_y_mm: 8.0,
        margins: Margins::default(),
    };
    let sheets = plan_print_in(
        &docs,
        &[],
        &PrintLayout::Grid { spec },
        &PaginateOptions::default(),
    )
    .unwrap();
    let back_card = CardId::Grid {
        document_id: 0,
        page_index: 0,
        row: 2,
        column: 2,
    };
    let finishing = Finishing {
        options: FinishOptions {
            bleed: BleedOptions {
                mm: 3.0,
                source: BleedSource::Mirror,
            },
            duplex: DuplexOptions {
                on: true,
                flip: Flip::Long,
                common_back: Some(back_card),
                ..DuplexOptions::default()
            },
            ..FinishOptions::default()
        },
        backs: Vec::new(),
    };
    let (out, issues) = finish_sheets(sheets, &docs, &finishing).unwrap();
    assert!(issues.is_empty());
    let pdf = export_sheets(vec![(0, sample_pdf())], &out[..2]).unwrap();
    let out_path = dir.join("out.pdf");
    pdf.clone().save(&out_path).unwrap();

    let width_px = page.width_pt.round() as u32 * 2;
    let render = |path: &std::path::Path, page_index: usize| {
        let png = render_page_png(&pdfium, path, page_index, width_px).unwrap();
        image::load_from_memory(&png).unwrap().to_rgba8()
    };
    let before = render(&src, 0);
    let scale = before.width() as f64 / page.width_pt;
    let (front, back) = (render(&out_path, 0), render(&out_path, 1));

    // The source cards are 63.5 x 88 mm, packed from (left, top) of the sample page.
    let (cw, ch) = (mm_to_pt(63.5), mm_to_pt(88.0));
    let (left, top) = (
        (page.width_pt - cw * 3.0) / 2.0,
        (page.height_pt - ch * 3.0) / 2.0,
    );
    let (d, inset) = (mm_to_pt(1.5), mm_to_pt(8.0));
    let src_at = |col: f64, row: f64, dx: f64, dy: f64| {
        rgb_at(
            &before,
            (left + col * cw + dx) * scale,
            (top + row * ch + dy) * scale,
        )
    };

    let p = &out[0].placements;
    let first = p[0].destination;
    let second = p[1].destination;
    let at = |img: &image::RgbaImage, x: f64, y: f64| rgb_at(img, x * scale, y * scale);

    // d outside the left edge of the first piece shows what is d inside it.
    let want = src_at(0.0, 0.0, d, inset);
    assert_ne!(want, [255, 255, 255]);
    let got = at(&front, first.x - d, first.y + inset);
    assert!(near(got, want), "left bleed {got:?} is not {want:?}");
    // The right edge of the second piece (column 1 of the source).
    let want = src_at(1.0, 0.0, cw - d, inset);
    let got = at(&front, second.x + second.width + d, second.y + inset);
    assert!(near(got, want), "right bleed {got:?} is not {want:?}");
    // The top-left corner square.
    let want = src_at(0.0, 0.0, d, d);
    let got = at(&front, first.x - d, first.y - d);
    assert!(near(got, want), "corner bleed {got:?} is not {want:?}");
    // Past the bleed it is white again.
    assert!(near(
        at(&front, first.x - mm_to_pt(4.0), first.y + inset),
        [255, 255, 255]
    ));

    // The back of the first piece is the common back, in the mirrored slot.
    let b = out[1].placements[0].destination;
    assert!((b.x + b.width / 2.0 - (page.width_pt - (first.x + first.width / 2.0))).abs() < 1e-6);
    let want = src_at(2.0, 2.0, inset, inset);
    let got = at(&back, b.x + inset, b.y + inset);
    assert!(near(got, want), "back {got:?} is not {want:?}");
}
