//! The sheet engine: extract cards, paginate them, export the sheets.
use card_core::card::{
    CardId, OrientedRect, PageGroup, PageGroupKind, PageRange, DEFAULT_DOCUMENT_ID,
};
use card_core::export::{export_sheets, pdf_matrix};
use card_core::geometry::{PageSize, Point, Rect};
use card_core::layout::{calculate_layout, GridLayout};
use card_core::sample::{sample_grid, sample_pdf};
use card_core::sheet::{
    card_transform, extract_cards, paginate, plan_sheets, Card, CardSetting, Margins, Order,
    OutputSheet, PaginateOptions, SheetPage, SheetSpec, Turn,
};
use card_core::units::{mm_to_pt, pt_to_mm};
use card_core::Error;
use lopdf::Document;

const A4: PageSize = PageSize {
    width_pt: 595.2756,
    height_pt: 841.8898,
};

fn close(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-6, "{a} != {b}");
}

/// A card of `w` x `h` mm, identified by `n` (its column), from page 0 of `doc`.
fn card_in(doc: u32, n: usize, w: f64, h: f64) -> Card {
    let id = CardId::Grid {
        document_id: doc,
        page_index: 0,
        row: 0,
        column: n,
    };
    let rect = Rect::new(0.0, 0.0, mm_to_pt(w), mm_to_pt(h));
    Card::new(id, OrientedRect::from_rect(rect))
}

fn card(n: usize, w: f64, h: f64) -> Card {
    card_in(DEFAULT_DOCUMENT_ID, n, w, h)
}

fn column(id: CardId) -> usize {
    match id {
        CardId::Grid { column, .. } => column,
        CardId::Freeform { index, .. } => index,
    }
}

fn a4_sheet() -> SheetSpec {
    SheetSpec {
        page: SheetPage::Size(A4),
        rows: None,
        columns: None,
        gap_x_mm: 0.0,
        gap_y_mm: 0.0,
        margins: Margins::default(),
    }
}

fn run(cards: &[(Card, usize)]) -> Vec<OutputSheet> {
    paginate(cards, &a4_sheet(), &PaginateOptions::default()).unwrap()
}

fn order(sheets: &[OutputSheet]) -> Vec<usize> {
    sheets
        .iter()
        .flat_map(|s| s.placements.iter().map(|p| column(p.card_id)))
        .collect()
}

#[test]
fn nine_copies_of_one_card_fill_a_three_by_three_sheet() {
    let sheets = run(&[(card(0, 63.5, 88.0), 9)]);
    assert_eq!(sheets.len(), 1);
    let ps = &sheets[0].placements;
    assert_eq!(ps.len(), 9);
    // Row-major, edge to edge, centred on the page.
    close(ps[1].destination.x - ps[0].destination.x, mm_to_pt(63.5));
    close(ps[3].destination.y - ps[0].destination.y, mm_to_pt(88.0));
    close(
        ps[0].destination.x,
        (A4.width_pt - 3.0 * mm_to_pt(63.5)) / 2.0,
    );
    close(
        ps[0].destination.y,
        (A4.height_pt - 3.0 * mm_to_pt(88.0)) / 2.0,
    );
    assert!(ps.iter().all(|p| p.destination.width == mm_to_pt(63.5)));
}

#[test]
fn three_cards_three_times_each_share_one_sheet() {
    let cards: Vec<_> = (0..3).map(|n| (card(n, 63.5, 88.0), 3)).collect();
    let sheets = run(&cards);
    assert_eq!(sheets.len(), 1);
    assert_eq!(order(&sheets), [0, 0, 0, 1, 1, 1, 2, 2, 2]);
}

#[test]
fn a_quantity_that_does_not_fit_spills_onto_a_second_sheet() {
    let sheets = run(&[(card(0, 63.5, 88.0), 10)]);
    let counts: Vec<_> = sheets.iter().map(|s| s.placements.len()).collect();
    assert_eq!(counts, [9, 1]);
    // The second sheet starts at the first slot again.
    assert_eq!(
        sheets[1].placements[0].destination,
        sheets[0].placements[0].destination
    );
}

#[test]
fn grouped_and_interleaved_orders_with_unequal_quantities() {
    let cards = [
        (card(0, 63.5, 88.0), 4), // A
        (card(1, 63.5, 88.0), 2), // B
        (card(2, 63.5, 88.0), 3), // C
    ];
    let with = |order| {
        let options = PaginateOptions {
            order,
            group_by_size: true,
        };
        paginate(&cards, &a4_sheet(), &options).unwrap()
    };
    assert_eq!(order(&with(Order::Grouped)), [0, 0, 0, 0, 1, 1, 2, 2, 2]);
    assert_eq!(
        order(&with(Order::Interleaved)),
        [0, 1, 2, 0, 1, 2, 0, 2, 0]
    );
}

#[test]
fn zero_quantities_print_nothing() {
    assert!(run(&[(card(0, 63.5, 88.0), 0)]).is_empty());
    assert!(run(&[]).is_empty());
}

#[test]
fn mixed_sizes_get_their_own_sheets_when_grouping_by_size() {
    let portrait = card(0, 63.5, 88.0);
    let landscape = card(1, 88.0, 63.5);
    let cards = [(portrait, 2), (landscape, 2), (card(2, 63.6, 88.2), 1)];
    let sheets = run(&cards);
    // 63.6 x 88.2 is within 0.5 mm of the portrait size, so it shares its sheet.
    assert_eq!(sheets.len(), 2);
    assert_eq!(order(&sheets[..1]), [0, 0, 2]);
    assert_eq!(order(&sheets[1..]), [1, 1]);
    // Each group has a grid that fits its own size: a 2 x 4 grid for the landscape cards.
    let l = &sheets[1].placements;
    close(l[1].destination.x - l[0].destination.x, mm_to_pt(88.0));
    // Within a group the slots are as large as its largest card; the smaller one is centred.
    let p = &sheets[0].placements;
    close(p[2].destination.width, mm_to_pt(63.6));
    // Three slots of 63.6 mm, centred on the page; the 63.5 mm card sits in the middle of its slot.
    let slots_x = (A4.width_pt - 3.0 * mm_to_pt(63.6)) / 2.0;
    close(p[2].destination.x, slots_x + 2.0 * mm_to_pt(63.6));
    close(p[0].destination.x, slots_x + mm_to_pt(0.05));
}

#[test]
fn mixed_sizes_share_one_grid_when_grouping_is_off() {
    let cards = [(card(0, 63.5, 88.0), 1), (card(1, 88.0, 63.5), 1)];
    let options = PaginateOptions {
        order: Order::Grouped,
        group_by_size: false,
    };
    let sheets = paginate(&cards, &a4_sheet(), &options).unwrap();
    assert_eq!(sheets.len(), 1);
    let (a, b) = (&sheets[0].placements[0], &sheets[0].placements[1]);
    // The slot is 88 x 88 mm (the largest of each side); sizes are kept.
    close(a.destination.width, mm_to_pt(63.5));
    close(b.destination.height, mm_to_pt(63.5));
    close(
        b.destination.x - a.destination.x + (mm_to_pt(88.0) - mm_to_pt(63.5)) / 2.0,
        mm_to_pt(88.0),
    );
    // Smaller cards are centred in their slot.
    let slot_a_x = a.destination.x - (mm_to_pt(88.0) - mm_to_pt(63.5)) / 2.0;
    close(slot_a_x, (A4.width_pt - 2.0 * mm_to_pt(88.0)) / 2.0);
    let slot_y = a.destination.y - (mm_to_pt(88.0) - mm_to_pt(88.0)) / 2.0;
    close(
        b.destination.y - slot_y,
        (mm_to_pt(88.0) - mm_to_pt(63.5)) / 2.0,
    );
}

#[test]
fn order_applies_within_each_size_group() {
    let cards = [
        (card(0, 63.5, 88.0), 2),
        (card(1, 88.0, 63.5), 2),
        (card(2, 63.5, 88.0), 2),
    ];
    let options = PaginateOptions {
        order: Order::Interleaved,
        group_by_size: true,
    };
    let sheets = paginate(&cards, &a4_sheet(), &options).unwrap();
    assert_eq!(order(&sheets), [0, 2, 0, 2, 1, 1]);
}

#[test]
fn cards_from_two_documents_share_a_sheet() {
    let cards = [
        (card_in(0, 0, 63.5, 88.0), 2),
        (card_in(1, 0, 63.5, 88.0), 2),
    ];
    let sheets = run(&cards);
    assert_eq!(sheets.len(), 1);
    let docs: Vec<_> = sheets[0]
        .placements
        .iter()
        .map(|p| p.card_id.document_id())
        .collect();
    assert_eq!(docs, [0, 0, 1, 1]);

    // And the export imports both PDFs once, with one form per source page.
    let out = export_sheets(vec![(0, sample_pdf()), (1, sample_pdf())], &sheets).unwrap();
    assert_eq!(out.get_pages().len(), 1);
    let page_id = *out.get_pages().values().next().unwrap();
    let resources = out
        .get_dictionary(page_id)
        .unwrap()
        .get(b"Resources")
        .unwrap();
    let xobjects = resources
        .as_dict()
        .unwrap()
        .get(b"XObject")
        .unwrap()
        .as_dict()
        .unwrap();
    let f0 = xobjects.get(b"S0_0").unwrap().as_reference().unwrap();
    let f1 = xobjects.get(b"S1_0").unwrap().as_reference().unwrap();
    assert_ne!(f0, f1, "each document's page has its own form");
    let content = String::from_utf8(out.get_page_content(page_id)).unwrap();
    assert_eq!(content.matches("/S0_0 Do").count(), 2);
    assert_eq!(content.matches("/S1_0 Do").count(), 2);

    // The result is a valid file in which both forms still hold their page's content.
    let mut bytes = Vec::new();
    out.clone().save_to(&mut bytes).unwrap();
    let reloaded = Document::load_mem(&bytes).unwrap();
    for form in [f0, f1] {
        let stream = reloaded.get_object(form).unwrap().as_stream().unwrap();
        let body = String::from_utf8_lossy(&stream.decompressed_content().unwrap()).to_string();
        assert!(body.contains("Tj"), "form {form:?} lost its content");
    }
}

#[test]
fn export_rejects_unknown_and_repeated_documents() {
    let sheets = run(&[(card_in(7, 0, 63.5, 88.0), 1)]);
    let missing = export_sheets(vec![(0, sample_pdf())], &sheets);
    assert!(matches!(missing, Err(Error::Malformed(_))));
    let twice = export_sheets(vec![(0, sample_pdf()), (0, sample_pdf())], &sheets);
    assert!(matches!(twice, Err(Error::Malformed(_))));
    assert!(export_sheets(Vec::new(), &sheets).is_err());
}

#[test]
fn a_rotated_card_turned_and_scaled_lands_where_expected() {
    // A card 60 x 80 pt scanned 7 degrees clockwise, printed turned 90 degrees at 97%.
    let source = OrientedRect {
        center: Point { x: 100.0, y: 200.0 },
        width: 60.0,
        height: 80.0,
        angle_deg: 7.0,
    };
    let mut card = Card::new(
        CardId::Freeform {
            document_id: 0,
            page_index: 0,
            index: 0,
        },
        source,
    );
    card.turn = Turn::R90;
    card.scale = 0.97;
    let spec = SheetSpec {
        page: SheetPage::Size(PageSize {
            width_pt: 600.0,
            height_pt: 800.0,
        }),
        ..a4_sheet()
    };
    let sheets = paginate(&[(card, 1)], &spec, &PaginateOptions::default()).unwrap();
    let p = sheets[0].placements[0];

    // Final size: source size x scale, width and height swapped by the quarter turn.
    close(p.destination.width, 80.0 * 0.97);
    close(p.destination.height, 60.0 * 0.97);
    assert_eq!((p.turn, p.scale), (Turn::R90, 0.97));

    let m = card_transform(&p.source, p.scale, p.turn, &p.destination);
    // The centre lands on the centre of the slot.
    let c = m.apply(source.center);
    close(c.x, p.destination.x + p.destination.width / 2.0);
    close(c.y, p.destination.y + p.destination.height / 2.0);
    // The corners land on the corners of the upright box: the card's top-left corner goes to the
    // top-right (a clockwise quarter turn), and its top edge runs down the right side.
    let [tl, tr, br, bl] = source.corners().map(|k| m.apply(k));
    let d = p.destination;
    let (left, right, top, bottom) = (d.x, d.x + d.width, d.y, d.y + d.height);
    close(tl.x, right);
    close(tl.y, top);
    close(tr.x, right);
    close(tr.y, bottom);
    close(br.x, left);
    close(br.y, bottom);
    close(bl.x, left);
    close(bl.y, top);
}

#[test]
fn the_pdf_matrix_agrees_with_the_page_space_transform() {
    let source = OrientedRect {
        center: Point { x: 120.0, y: 300.0 },
        width: 90.0,
        height: 130.0,
        angle_deg: -4.0,
    };
    let dest = Rect::new(30.0, 40.0, 130.0 * 0.9, 90.0 * 0.9);
    let t = card_transform(&source, 0.9, Turn::R270, &dest);
    // A CropBox that does not start at the origin, and a sheet 500 pt tall.
    let display_box = [10.0, 20.0, 585.0, 820.0];
    let out_height = 500.0;
    let [a, b, c, d, e, f] = pdf_matrix(&t, display_box, out_height);
    for corner in source.corners() {
        let q = t.apply(corner);
        // The corner as the source form draws it (bottom-left origin), carried through `cm`.
        let (x, y) = (display_box[0] + corner.x, display_box[3] - corner.y);
        close(a * x + c * y + e, q.x);
        close(b * x + d * y + f, out_height - q.y);
    }
}

#[test]
fn rotated_sources_are_clipped_with_a_rotated_path() {
    let mut rotated = card(0, 63.5, 88.0);
    rotated.source.angle_deg = 7.0;
    let upright = card(1, 63.5, 88.0);
    let sheets = run(&[(rotated, 1), (upright, 1)]);
    let out = export_sheets(vec![(0, sample_pdf())], &sheets).unwrap();
    let page_id = *out.get_pages().values().next().unwrap();
    let content = String::from_utf8(out.get_page_content(page_id)).unwrap();
    assert_eq!(
        content.matches(" h W n").count(),
        1,
        "the rotated card is clipped by a path"
    );
    assert_eq!(
        content.matches(" re W n").count(),
        1,
        "the upright one by a rectangle"
    );
}

fn lcg(state: &std::cell::Cell<u64>) -> f64 {
    let next = state
        .get()
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    state.set(next);
    (next >> 11) as f64 / (1u64 << 53) as f64
}

#[test]
fn all_cards_in_order_matches_the_layout_engine() {
    let rng = std::cell::Cell::new(42u64);
    let r = |lo: f64, hi: f64| lo + (hi - lo) * lcg(&rng);
    let mut checked = 0;
    for _ in 0..600 {
        let page = PageSize {
            width_pt: r(300.0, 800.0),
            height_pt: r(400.0, 900.0),
        };
        let grid = GridLayout {
            bounds: Rect::new(r(0.0, 0.3), r(0.0, 0.3), r(0.3, 0.7), r(0.3, 0.7)),
            rows: r(1.0, 6.0) as usize,
            columns: r(1.0, 6.0) as usize,
            source_gap_x_mm: r(0.0, 4.0),
            source_gap_y_mm: r(0.0, 4.0),
            gap_x_mm: r(0.0, 8.0),
            gap_y_mm: r(0.0, 8.0),
            margin_top_mm: r(0.0, 15.0),
            margin_right_mm: r(0.0, 15.0),
            margin_bottom_mm: r(0.0, 15.0),
            margin_left_mm: r(0.0, 15.0),
            output_page: (lcg(&rng) < 0.5).then(|| PageSize {
                width_pt: r(300.0, 900.0),
                height_pt: r(400.0, 1000.0),
            }),
            fit_page: lcg(&rng) < 0.3,
        };
        let Ok(layout) = calculate_layout(page, &grid, None) else {
            continue;
        };
        if layout.overflow.is_some() {
            continue;
        }
        checked += 1;

        let group = PageGroup {
            pages: PageRange { first: 0, last: 0 },
            kind: PageGroupKind::Grid { grid },
        };
        let cards = extract_cards(DEFAULT_DOCUMENT_ID, &[page], &[group]).unwrap();
        let spec = SheetSpec {
            page: if grid.fit_page {
                SheetPage::Fit
            } else {
                SheetPage::Size(layout.output_page)
            },
            rows: Some(grid.rows),
            columns: Some(grid.columns),
            gap_x_mm: grid.gap_x_mm,
            gap_y_mm: grid.gap_y_mm,
            margins: Margins {
                top_mm: grid.margin_top_mm,
                right_mm: grid.margin_right_mm,
                bottom_mm: grid.margin_bottom_mm,
                left_mm: grid.margin_left_mm,
            },
        };
        let all: Vec<_> = cards.into_iter().map(|c| (c, 1)).collect();
        let sheets = paginate(&all, &spec, &PaginateOptions::default()).unwrap();

        assert_eq!(sheets.len(), 1, "{grid:?}");
        let sheet = &sheets[0];
        close(sheet.page.width_pt, layout.output_page.width_pt);
        close(sheet.page.height_pt, layout.output_page.height_pt);
        assert_eq!(sheet.placements.len(), layout.placements.len());
        for (p, l) in sheet.placements.iter().zip(&layout.placements) {
            let src = p.source.as_rect().expect("grid cards are unrotated");
            for (got, want) in [
                (src.x, l.source.x),
                (src.y, l.source.y),
                (src.width, l.source.width),
                (src.height, l.source.height),
                (p.destination.x, l.destination.x),
                (p.destination.y, l.destination.y),
                (p.destination.width, l.destination.width),
                (p.destination.height, l.destination.height),
            ] {
                assert!((got - want).abs() < 1e-6, "{got} != {want} for {grid:?}");
            }
            assert_eq!((p.turn, p.scale), (Turn::R0, 1.0));
        }
    }
    assert!(checked > 200, "only {checked} random grids were usable");
}

#[test]
fn export_document_still_builds_the_same_pages_through_export_sheets() {
    // The wrapper and a hand-built sheet list give the same content.
    let mut doc = sample_pdf();
    let grid = sample_grid(3.0);
    let job = card_core::export::ExportJob {
        pages: vec![card_core::export::PageJob {
            page_index: 0,
            grid,
        }],
    };
    card_core::export::export_document(&mut doc, &job).unwrap();
    let layout = calculate_layout(
        card_core::export::page_size(&sample_pdf(), 0).unwrap(),
        &grid,
        None,
    )
    .unwrap();
    let cards = extract_cards(
        0,
        &[card_core::export::page_size(&sample_pdf(), 0).unwrap()],
        &[PageGroup {
            pages: PageRange { first: 0, last: 0 },
            kind: PageGroupKind::Grid { grid },
        }],
    )
    .unwrap();
    let spec = SheetSpec {
        page: SheetPage::Size(layout.output_page),
        rows: Some(3),
        columns: Some(3),
        gap_x_mm: 3.0,
        gap_y_mm: 3.0,
        margins: Margins::default(),
    };
    let all: Vec<_> = cards.into_iter().map(|c| (c, 1)).collect();
    let sheets = paginate(&all, &spec, &PaginateOptions::default()).unwrap();
    let other = export_sheets(vec![(0, sample_pdf())], &sheets).unwrap();
    let content = |d: &Document| {
        let id = *d.get_pages().values().next().unwrap();
        String::from_utf8(d.get_page_content(id)).unwrap()
    };
    // Same operators; numbers agree to the 4 decimals that are written.
    assert_eq!(
        content(&doc).lines().count(),
        content(&other).lines().count()
    );
    for (a, b) in content(&doc).lines().zip(content(&other).lines()) {
        let nums = |l: &str| -> Vec<f64> {
            l.split_whitespace()
                .filter_map(|t| t.parse().ok())
                .collect()
        };
        let (na, nb) = (nums(a), nums(b));
        assert_eq!(na.len(), nb.len(), "{a} vs {b}");
        for (x, y) in na.iter().zip(&nb) {
            assert!((x - y).abs() < 1e-3, "{a} vs {b}");
        }
    }
}

#[test]
fn a_card_that_does_not_fit_is_an_error_not_a_shrink() {
    let too_big = [(card(0, 250.0, 100.0), 1)];
    let err = paginate(&too_big, &a4_sheet(), &PaginateOptions::default()).unwrap_err();
    assert!(matches!(err, Error::DoesNotFit { .. }), "{err}");

    // Asking for more columns than fit is the same error.
    let spec = SheetSpec {
        columns: Some(4),
        ..a4_sheet()
    };
    let err = paginate(
        &[(card(0, 63.5, 88.0), 1)],
        &spec,
        &PaginateOptions::default(),
    )
    .unwrap_err();
    assert!(matches!(err, Error::DoesNotFit { .. }), "{err}");

    // A turn that makes the card too wide counts too: 250 x 100 turned is 100 x 250, which fits.
    let mut turned = card(0, 250.0, 100.0);
    turned.turn = Turn::R90;
    assert!(paginate(&[(turned, 1)], &a4_sheet(), &PaginateOptions::default()).is_ok());
}

#[test]
fn gaps_and_margins_limit_how_many_fit() {
    let spec = SheetSpec {
        gap_x_mm: 10.0,
        margins: Margins {
            left_mm: 10.0,
            right_mm: 10.0,
            ..Margins::default()
        },
        ..a4_sheet()
    };
    // 190 mm usable: 2 cards of 63.5 + gaps fit (137), 3 need 210.5.
    let sheets = paginate(
        &[(card(0, 63.5, 88.0), 7)],
        &spec,
        &PaginateOptions::default(),
    )
    .unwrap();
    let first = &sheets[0].placements;
    // 2 columns x 3 rows per sheet, so the seventh card goes on a second sheet.
    assert_eq!(sheets.len(), 2);
    assert_eq!(first.len(), 6);
    close(
        first[1].destination.x - first[0].destination.x,
        mm_to_pt(73.5),
    );
}

#[test]
fn a_fit_page_is_sized_around_the_block_of_slots() {
    let spec = SheetSpec {
        page: SheetPage::Fit,
        rows: Some(2),
        columns: Some(3),
        gap_x_mm: 2.0,
        gap_y_mm: 4.0,
        margins: Margins {
            top_mm: 5.0,
            right_mm: 6.0,
            bottom_mm: 7.0,
            left_mm: 8.0,
        },
    };
    let sheets = paginate(
        &[(card(0, 60.0, 80.0), 7)],
        &spec,
        &PaginateOptions::default(),
    )
    .unwrap();
    assert_eq!(sheets.len(), 2);
    for s in &sheets {
        close(
            pt_to_mm(s.page.width_pt),
            8.0 + 3.0 * 60.0 + 2.0 * 2.0 + 6.0,
        );
        close(pt_to_mm(s.page.height_pt), 5.0 + 2.0 * 80.0 + 4.0 + 7.0);
    }
    close(sheets[0].placements[0].destination.x, mm_to_pt(8.0));
    close(sheets[0].placements[0].destination.y, mm_to_pt(5.0));

    let no_counts = SheetSpec { rows: None, ..spec };
    assert!(paginate(
        &[(card(0, 60.0, 80.0), 1)],
        &no_counts,
        &PaginateOptions::default()
    )
    .is_err());
}

#[test]
fn invalid_input_is_an_error() {
    let opts = PaginateOptions::default();
    let mut bad_scale = card(0, 63.5, 88.0);
    bad_scale.scale = 0.0;
    assert!(paginate(&[(bad_scale, 1)], &a4_sheet(), &opts).is_err());
    let negative_gap = SheetSpec {
        gap_x_mm: -1.0,
        ..a4_sheet()
    };
    assert!(paginate(&[(card(0, 63.5, 88.0), 1)], &negative_gap, &opts).is_err());
    let zero_rows = SheetSpec {
        rows: Some(0),
        ..a4_sheet()
    };
    assert!(paginate(&[(card(0, 63.5, 88.0), 1)], &zero_rows, &opts).is_err());
    assert!(paginate(&[(card(0, 63.5, 88.0), usize::MAX)], &a4_sheet(), &opts).is_err());
}

#[test]
fn turns_serialise_as_degrees() {
    assert_eq!(
        serde_json::to_value(Turn::R270).unwrap(),
        serde_json::json!(270)
    );
    assert_eq!(
        serde_json::from_value::<Turn>(serde_json::json!(90)).unwrap(),
        Turn::R90
    );
    assert!(serde_json::from_value::<Turn>(serde_json::json!(45)).is_err());
}

#[test]
fn the_ipc_json_shapes_deserialise_with_defaults() {
    let spec: SheetSpec = serde_json::from_value(serde_json::json!({
        "page": {"kind": "size", "width_pt": 595.0, "height_pt": 842.0},
        "columns": 3,
        "gap_x_mm": 2.5
    }))
    .unwrap();
    assert_eq!(
        (spec.rows, spec.columns, spec.gap_y_mm),
        (None, Some(3), 0.0)
    );
    assert_eq!(spec.margins, Margins::default());
    let fit: SheetSpec =
        serde_json::from_value(serde_json::json!({"page": {"kind": "fit"}})).unwrap();
    assert_eq!(fit.page, SheetPage::Fit);

    let options: PaginateOptions =
        serde_json::from_value(serde_json::json!({"order": "interleaved"})).unwrap();
    assert_eq!(options.order, Order::Interleaved);
    assert!(options.group_by_size, "grouping by size is the default");

    let setting: CardSetting = serde_json::from_value(serde_json::json!({
        "id": {"kind": "grid", "document_id": 0, "page_index": 1, "row": 0, "column": 2}
    }))
    .unwrap();
    assert_eq!(
        (setting.quantity, setting.turn, setting.scale),
        (1, Turn::R0, 1.0)
    );

    // Sheets go back out as plain data the preview can draw.
    let sheets = run(&[(card(0, 63.5, 88.0), 1)]);
    let json = serde_json::to_value(&sheets).unwrap();
    assert_eq!(json[0]["placements"][0]["turn"], 0);
    assert_eq!(json[0]["placements"][0]["card_id"]["kind"], "grid");
    assert!(json[0]["page"]["width_pt"].is_number());
}

fn grid_group(first: usize, last: usize, grid: GridLayout) -> PageGroup {
    PageGroup {
        pages: PageRange { first, last },
        kind: PageGroupKind::Grid { grid },
    }
}

#[test]
fn extract_cards_follows_the_groups() {
    let pages = [A4, A4, A4, A4];
    let mut two_by_two = sample_grid(0.0);
    two_by_two.rows = 2;
    two_by_two.columns = 2;
    let groups = [
        PageGroup {
            pages: PageRange { first: 0, last: 0 },
            kind: PageGroupKind::Skip,
        },
        grid_group(1, 1, sample_grid(0.0)),
        grid_group(2, 2, two_by_two),
        PageGroup {
            pages: PageRange { first: 3, last: 3 },
            kind: PageGroupKind::Freeform {
                cards: vec![OrientedRect {
                    center: Point { x: 100.0, y: 100.0 },
                    width: 50.0,
                    height: 70.0,
                    angle_deg: 3.0,
                }],
            },
        },
    ];
    let cards = extract_cards(DEFAULT_DOCUMENT_ID, &pages, &groups).unwrap();
    assert_eq!(cards.len(), 9 + 4 + 1);
    // Skipped pages give none; grid cards are unrotated, scale 1, row-major.
    assert!(cards[..13]
        .iter()
        .all(|c| c.source.angle_deg == 0.0 && c.scale == 1.0));
    assert_eq!(
        cards[4].id,
        CardId::Grid {
            document_id: 0,
            page_index: 1,
            row: 1,
            column: 1
        }
    );
    assert_eq!(cards[9].id.page_index(), 2);
    // Freeform cards map one to one, keeping their rotation.
    assert_eq!(
        cards[13].id,
        CardId::Freeform {
            document_id: 0,
            page_index: 3,
            index: 0
        }
    );
    assert_eq!(cards[13].source.angle_deg, 3.0);

    let out_of_range = [grid_group(0, 4, sample_grid(0.0))];
    assert!(matches!(
        extract_cards(0, &pages, &out_of_range),
        Err(Error::PageOutOfRange(4, 4))
    ));
}

#[test]
fn the_default_plan_prints_every_card_once_in_order() {
    let groups = [grid_group(0, 0, sample_grid(0.0))];
    let spec = SheetSpec {
        page: SheetPage::Size(A4),
        rows: Some(3),
        columns: Some(3),
        ..a4_sheet()
    };
    let opts = PaginateOptions::default();
    let sheets = plan_sheets(0, &[A4], &groups, &[], &spec, &opts).unwrap();
    assert_eq!(sheets.len(), 1);
    let cols: Vec<_> = sheets[0]
        .placements
        .iter()
        .map(|p| match p.card_id {
            CardId::Grid { row, column, .. } => (row, column),
            CardId::Freeform { .. } => unreachable!(),
        })
        .collect();
    assert_eq!(cols, (0..9).map(|i| (i / 3, i % 3)).collect::<Vec<_>>());

    // Settings change a card's quantity, turn and scale; other cards are untouched.
    let id = CardId::Grid {
        document_id: 0,
        page_index: 0,
        row: 0,
        column: 0,
    };
    let settings = [CardSetting {
        id,
        quantity: 3,
        turn: Turn::R180,
        scale: 0.5,
    }];
    let sheets = plan_sheets(0, &[A4], &groups, &settings, &spec, &opts).unwrap();
    let total: usize = sheets.iter().map(|s| s.placements.len()).sum();
    assert_eq!(total, 8 + 3);
    let first = sheets[0].placements[0];
    assert_eq!(
        (first.card_id, first.turn, first.scale),
        (id, Turn::R180, 0.5)
    );
    close(
        first.destination.width,
        first.source.as_rect().unwrap().width * 0.5,
    );
}
