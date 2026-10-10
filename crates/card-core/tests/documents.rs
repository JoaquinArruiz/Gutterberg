//! A project with several PDFs: cards from different documents share sheets, and the export
//! reads each card from its own file.
use card_core::card::{CardId, PageGroup, PageGroupKind, PageRange};
use card_core::export::{
    export_sheets_files, page_size, plan_print_files, validate_sheets_in, SourceFile,
};
use card_core::finish::Finishing;
use card_core::layout::GridLayout;
use card_core::sample::{sample_grid, sample_pdf, sample_pdf_pages};
use card_core::sheet::{
    extract_all_cards, plan_print_in, plan_sheets_in, CardSetting, DocumentSource, Margins,
    PaginateOptions, PrintLayout, SheetPage, SheetSpec, Turn,
};
use card_core::Error;
use lopdf::Document;

fn grid_group(first: usize, last: usize, grid: GridLayout) -> PageGroup {
    PageGroup {
        pages: PageRange { first, last },
        kind: PageGroupKind::Grid { grid },
    }
}

fn source(document_id: u32, pages: usize) -> DocumentSource {
    let size = page_size(&sample_pdf(), 0).unwrap();
    DocumentSource {
        document_id,
        pages: vec![size; pages],
        groups: vec![grid_group(0, pages - 1, sample_grid(0.0))],
    }
}

fn two_by_two() -> SheetSpec {
    SheetSpec {
        page: SheetPage::SameAsSource,
        rows: Some(2),
        columns: Some(2),
        gap_x_mm: 0.0,
        gap_y_mm: 0.0,
        margins: Margins::default(),
    }
}

fn documents_of(sheet: &card_core::sheet::OutputSheet) -> Vec<u32> {
    sheet
        .placements
        .iter()
        .map(|p| p.card_id.document_id())
        .collect()
}

#[test]
fn cards_of_two_documents_share_a_sheet() {
    let docs = [source(0, 1), source(1, 1)];
    let cards = extract_all_cards(&docs).unwrap();
    assert_eq!(cards.len(), 18);
    assert_eq!(cards[0].id.document_id(), 0);
    assert_eq!(cards[9].id.document_id(), 1);

    let sheets = plan_sheets_in(&docs, &[], &two_by_two(), &PaginateOptions::default()).unwrap();
    // 18 cards, four to a sheet.
    assert_eq!(sheets.len(), 5);
    // The third sheet takes the last card of document 0 and the first three of document 1.
    assert_eq!(documents_of(&sheets[2]), [0, 1, 1, 1]);
    // Same-as-source page size comes from the first printed card's own document.
    assert_eq!(sheets[0].page, docs[0].pages[0]);
}

#[test]
fn the_user_order_can_interleave_documents() {
    let docs = [source(0, 1), source(1, 1)];
    let id = |document_id, column| CardId::Grid {
        document_id,
        page_index: 0,
        row: 0,
        column,
    };
    let setting = |id| CardSetting {
        id,
        quantity: 1,
        turn: Turn::R0,
        scale: 1.0,
    };
    // Listed cards come first, in the order given; the rest follow in page order.
    let settings = [setting(id(1, 0)), setting(id(0, 0)), setting(id(1, 1))];
    let sheets =
        plan_sheets_in(&docs, &settings, &two_by_two(), &PaginateOptions::default()).unwrap();
    let first: Vec<CardId> = sheets[0].placements.iter().map(|p| p.card_id).collect();
    assert_eq!(first, [id(1, 0), id(0, 0), id(1, 1), id(0, 1)]);
}

#[test]
fn same_as_source_keeps_each_documents_pages_in_turn() {
    let docs = [source(0, 2), source(1, 1)];
    let sheets = plan_print_in(
        &docs,
        &[],
        &PrintLayout::SameAsSource,
        &PaginateOptions::default(),
    )
    .unwrap();
    assert_eq!(sheets.len(), 3);
    assert_eq!(
        sheets
            .iter()
            .map(|s| s.placements[0].card_id.document_id())
            .collect::<Vec<_>>(),
        [0, 0, 1]
    );
}

#[test]
fn two_sources_with_the_same_id_are_refused() {
    let docs = [source(3, 1), source(3, 1)];
    assert!(matches!(
        extract_all_cards(&docs),
        Err(Error::InvalidSheet(_))
    ));
}

#[test]
fn a_mixed_sheet_is_exported_from_both_files() {
    let dir = std::env::temp_dir().join(format!("card-core-documents-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (first, second, out) = (dir.join("a.pdf"), dir.join("b.pdf"), dir.join("out.pdf"));
    sample_pdf().save(&first).unwrap();
    sample_pdf_pages(2).save(&second).unwrap();

    let (a_groups, b_groups) = (
        [grid_group(0, 0, sample_grid(0.0))],
        [grid_group(0, 1, sample_grid(0.0))],
    );
    let files = [
        SourceFile {
            document_id: 0,
            path: &first,
            groups: &a_groups,
        },
        SourceFile {
            document_id: 7,
            path: &second,
            groups: &b_groups,
        },
    ];
    let layout = PrintLayout::Grid { spec: two_by_two() };
    let (sheets, issues) = plan_print_files(
        &files,
        &[],
        &layout,
        &PaginateOptions::default(),
        &Finishing::default(),
    )
    .unwrap();
    assert!(issues.is_empty());
    // 9 + 18 cards, four to a sheet.
    assert_eq!(sheets.len(), 7);
    assert_eq!(documents_of(&sheets[2]), [0, 7, 7, 7]);

    export_sheets_files(
        &[(0, first.as_path()), (7, second.as_path())],
        &out,
        &sheets,
    )
    .unwrap();
    let written = Document::load(&out).unwrap();
    assert_eq!(written.get_pages().len(), 7);
    let mixed = *written.get_pages().get(&3).unwrap();
    let content = card_core::export::drawn_content(&written, mixed);
    assert!(content.contains("/S0_0 Do"), "{content}");
    assert!(content.contains("/S7_0 Do"), "{content}");
}

#[test]
fn issues_name_the_document_that_cannot_be_exported() {
    let dir = std::env::temp_dir().join(format!("card-core-documents-bad-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (good, odd) = (dir.join("good.pdf"), dir.join("odd.pdf"));
    sample_pdf().save(&good).unwrap();
    let mut doc = sample_pdf();
    card_core::sample::set_rotate(&mut doc, 45);
    doc.save(&odd).unwrap();

    let groups = [grid_group(0, 0, sample_grid(0.0))];
    let files = [
        SourceFile {
            document_id: 0,
            path: &good,
            groups: &groups,
        },
        SourceFile {
            document_id: 4,
            path: &odd,
            groups: &groups,
        },
    ];
    let (sheets, issues) = plan_print_files(
        &files,
        &[],
        &PrintLayout::SameAsSource,
        &PaginateOptions::default(),
        &Finishing::default(),
    )
    .unwrap();
    assert!(sheets.is_empty());
    assert_eq!(
        issues
            .iter()
            .map(|i| (i.document_id, i.page_index))
            .collect::<Vec<_>>(),
        [(4, 0)]
    );

    // A sheet that draws from a document nobody provided is reported with that document.
    let docs = [source(2, 1)];
    let sheets = plan_print_in(
        &docs,
        &[],
        &PrintLayout::SameAsSource,
        &PaginateOptions::default(),
    )
    .unwrap();
    let loaded = Document::load(&good).unwrap();
    let found = validate_sheets_in(&[(0, &loaded)], &sheets);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].document_id, 2);
}
