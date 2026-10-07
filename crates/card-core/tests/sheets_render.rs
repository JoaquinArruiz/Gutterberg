//! Renders exported sheets with pdfium to check that a turned card really shows up turned,
//! clipped to its own box. Skipped when pdfium is not available (set `PDFIUM_LIB_PATH`).
use card_core::card::{CardId, DEFAULT_DOCUMENT_ID};
use card_core::card::{PageGroup, PageGroupKind, PageRange};
use card_core::export::{export_sheets, page_size};
use card_core::geometry::PageSize;
use card_core::layout::GridLayout;
use card_core::render::{bind_pdfium, render_page_png};
use card_core::sample::{sample_grid, sample_pdf};
use card_core::sheet::{extract_cards, paginate, PaginateOptions, SheetPage, SheetSpec, Turn};
use card_core::sheet::{Margins, OutputSheet};

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

fn grid() -> GridLayout {
    sample_grid(0.0)
}

fn sheet_with(card_turn: Turn, page: PageSize) -> OutputSheet {
    let group = PageGroup {
        pages: PageRange { first: 0, last: 0 },
        kind: PageGroupKind::Grid { grid: grid() },
    };
    let mut cards = extract_cards(DEFAULT_DOCUMENT_ID, &[page], &[group]).unwrap();
    // Card (row 0, column 0): the top-left card of the sample page.
    assert!(matches!(
        cards[0].id,
        CardId::Grid {
            row: 0,
            column: 0,
            ..
        }
    ));
    cards[0].turn = card_turn;
    let spec = SheetSpec {
        page: SheetPage::Size(page),
        rows: None,
        columns: None,
        gap_x_mm: 0.0,
        gap_y_mm: 0.0,
        margins: Margins::default(),
    };
    let mut sheets = paginate(&[(cards[0], 1)], &spec, &PaginateOptions::default()).unwrap();
    sheets.remove(0)
}

#[test]
fn every_turn_shows_the_card_turned_clockwise_and_clipped() {
    let Ok(pdfium) = bind_pdfium(&[]) else {
        assert!(
            std::env::var_os("CI").is_none(),
            "pdfium not available in CI"
        );
        eprintln!("SKIPPED pdfium render: pdfium not available (set PDFIUM_LIB_PATH)");
        return;
    };
    let dir = std::env::temp_dir().join(format!("card-core-sheets-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let page = page_size(&sample_pdf(), 0).unwrap();
    let src = dir.join("src.pdf");
    sample_pdf().save(&src).unwrap();
    let render = |path: &std::path::Path| {
        let png = render_page_png(&pdfium, path, 0, page.width_pt.round() as u32).unwrap();
        image::load_from_memory(&png).unwrap().to_rgba8()
    };
    let before = render(&src);
    let scale = before.width() as f64 / page.width_pt;

    let first = &card_core::sheet::extract_cards(
        DEFAULT_DOCUMENT_ID,
        &[page],
        &[PageGroup {
            pages: PageRange { first: 0, last: 0 },
            kind: PageGroupKind::Grid { grid: grid() },
        }],
    )
    .unwrap()[0];
    let rect = first.source.as_rect().unwrap();
    // A point just inside the card's top-left corner: plain fill, no text or circle.
    let (u, v) = (rect.width * 0.1, rect.height * 0.1);
    let want = rgb_at(&before, (rect.x + u) * scale, (rect.y + v) * scale);
    assert_ne!(want, [255, 255, 255]);

    for turn in [Turn::R0, Turn::R90, Turn::R180, Turn::R270] {
        let sheet = sheet_with(turn, page);
        let d = sheet.placements[0].destination;
        let out_path = dir.join(format!("out-{}.pdf", turn.degrees()));
        let out = export_sheets(vec![(DEFAULT_DOCUMENT_ID, sample_pdf())], &[sheet]).unwrap();
        out.clone().save(&out_path).unwrap();
        let after = render(&out_path);

        // Where the card's top-left corner went: a clockwise turn carries it round the box.
        let (left, top, right, bottom) = (d.x, d.y, d.x + d.width, d.y + d.height);
        let (px, py) = match turn {
            Turn::R0 => (left + u, top + v),
            Turn::R90 => (right - v, top + u),
            Turn::R180 => (right - u, bottom - v),
            Turn::R270 => (left + v, bottom - u),
        };
        let got = rgb_at(&after, px * scale, py * scale);
        assert!(near(got, want), "turn {turn:?}: {got:?} is not {want:?}");

        // Nothing of the neighbouring cards shows outside the box.
        for (ox, oy) in [
            (left - 4.0, top + 20.0),
            (right + 4.0, top + 20.0),
            (left + 20.0, bottom + 4.0),
        ] {
            let c = rgb_at(&after, ox * scale, oy * scale);
            assert!(
                near(c, [255, 255, 255]),
                "turn {turn:?}: {c:?} outside the card"
            );
        }
    }
}

#[test]
fn a_tilted_freeform_card_comes_out_straight_and_clipped_whichever_way_it_is_turned() {
    use card_core::card::OrientedRect;
    use card_core::geometry::Point;
    use card_core::sheet::Card;
    use card_core::units::mm_to_pt;

    let Ok(pdfium) = bind_pdfium(&[]) else {
        assert!(
            std::env::var_os("CI").is_none(),
            "pdfium not available in CI"
        );
        eprintln!("SKIPPED pdfium render: pdfium not available (set PDFIUM_LIB_PATH)");
        return;
    };
    let dir = std::env::temp_dir().join(format!("card-core-tilted-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let page = page_size(&sample_pdf(), 0).unwrap();
    let src = dir.join("src.pdf");
    sample_pdf().save(&src).unwrap();
    let render = |path: &std::path::Path| {
        let png = render_page_png(&pdfium, path, 0, (page.width_pt * 2.0).round() as u32).unwrap();
        image::load_from_memory(&png).unwrap().to_rgba8()
    };
    let before = render(&src);
    let scale = before.width() as f64 / page.width_pt;

    // A 40 x 60 mm card drawn at 8 degrees on the middle card (plain fill outside its circle).
    let (w, h, angle) = (mm_to_pt(40.0), mm_to_pt(60.0), 8.0_f64);
    let source = OrientedRect {
        center: Point {
            x: page.width_pt / 2.0,
            y: page.height_pt / 2.0,
        },
        width: w,
        height: h,
        angle_deg: angle,
    };
    let id = CardId::Freeform {
        document_id: DEFAULT_DOCUMENT_ID,
        page_index: 0,
        index: 0,
    };
    // Four points inside the card, near its corners, in its own frame (centre origin, y down).
    let local = [(-0.4, -0.4), (0.4, -0.4), (0.4, 0.4), (-0.4, 0.4)].map(|(a, b)| (a * w, b * h));
    let (sin, cos) = angle.to_radians().sin_cos();
    let spec = SheetSpec {
        page: SheetPage::Size(page),
        rows: None,
        columns: None,
        gap_x_mm: 0.0,
        gap_y_mm: 0.0,
        margins: Margins::default(),
    };

    for turn in [Turn::R0, Turn::R180] {
        let mut card = Card::new(id, source);
        card.turn = turn;
        let sheet = paginate(&[(card, 1)], &spec, &PaginateOptions::default())
            .unwrap()
            .remove(0);
        let d = sheet.placements[0].destination;
        let (cx, cy) = (d.x + d.width / 2.0, d.y + d.height / 2.0);
        let out_path = dir.join(format!("out-{}.pdf", turn.degrees()));
        export_sheets(vec![(DEFAULT_DOCUMENT_ID, sample_pdf())], &[sheet])
            .unwrap()
            .save(&out_path)
            .unwrap();
        let after = render(&out_path);

        for (u, v) in local {
            // Where that point of the card is on the source page (rotated by the drawn angle)...
            let (sx, sy) = (
                source.center.x + u * cos - v * sin,
                source.center.y + u * sin + v * cos,
            );
            let want = rgb_at(&before, sx * scale, sy * scale);
            assert_ne!(want, [255, 255, 255]);
            // ...and on the sheet: straight, so just its offset from the centre, flipped for 180.
            let (ox, oy) = if turn == Turn::R180 { (-u, -v) } else { (u, v) };
            let got = rgb_at(&after, (cx + ox) * scale, (cy + oy) * scale);
            assert!(
                near(got, want),
                "turn {turn:?} at ({u:.1}, {v:.1}): {got:?} is not {want:?}"
            );
        }
        // Cut to the card: just outside its straight box is blank page, not the rest of the source.
        for (ox, oy) in [
            (-w / 2.0 - 4.0, 0.0),
            (w / 2.0 + 4.0, 0.0),
            (0.0, -h / 2.0 - 4.0),
            (0.0, h / 2.0 + 4.0),
        ] {
            let c = rgb_at(&after, (cx + ox) * scale, (cy + oy) * scale);
            assert!(
                near(c, [255, 255, 255]),
                "turn {turn:?}: {c:?} outside the card"
            );
        }
    }
}
