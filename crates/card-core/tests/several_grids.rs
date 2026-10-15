//! Several grids on one page: the grid number in the ids, the order the pieces come out in, and
//! the sheets of "Same as source".
use card_core::card::{CardId, OrientedRect, PageGroup, PageGroupKind, PageRange};
use card_core::geometry::{PageSize, Rect};
use card_core::layout::GridLayout;
use card_core::sheet::{extract_cards, source_sheets};

const PAGE: PageSize = PageSize {
    width_pt: 600.0,
    height_pt: 800.0,
};

/// A grid of `rows` x `columns` in the region `(x, y, w, h)` (normalized), with no gaps in the source or the output.
fn grid(x: f64, y: f64, w: f64, h: f64, rows: usize, columns: usize) -> GridLayout {
    GridLayout {
        bounds: Rect::new(x, y, w, h),
        rows,
        columns,
        source_gap_x_mm: 0.0,
        source_gap_y_mm: 0.0,
        gap_x_mm: 0.0,
        gap_y_mm: 0.0,
        margin_top_mm: 0.0,
        margin_right_mm: 0.0,
        margin_bottom_mm: 0.0,
        margin_left_mm: 0.0,
        output_page: None,
        fit_page: false,
    }
}

/// Large pieces in the top half (2 x 2), small ones in the bottom left (1 x 3).
fn two_grids() -> Vec<Option<GridLayout>> {
    vec![
        Some(grid(0.0, 0.0, 1.0, 0.5, 2, 2)),
        Some(grid(0.0, 0.5, 0.6, 0.2, 1, 3)),
    ]
}

fn place(id: CardId) -> (usize, usize, usize, usize) {
    match id {
        CardId::Grid {
            page_index,
            grid,
            row,
            column,
            ..
        } => (page_index, grid, row, column),
        CardId::Freeform { .. } => unreachable!(),
    }
}

#[test]
fn pieces_come_out_page_by_page_grid_by_grid_then_the_freeform_ones() {
    let pages = [PAGE, PAGE];
    let groups = [
        PageGroup {
            pages: PageRange { first: 0, last: 1 },
            kind: PageGroupKind::Grid { grids: two_grids() },
        },
        PageGroup {
            pages: PageRange { first: 1, last: 1 },
            kind: PageGroupKind::Freeform {
                cards: vec![OrientedRect::from_rect(Rect::new(10.0, 700.0, 50.0, 50.0))],
            },
        },
    ];
    let cards = extract_cards(0, &pages, &groups).unwrap();
    let grid_ids: Vec<_> = cards
        .iter()
        .filter(|c| matches!(c.id, CardId::Grid { .. }))
        .map(|c| place(c.id))
        .collect();
    let page = |p| {
        vec![
            (p, 0, 0, 0),
            (p, 0, 0, 1),
            (p, 0, 1, 0),
            (p, 0, 1, 1),
            (p, 1, 0, 0),
            (p, 1, 0, 1),
            (p, 1, 0, 2),
        ]
    };
    assert_eq!(grid_ids, [page(0), page(1)].concat());
    // The freeform piece of page 2 comes last, after that page's grids.
    assert!(matches!(
        cards.last().unwrap().id,
        CardId::Freeform { page_index: 1, .. }
    ));
    assert_eq!(cards.len(), 15);

    // Each grid's pieces are the size of its own cells.
    let size = |i: usize| (cards[i].source.width, cards[i].source.height);
    assert_eq!(size(0), (300.0, 200.0));
    let (w, h) = size(4);
    assert!((w - 120.0).abs() < 1e-9 && (h - 160.0).abs() < 1e-9);
}

#[test]
fn a_grid_with_no_region_has_no_pieces_and_the_next_keeps_its_number() {
    let mut grids = two_grids();
    grids[0] = None;
    let groups = [PageGroup {
        pages: PageRange { first: 0, last: 0 },
        kind: PageGroupKind::Grid { grids },
    }];
    let cards = extract_cards(3, &[PAGE], &groups).unwrap();
    assert_eq!(cards.len(), 3);
    assert!(cards.iter().all(|c| place(c.id).1 == 1));
    assert_eq!(cards[0].id.document_id(), 3);
}

#[test]
fn a_page_with_one_grid_gives_the_ids_it_always_did() {
    let groups = [PageGroup {
        pages: PageRange { first: 0, last: 0 },
        kind: PageGroupKind::grid(grid(0.0, 0.0, 1.0, 1.0, 1, 2)),
    }];
    let cards = extract_cards(0, &[PAGE], &groups).unwrap();
    let json = serde_json::to_value(cards[1].id).unwrap();
    assert_eq!(
        json,
        serde_json::json!({"kind": "grid", "document_id": 0, "page_index": 0, "row": 0, "column": 1})
    );
}

#[test]
fn same_as_source_gives_each_grid_of_a_page_its_own_sheet() {
    let groups = [PageGroup {
        pages: PageRange { first: 0, last: 0 },
        kind: PageGroupKind::Grid {
            grids: vec![two_grids()[0], None, two_grids()[1]],
        },
    }];
    let sheets = source_sheets(0, &[PAGE], &groups).unwrap();
    assert_eq!(sheets.len(), 2);
    assert_eq!(sheets[0].placements.len(), 4);
    assert_eq!(sheets[1].placements.len(), 3);
    assert!(sheets[0].placements.iter().all(|p| place(p.card_id).1 == 0));
    // The third grid keeps its number although the second has no region.
    assert_eq!(place(sheets[1].placements[2].card_id), (0, 2, 0, 2));
}

#[test]
fn page_groups_with_a_list_of_grids_read_from_the_ui() {
    let json = serde_json::json!({
        "pages": {"first": 0, "last": 0},
        "kind": "grid",
        "grids": [null, {
            "bounds": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
            "rows": 1, "columns": 1, "gap_x_mm": 0.0, "gap_y_mm": 0.0
        }],
    });
    let group: PageGroup = serde_json::from_value(json).unwrap();
    let PageGroupKind::Grid { grids } = group.kind else {
        panic!("not a grid group");
    };
    assert!(grids[0].is_none() && grids[1].is_some());
}
