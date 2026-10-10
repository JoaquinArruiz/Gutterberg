//! The sheet engine: extract cards, paginate them, export the sheets.
use card_core::card::{
    CardId, OrientedRect, PageGroup, PageGroupKind, PageRange, DEFAULT_DOCUMENT_ID,
};
use card_core::export::{export_sheets, pdf_matrix};
use card_core::geometry::{PageSize, Point, Rect};
use card_core::layout::{calculate_layout, GridLayout};
use card_core::sample::{sample_grid, sample_pdf};
use card_core::sheet::{
    card_transform, card_transform_xy, extract_cards, paginate, plan_sheets, Card, CardSetting,
    Margins, Order, OutputSheet, PaginateOptions, SheetPage, SheetSpec, Turn,
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
            ..PaginateOptions::default()
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
        ..PaginateOptions::default()
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
        ..PaginateOptions::default()
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
    let content = card_core::export::drawn_content(&out, page_id);
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
    let content = card_core::export::drawn_content(&out, page_id);
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
        card_core::export::drawn_content(d, id)
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
        scale_y: None,
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

#[test]
fn auto_fill_repeats_the_requested_cards_until_the_last_sheet_is_full() {
    let cards = [
        (card(0, 63.5, 88.0), 1),
        (card(1, 63.5, 88.0), 1),
        (card(2, 63.5, 88.0), 1),
    ];
    let fill = PaginateOptions {
        auto_fill: true,
        ..PaginateOptions::default()
    };
    let sheets = paginate(&cards, &a4_sheet(), &fill).unwrap();
    // 3 cards on a 3 x 3 sheet go round three times.
    assert_eq!(order(&sheets), [0, 1, 2, 0, 1, 2, 0, 1, 2]);

    // 10 cards fill the second sheet too: 18 in all, starting again at the first card.
    let ten = [(card(0, 63.5, 88.0), 7), (card(1, 63.5, 88.0), 3)];
    let sheets = paginate(&ten, &a4_sheet(), &fill).unwrap();
    assert_eq!(
        sheets
            .iter()
            .map(|s| s.placements.len())
            .collect::<Vec<_>>(),
        [9, 9]
    );
    assert_eq!(order(&sheets)[..10], [0, 0, 0, 0, 0, 0, 0, 1, 1, 1]);
    assert_eq!(order(&sheets)[10..13], [0, 0, 0]);

    // Without it the last sheet is left partly empty, and a full sheet is left alone.
    let plain = paginate(&ten, &a4_sheet(), &PaginateOptions::default()).unwrap();
    assert_eq!(
        plain.iter().map(|s| s.placements.len()).collect::<Vec<_>>(),
        [9, 1]
    );
    let nine = paginate(&[(card(0, 63.5, 88.0), 9)], &a4_sheet(), &fill).unwrap();
    assert_eq!(nine.len(), 1);
    assert!(paginate(&[], &a4_sheet(), &fill).unwrap().is_empty());
}

#[test]
fn auto_fill_fills_each_size_group_separately() {
    let cards = [(card(0, 63.5, 88.0), 2), (card(1, 88.0, 63.5), 1)];
    let fill = PaginateOptions {
        auto_fill: true,
        ..PaginateOptions::default()
    };
    let sheets = paginate(&cards, &a4_sheet(), &fill).unwrap();
    // Portrait: 3 x 3 = 9; landscape: 2 x 4 = 8.
    assert_eq!(
        sheets
            .iter()
            .map(|s| s.placements.len())
            .collect::<Vec<_>>(),
        [9, 8]
    );
}

#[test]
fn the_page_size_can_follow_the_source_page() {
    let letter = PageSize {
        width_pt: 612.0,
        height_pt: 792.0,
    };
    let groups = [grid_group(0, 1, sample_grid(0.0))];
    let spec = SheetSpec {
        page: SheetPage::SameAsSource,
        ..a4_sheet()
    };
    let opts = PaginateOptions::default();
    // The first printed card's page decides the size.
    let sheets = plan_sheets(0, &[letter, A4], &groups, &[], &spec, &opts).unwrap();
    assert_eq!(sheets[0].page, letter);
    // paginate itself wants a concrete size.
    let direct = paginate(&[(card(0, 63.5, 88.0), 1)], &spec, &opts);
    assert!(matches!(direct, Err(Error::InvalidSheet(_))));
    // With nothing to print there is no page to size.
    let none: Vec<_> = (0..9)
        .map(|column| CardSetting {
            scale_y: None,
            id: CardId::Grid {
                document_id: 0,
                page_index: 0,
                row: column / 3,
                column: column % 3,
            },
            quantity: 0,
            turn: Turn::R0,
            scale: 1.0,
        })
        .collect();
    let one_page = [grid_group(0, 0, sample_grid(0.0))];
    assert!(plan_sheets(0, &[A4], &one_page, &none, &spec, &opts)
        .unwrap()
        .is_empty());
}

fn sample_page() -> PageSize {
    card_core::export::page_size(&sample_pdf(), 0).unwrap()
}

fn content_of(doc: &Document) -> String {
    let id = *doc.get_pages().values().next().unwrap();
    card_core::export::drawn_content(doc, id)
}

#[test]
fn same_as_source_is_what_the_cards_stage_exports() {
    use card_core::export::{export_document, ExportJob, PageJob};
    use card_core::sheet::{plan_print, PrintLayout};
    let page = sample_page();
    let mut grid = sample_grid(3.0);
    grid.margin_top_mm = 4.0;
    grid.margin_left_mm = 2.0;
    let groups = [grid_group(0, 0, grid)];

    let sheets = plan_print(
        0,
        &[page],
        &groups,
        &[],
        &PrintLayout::SameAsSource,
        &PaginateOptions::default(),
    )
    .unwrap();
    assert_eq!(sheets.len(), 1);
    let via_print = export_sheets(vec![(0, sample_pdf())], &sheets).unwrap();

    let mut old = sample_pdf();
    let job = ExportJob {
        pages: vec![PageJob {
            page_index: 0,
            grid,
        }],
    };
    export_document(&mut old, &job).unwrap();
    // Identical page content, down to the byte.
    assert_eq!(content_of(&via_print), content_of(&old));
    let size = |d: &Document| {
        let id = *d.get_pages().values().next().unwrap();
        format!(
            "{:?}",
            d.get_dictionary(id).unwrap().get(b"MediaBox").unwrap()
        )
    };
    assert_eq!(size(&via_print), size(&old));
}

#[test]
fn same_as_source_makes_one_sheet_per_grid_page_and_skips_the_rest() {
    use card_core::sheet::source_sheets;
    let mut two_by_two = sample_grid(2.0);
    two_by_two.rows = 2;
    two_by_two.columns = 2;
    let groups = [
        PageGroup {
            pages: PageRange { first: 0, last: 0 },
            kind: PageGroupKind::Skip,
        },
        grid_group(1, 2, sample_grid(2.0)),
        grid_group(3, 3, two_by_two),
    ];
    let sheets = source_sheets(0, &[A4; 4], &groups).unwrap();
    let counts: Vec<_> = sheets.iter().map(|s| s.placements.len()).collect();
    assert_eq!(counts, [9, 9, 4]);
    assert_eq!(sheets[2].placements[0].card_id.page_index(), 3);

    // A grid that does not fit its page is an error, never shrunk.
    let too_wide = [grid_group(0, 0, sample_grid(30.0))];
    assert!(matches!(
        source_sheets(0, &[A4], &too_wide),
        Err(Error::DoesNotFit { .. })
    ));
}

#[test]
fn print_layouts_deserialise_from_the_ipc_shapes() {
    use card_core::sheet::PrintLayout;
    let same: PrintLayout =
        serde_json::from_value(serde_json::json!({"kind": "same_as_source"})).unwrap();
    assert_eq!(same, PrintLayout::SameAsSource);
    let grid: PrintLayout = serde_json::from_value(serde_json::json!({
        "kind": "grid",
        "spec": {"page": {"kind": "same_as_source"}, "columns": 3}
    }))
    .unwrap();
    let PrintLayout::Grid { spec } = grid else {
        panic!("not a grid layout")
    };
    assert_eq!(
        (spec.page, spec.columns, spec.rows),
        (SheetPage::SameAsSource, Some(3), None)
    );
    let options: PaginateOptions =
        serde_json::from_value(serde_json::json!({"auto_fill": true})).unwrap();
    assert!(options.auto_fill && options.group_by_size);
}

#[test]
fn sheets_are_validated_against_the_pdf_before_exporting() {
    use card_core::export::{page_sizes, validate_sheets};
    use card_core::sample::set_rotate;
    let doc = sample_pdf();
    let sheets = run(&[(card(0, 63.5, 88.0), 2)]);
    assert!(validate_sheets(&doc, &sheets).is_empty());

    // A page the exporter cannot read is named; a document that was not provided too.
    let mut odd = sample_pdf();
    set_rotate(&mut odd, 45);
    let issues = validate_sheets(&odd, &sheets);
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].page_index, 0);
    assert!(page_sizes(&odd)[0].is_err());
    assert_eq!(page_sizes(&doc).len(), 1);
    let elsewhere = run(&[(card_in(5, 0, 63.5, 88.0), 1)]);
    assert_eq!(validate_sheets(&doc, &elsewhere).len(), 1);
}

#[test]
fn a_file_export_matches_the_in_memory_one_and_leaves_no_temp_file() {
    use card_core::export::export_sheets_file;
    let dir = std::env::temp_dir().join(format!("card-core-sheets-file-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (src, out) = (dir.join("in.pdf"), dir.join("out.pdf"));
    sample_pdf().save(&src).unwrap();
    let sheets = run(&[(card(0, 63.5, 88.0), 10)]);
    export_sheets_file(&src, &out, &sheets).unwrap();
    let written = Document::load(&out).unwrap();
    assert_eq!(written.get_pages().len(), 2);
    let direct = export_sheets(vec![(0, sample_pdf())], &sheets).unwrap();
    assert_eq!(content_of(&written), content_of(&direct));
    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty());
}

#[test]
fn planning_from_the_file_reports_unreadable_pages_only_when_they_are_used() {
    use card_core::export::plan_print_file;
    use card_core::finish::Finishing;
    use card_core::sample::set_rotate;
    use card_core::sheet::PrintLayout;
    let dir = std::env::temp_dir().join(format!("card-core-plan-file-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (good, odd) = (dir.join("good.pdf"), dir.join("odd.pdf"));
    sample_pdf().save(&good).unwrap();
    let mut doc = sample_pdf();
    set_rotate(&mut doc, 45);
    doc.save(&odd).unwrap();
    let opts = PaginateOptions::default();
    let layout = PrintLayout::SameAsSource;
    let used = [grid_group(0, 0, sample_grid(3.0))];

    let (sheets, issues) =
        plan_print_file(&good, &used, &[], &layout, &opts, &Finishing::default()).unwrap();
    assert_eq!((sheets.len(), issues.len()), (1, 0));

    // The unreadable page is named, and nothing is planned from it.
    let (sheets, issues) =
        plan_print_file(&odd, &used, &[], &layout, &opts, &Finishing::default()).unwrap();
    assert!(sheets.is_empty());
    assert_eq!(issues.iter().map(|i| i.page_index).collect::<Vec<_>>(), [0]);

    // Skipped, it does not matter.
    let skipped = [PageGroup {
        pages: PageRange { first: 0, last: 0 },
        kind: PageGroupKind::Skip,
    }];
    let (sheets, issues) =
        plan_print_file(&odd, &skipped, &[], &layout, &opts, &Finishing::default()).unwrap();
    assert!(sheets.is_empty() && issues.is_empty());

    // A group past the end of the document is an error.
    let beyond = [grid_group(0, 3, sample_grid(3.0))];
    assert!(plan_print_file(&good, &beyond, &[], &layout, &opts, &Finishing::default()).is_err());
}

#[test]
fn the_requests_the_frontend_sends_deserialise_and_plan() {
    use card_core::sheet::PrintLayout;
    // Written by the frontend's request builder; src/lib/print-request.test.ts checks it still
    // produces exactly this, so the two sides cannot drift apart unnoticed.
    let text = include_str!("data/print_request.json");
    let v: serde_json::Value = serde_json::from_str(text).unwrap();
    let groups: Vec<PageGroup> =
        serde_json::from_value(v["documents"][0]["groups"].clone()).unwrap();
    assert_eq!(v["documents"][0]["document_id"], 0);
    let settings: Vec<CardSetting> = serde_json::from_value(v["settings"].clone()).unwrap();
    let layout: PrintLayout = serde_json::from_value(v["layout"].clone()).unwrap();
    let options: PaginateOptions = serde_json::from_value(v["options"].clone()).unwrap();
    assert_eq!(options.order, Order::Interleaved);
    assert!(options.auto_fill && options.group_by_size);

    let pages = [A4; 3];
    // The library: one row of three cards on page 2, nothing from the skipped pages.
    let cards = extract_cards(0, &pages, &groups).unwrap();
    assert_eq!(cards.len(), 3);
    assert!(cards.iter().all(|c| c.id.page_index() == 1));

    // The plan: 4 x first card, 1 x third, none of the second; interleaved, filled up to the 2 x 3
    // sheet by going round the sequence again.
    let sheets =
        card_core::sheet::plan_print(0, &pages, &groups, &settings, &layout, &options).unwrap();
    assert_eq!(sheets.len(), 1);
    assert_eq!(sheets[0].placements.len(), 6);
    let columns: Vec<_> = sheets[0]
        .placements
        .iter()
        .map(|p| column(p.card_id))
        .collect();
    assert_eq!(columns, [0, 2, 0, 0, 0, 0]);
    // An A4 sheet with the 3 mm gap between cards from the request.
    assert!((sheets[0].page.width_pt - A4.width_pt).abs() < 1e-3);
    let d = &sheets[0].placements;
    let card_w = d[0].destination.width;
    close(
        d[1].destination.x - d[0].destination.x,
        card_w + mm_to_pt(3.0),
    );

    // The finishing the frontend sent reads back as chosen and finishes the sheets: a back sheet
    // after the front (the second card's back is the third card, the rest have the common back),
    // marks and bleed on the front.
    use card_core::finish::{finish_sheets, BleedSource, Finishing, Flip, MarkStyle, Side};
    let finishing: Finishing = serde_json::from_value(v["finishing"].clone()).unwrap();
    let o = &finishing.options;
    assert_eq!(o.marks.style, MarkStyle::Ticks);
    assert_eq!(
        (o.marks.width_mm, o.marks.length_mm, o.marks.offset_mm),
        (0.5, 4.0, 1.5)
    );
    assert_eq!(o.marks.color, "#ff0000");
    assert_eq!((o.bleed.mm, o.bleed.source), (2.0, BleedSource::Mirror));
    assert!(o.duplex.on && o.duplex.flip == Flip::Short);
    assert_eq!((o.duplex.offset_x_mm, o.duplex.offset_y_mm), (0.5, -0.5));
    assert_eq!(finishing.backs.len(), 1);
    let documents = [card_core::sheet::DocumentSource {
        document_id: 0,
        pages: pages.to_vec(),
        groups,
    }];
    let (done, issues) = finish_sheets(sheets, &documents, &finishing).unwrap();
    assert!(issues.is_empty());
    assert_eq!(done.len(), 2);
    assert_eq!((done[0].side, done[1].side), (Side::Front, Side::Back));
    assert!(done[0].marks.is_some() && done[0].bleed.mm == 2.0);
    assert_eq!(done[1].placements.len(), 6);
}

/// The print stage's own requests: a 3 x 3 source page, per-card settings, an A4 sheet of "as many
/// as fit" (3 x 3 of the 63.5 x 88 mm cards).
mod print_examples {
    use super::*;
    use card_core::sheet::{plan_print, PrintLayout};

    fn id(row: usize, column: usize) -> CardId {
        CardId::Grid {
            document_id: 0,
            page_index: 0,
            row,
            column,
        }
    }

    /// Settings for all nine cards: `copies` for the ones listed, none for the rest.
    fn settings(copies: &[((usize, usize), usize)]) -> Vec<CardSetting> {
        (0..9)
            .map(|i| CardSetting {
                scale_y: None,
                id: id(i / 3, i % 3),
                quantity: copies
                    .iter()
                    .find(|(rc, _)| *rc == (i / 3, i % 3))
                    .map_or(0, |(_, n)| *n),
                turn: Turn::R0,
                scale: 1.0,
            })
            .collect()
    }

    fn auto_a4() -> PrintLayout {
        PrintLayout::Grid {
            spec: SheetSpec {
                page: SheetPage::Size(A4),
                ..a4_sheet()
            },
        }
    }

    fn plan(copies: &[((usize, usize), usize)], options: PaginateOptions) -> Vec<OutputSheet> {
        let groups = [grid_group(0, 0, sample_grid(0.0))];
        plan_print(0, &[A4], &groups, &settings(copies), &auto_a4(), &options).unwrap()
    }

    fn cards_in_order(sheets: &[OutputSheet]) -> Vec<(usize, usize)> {
        sheets
            .iter()
            .flat_map(|s| &s.placements)
            .map(|p| match p.card_id {
                CardId::Grid { row, column, .. } => (row, column),
                CardId::Freeform { .. } => unreachable!(),
            })
            .collect()
    }

    #[test]
    fn nine_copies_of_card_one_fill_one_three_by_three_page() {
        let sheets = plan(&[((0, 0), 9)], PaginateOptions::default());
        assert_eq!(sheets.len(), 1);
        assert_eq!(cards_in_order(&sheets), vec![(0, 0); 9]);
        let d: Vec<_> = sheets[0].placements.iter().map(|p| p.destination).collect();
        // Three columns and three rows, edge to edge.
        close(d[2].x - d[0].x, 2.0 * d[0].width);
        close(d[6].y - d[0].y, 2.0 * d[0].height);
    }

    #[test]
    fn three_chosen_cards_fill_one_page_with_auto_fill() {
        let pick = [((0, 0), 1), ((1, 1), 1), ((2, 2), 1)];
        let one_each = plan(&pick, PaginateOptions::default());
        assert_eq!(one_each[0].placements.len(), 3);
        let filled = plan(
            &pick,
            PaginateOptions {
                auto_fill: true,
                ..PaginateOptions::default()
            },
        );
        assert_eq!(filled.len(), 1);
        assert_eq!(
            cards_in_order(&filled),
            [(0, 0), (1, 1), (2, 2)].repeat(3),
            "three round trips of the chosen cards fill the 9 slots"
        );
    }

    #[test]
    fn four_two_and_three_copies_in_both_orders() {
        let copies = [((0, 0), 4), ((0, 1), 2), ((0, 2), 3)];
        let [a, b, c] = [(0, 0), (0, 1), (0, 2)];
        let grouped = plan(&copies, PaginateOptions::default());
        assert_eq!(cards_in_order(&grouped), [a, a, a, a, b, b, c, c, c]);
        let interleaved = plan(
            &copies,
            PaginateOptions {
                order: Order::Interleaved,
                ..PaginateOptions::default()
            },
        );
        assert_eq!(cards_in_order(&interleaved), [a, b, c, a, b, c, a, c, a]);
    }

    #[test]
    fn nothing_is_printed_for_cards_without_copies() {
        let sheets = plan(&[], PaginateOptions::default());
        assert!(sheets.is_empty());
    }
}

fn setting(id: CardId, quantity: usize, turn: Turn, scale: f64) -> CardSetting {
    CardSetting {
        scale_y: None,
        id,
        quantity,
        turn,
        scale,
    }
}

fn grid_id(page_index: usize, row: usize, column: usize) -> CardId {
    CardId::Grid {
        document_id: 0,
        page_index,
        row,
        column,
    }
}

fn free_id(page_index: usize, index: usize) -> CardId {
    CardId::Freeform {
        document_id: 0,
        page_index,
        index,
    }
}

#[test]
fn the_order_of_the_settings_is_the_order_of_the_sheets() {
    let groups = [grid_group(0, 0, sample_grid(0.0))];
    let spec = SheetSpec {
        rows: Some(3),
        columns: Some(3),
        ..a4_sheet()
    };
    // The user moved card 8 and card 2 to the front; the rest keep page order after them.
    let settings = [
        setting(grid_id(0, 2, 2), 1, Turn::R0, 1.0),
        setting(grid_id(0, 0, 2), 1, Turn::R0, 1.0),
    ];
    let sheets = plan_sheets(
        0,
        &[A4],
        &groups,
        &settings,
        &spec,
        &PaginateOptions::default(),
    )
    .unwrap();
    let cols: Vec<_> = sheets[0]
        .placements
        .iter()
        .map(|p| match p.card_id {
            CardId::Grid { row, column, .. } => row * 3 + column,
            CardId::Freeform { .. } => unreachable!(),
        })
        .collect();
    assert_eq!(cols, vec![8, 2, 0, 1, 3, 4, 5, 6, 7]);

    // A card listed twice, or one that does not exist, changes nothing.
    let noisy = [
        settings[0],
        settings[0],
        setting(grid_id(0, 9, 9), 5, Turn::R0, 1.0),
    ];
    let sheets = plan_sheets(
        0,
        &[A4],
        &groups,
        &noisy,
        &spec,
        &PaginateOptions::default(),
    )
    .unwrap();
    assert_eq!(sheets[0].placements.len(), 9);
}

#[test]
fn a_grid_and_freeform_cards_can_share_a_page() {
    // A 3x3 grid plus one odd-sized card below it, on the same page.
    let odd = OrientedRect {
        center: Point { x: 300.0, y: 700.0 },
        width: mm_to_pt(60.0),
        height: mm_to_pt(90.0),
        angle_deg: -4.0,
    };
    let groups = [
        grid_group(0, 0, sample_grid(0.0)),
        PageGroup {
            pages: PageRange { first: 0, last: 0 },
            kind: PageGroupKind::Freeform { cards: vec![odd] },
        },
    ];
    let cards = extract_cards(0, &[A4], &groups).unwrap();
    assert_eq!(cards.len(), 10);
    assert_eq!(cards[9].id, free_id(0, 0));
    assert_eq!(cards[9].source.angle_deg, -4.0);
    let ids: std::collections::HashSet<_> = cards.iter().map(|c| c.id).collect();
    assert_eq!(ids.len(), 10);
}

/// Where the four corners of `source` land on the sheet, top-left first.
fn landed(p: &card_core::sheet::SheetPlacement) -> [Point; 4] {
    let t = card_transform(&p.source, p.scale, p.turn, &p.destination);
    p.source.corners().map(|c| t.apply(c))
}

#[test]
fn tilted_cards_of_three_sizes_come_out_straight_facing_the_same_way_at_their_size() {
    let card_at = |center: (f64, f64), w_mm: f64, h_mm: f64, angle_deg: f64| OrientedRect {
        center: Point {
            x: center.0,
            y: center.1,
        },
        width: mm_to_pt(w_mm),
        height: mm_to_pt(h_mm),
        angle_deg,
    };
    let drawn = vec![
        card_at((150.0, 150.0), 63.0, 88.0, 7.0),
        card_at((400.0, 160.0), 64.0, 89.4, -3.5),
        card_at((150.0, 450.0), 45.0, 70.0, 2.0),
        // Scanned upside down: drawn at 180 degrees (the right way up once straightened).
        card_at((400.0, 460.0), 63.0, 88.0, 180.0),
    ];
    let groups = [PageGroup {
        pages: PageRange { first: 0, last: 0 },
        kind: PageGroupKind::Freeform {
            cards: drawn.clone(),
        },
    }];
    let spec = SheetSpec {
        gap_x_mm: 2.0,
        gap_y_mm: 2.0,
        ..a4_sheet()
    };
    let opts = PaginateOptions {
        group_by_size: false,
        ..PaginateOptions::default()
    };
    // The 64 x 89.4 mm card is set to a real size of 63 x 88 mm.
    let scale = 63.0 / 64.0;
    let settings: Vec<_> = (0..4)
        .map(|i| setting(free_id(0, i), 1, Turn::R0, if i == 1 { scale } else { 1.0 }))
        .collect();
    let sheets = plan_sheets(0, &[A4], &groups, &settings, &spec, &opts).unwrap();
    assert_eq!(sheets.len(), 1);
    assert_eq!(sheets[0].placements.len(), 4);
    for p in &sheets[0].placements {
        let i = match p.card_id {
            CardId::Freeform { index, .. } => index,
            CardId::Grid { .. } => unreachable!(),
        };
        let src = drawn[i];
        let [tl, tr, br, bl] = landed(p);
        // Straight: the edges are horizontal and vertical.
        assert!(
            (tl.y - tr.y).abs() < 1e-6 && (tl.x - bl.x).abs() < 1e-6,
            "card {i}"
        );
        assert!(
            (br.y - bl.y).abs() < 1e-6 && (br.x - tr.x).abs() < 1e-6,
            "card {i}"
        );
        // At the source size (times its scale), and the first corner stays on top-left, so the
        // upside-down scan is turned the right way round by undoing its own angle.
        let s = if i == 1 { scale } else { 1.0 };
        close(tr.x - tl.x, src.width * s);
        close(bl.y - tl.y, src.height * s);
        assert!(tr.x > tl.x && bl.y > tl.y, "card {i} faces the same way");
    }
    // The re-sized card measures 63 x 88 mm.
    let p = &sheets[0].placements[1];
    let (w, h) = (p.source.width * p.scale, p.source.height * p.scale);
    assert!((pt_to_mm(w) - 63.0).abs() < 0.01, "{}", pt_to_mm(w));
    assert!((pt_to_mm(h) - 88.0).abs() < 0.01, "{}", pt_to_mm(h));
}

#[test]
fn the_freeform_requests_the_frontend_sends_deserialise_and_plan() {
    use card_core::sheet::PrintLayout;
    // Written by the frontend's request builder (src/lib/print-request-freeform.test.ts checks it
    // still produces exactly this): a 1 x 2 grid and two tilted freeform cards on one page, the
    // freeform pair first, one turned a quarter and one set to 63 mm wide, all on one shared grid.
    let text = include_str!("data/print_request_freeform.json");
    let v: serde_json::Value = serde_json::from_str(text).unwrap();
    let groups: Vec<PageGroup> =
        serde_json::from_value(v["documents"][0]["groups"].clone()).unwrap();
    assert_eq!(v["documents"][0]["document_id"], 0);
    let settings: Vec<CardSetting> = serde_json::from_value(v["settings"].clone()).unwrap();
    let layout: PrintLayout = serde_json::from_value(v["layout"].clone()).unwrap();
    let options: PaginateOptions = serde_json::from_value(v["options"].clone()).unwrap();

    // The library: the page's grid cards, then its freeform cards, all on page 0.
    let cards = extract_cards(0, &[A4], &groups).unwrap();
    let ids: Vec<_> = cards.iter().map(|c| c.id).collect();
    assert_eq!(
        ids,
        [
            grid_id(0, 0, 0),
            grid_id(0, 0, 1),
            free_id(0, 0),
            free_id(0, 1)
        ]
    );
    assert_eq!(cards[2].source.angle_deg, 7.0);

    // The plan follows the settings' order, with each card's own turn and scale.
    let sheets =
        card_core::sheet::plan_print(0, &[A4], &groups, &settings, &layout, &options).unwrap();
    assert_eq!(sheets.len(), 1);
    let ps = &sheets[0].placements;
    assert_eq!(
        ps.iter().map(|p| p.card_id).collect::<Vec<_>>(),
        [
            free_id(0, 1),
            free_id(0, 0),
            grid_id(0, 0, 0),
            grid_id(0, 0, 1)
        ]
    );
    assert_eq!(ps[0].turn, Turn::R90);
    assert_eq!((ps[1].turn, ps[1].scale), (Turn::R0, 63.0 / 64.0));
    // The re-sized card is 63 mm wide on the sheet; the turned one is as tall as it was wide.
    // (The page and card sizes come through the frontend rounded to a few decimals.)
    assert!((ps[1].destination.width - mm_to_pt(63.0)).abs() < 1e-3);
    assert!((ps[0].destination.height - ps[0].source.width).abs() < 1e-3);
    // Straight on the sheet whatever the angle it was drawn at: the four corners make an upright
    // rectangle (a turn only changes which corner comes first).
    for p in ps {
        let corners = landed(p);
        let (x0, x1) = (
            corners[0].x.min(corners[2].x),
            corners[0].x.max(corners[2].x),
        );
        let (y0, y1) = (
            corners[0].y.min(corners[2].y),
            corners[0].y.max(corners[2].y),
        );
        for c in corners {
            assert!((c.x - x0).abs() < 1e-6 || (c.x - x1).abs() < 1e-6);
            assert!((c.y - y0).abs() < 1e-6 || (c.y - y1).abs() < 1e-6);
        }
    }
}

#[test]
fn ten_japanese_size_pieces_fit_an_a4_sheet_in_landscape_with_no_margins() {
    // 59 x 86 mm, the size of Japanese cards (and of their images). Ten different pieces.
    let pieces: Vec<(Card, usize)> = (0..10).map(|n| (card(n, 59.0, 86.0), 1)).collect();
    let landscape = PageSize {
        width_pt: A4.height_pt,
        height_pt: A4.width_pt,
    };
    let tight = SheetSpec {
        page: SheetPage::Size(landscape),
        gap_x_mm: 0.5,
        gap_y_mm: 0.5,
        ..a4_sheet()
    };
    let sheets = paginate(&pieces, &tight, &PaginateOptions::default()).unwrap();
    assert_eq!(sheets.len(), 1);
    assert_eq!(sheets[0].placements.len(), 10);
    // With the usual 10 mm margins and a 3 mm gap, portrait A4 holds 3 x 3: nine, then one more sheet.
    let usual = SheetSpec {
        gap_x_mm: 3.0,
        gap_y_mm: 3.0,
        margins: Margins {
            top_mm: 10.0,
            right_mm: 10.0,
            bottom_mm: 10.0,
            left_mm: 10.0,
        },
        ..a4_sheet()
    };
    let sheets = paginate(&pieces, &usual, &PaginateOptions::default()).unwrap();
    assert_eq!(
        sheets
            .iter()
            .map(|s| s.placements.len())
            .collect::<Vec<_>>(),
        [9, 1]
    );
    // Every piece keeps its size.
    for p in sheets.iter().flat_map(|s| &s.placements) {
        close(pt_to_mm(p.destination.width), 59.0);
        close(pt_to_mm(p.destination.height), 86.0);
    }
}

#[test]
fn a_piece_with_its_own_width_and_height_prints_at_that_size() {
    // 63 x 88 mm made 63 x 90 mm: the width as it is, the height stretched by 90/88.
    let mut card = card(0, 63.0, 88.0);
    card.scale_y = Some(90.0 / 88.0);
    let spec = a4_sheet();
    let p = paginate(&[(card, 1)], &spec, &PaginateOptions::default()).unwrap()[0].placements[0];
    close(pt_to_mm(p.destination.width), 63.0);
    close(pt_to_mm(p.destination.height), 90.0);
    assert_eq!(p.scales(), (1.0, 90.0 / 88.0));
    // Turned a quarter, it is 90 wide and 63 tall.
    card.turn = Turn::R90;
    let p = paginate(&[(card, 1)], &spec, &PaginateOptions::default()).unwrap()[0].placements[0];
    close(pt_to_mm(p.destination.width), 90.0);
    close(pt_to_mm(p.destination.height), 63.0);
}

#[test]
fn the_two_factor_transform_puts_a_tilted_stretched_piece_exactly_on_its_box() {
    let source = OrientedRect {
        center: Point { x: 200.0, y: 300.0 },
        width: 80.0,
        height: 120.0,
        angle_deg: 7.0,
    };
    for turn in [Turn::R0, Turn::R90, Turn::R180, Turn::R270] {
        let (sx, sy) = (1.1, 0.8);
        let (w, h) = (80.0 * sx, 120.0 * sy);
        let (w, h) = if turn.swaps_axes() { (h, w) } else { (w, h) };
        let dest = Rect::new(50.0, 60.0, w, h);
        let m = card_transform_xy(&source, (sx, sy), turn, &dest);
        // Every corner lands on a corner of the upright box.
        for c in source.corners().map(|k| m.apply(k)) {
            assert!(
                [dest.x, dest.x + w].iter().any(|x| (c.x - x).abs() < 1e-6)
                    && [dest.y, dest.y + h].iter().any(|y| (c.y - y).abs() < 1e-6),
                "{turn:?}: {c:?} is not a corner of {dest:?}"
            );
        }
        // With equal factors it is the one-factor transform.
        let one = card_transform(&source, 0.9, turn, &dest);
        let two = card_transform_xy(&source, (0.9, 0.9), turn, &dest);
        for (a, b) in [
            (one.m11, two.m11),
            (one.m12, two.m12),
            (one.m21, two.m21),
            (one.m22, two.m22),
            (one.tx, two.tx),
            (one.ty, two.ty),
        ] {
            close(a, b);
        }
    }
}
