//! Cut marks, bleed and duplex backs: the geometry the sheet engine adds, and how the exporter
//! paints it (as vectors, in the right order).
use card_core::card::{CardId, OrientedRect, PageGroup, PageGroupKind, PageRange};
use card_core::export::{export_sheets, page_size};
use card_core::finish::{
    bleed_regions, finish_sheets, plan_and_finish, BackLayout, BackPair, BackgroundOptions,
    BleedOptions, BleedSource, DuplexOptions, EdgeColor, FinishOptions, Finishing, Flip, MarkLine,
    MarkOptions, MarkStyle, PieceFill, SheetWarning, Side,
};
use card_core::geometry::{PageSize, Point};
use card_core::layout::GridLayout;
use card_core::sample::{sample_grid, sample_pdf};
use card_core::sheet::{
    card_transform, plan_print_in, CardSetting, DocumentSource, FoldAxis, Margins, OutputSheet,
    PaginateOptions, PrintLayout, SheetPage, SheetSpec, Turn,
};
use card_core::units::mm_to_pt;
use card_core::Error;

fn grid_group(grid: GridLayout) -> PageGroup {
    PageGroup {
        pages: PageRange { first: 0, last: 0 },
        kind: PageGroupKind::grid(grid),
    }
}

fn source_with(document_id: u32, grid: GridLayout) -> DocumentSource {
    DocumentSource {
        document_id,
        pages: vec![page_size(&sample_pdf(), 0).unwrap()],
        groups: vec![grid_group(grid)],
    }
}

fn source() -> DocumentSource {
    source_with(0, sample_grid(0.0))
}

fn spec(rows: usize, columns: usize, gap_mm: f64, margin_mm: f64) -> SheetSpec {
    SheetSpec {
        page: SheetPage::SameAsSource,
        rows: Some(rows),
        columns: Some(columns),
        gap_x_mm: gap_mm,
        gap_y_mm: gap_mm,
        margins: Margins {
            top_mm: margin_mm,
            right_mm: margin_mm,
            bottom_mm: margin_mm,
            left_mm: margin_mm,
        },
    }
}

fn plan(docs: &[DocumentSource], spec: SheetSpec, settings: &[CardSetting]) -> Vec<OutputSheet> {
    plan_print_in(
        docs,
        settings,
        &PrintLayout::Grid { spec },
        &PaginateOptions::default(),
    )
    .unwrap()
}

fn finishing(options: FinishOptions) -> Finishing {
    Finishing {
        options,
        backs: Vec::new(),
        edge_colors: Vec::new(),
        image_fills: Vec::new(),
    }
}

fn marks(style: MarkStyle) -> FinishOptions {
    FinishOptions {
        marks: MarkOptions {
            style,
            ..MarkOptions::default()
        },
        ..FinishOptions::default()
    }
}

fn bleed(mm: f64, how: BleedSource) -> FinishOptions {
    FinishOptions {
        bleed: BleedOptions { mm, source: how },
        ..FinishOptions::default()
    }
}

fn card(row: usize, column: usize) -> CardId {
    CardId::Grid {
        document_id: 0,
        page_index: 0,
        grid: 0,
        row,
        column,
    }
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-6
}

#[test]
fn with_everything_off_the_sheets_come_out_untouched() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let (out, issues) = finish_sheets(sheets.clone(), &docs, &Finishing::default()).unwrap();
    assert_eq!(out, sheets);
    assert!(issues.is_empty());
}

#[test]
fn ticks_sit_in_the_margins_at_every_edge_and_start_past_the_bleed() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let (out, _) =
        finish_sheets(sheets.clone(), &docs, &finishing(marks(MarkStyle::Ticks))).unwrap();
    let m = out[0].marks.as_ref().unwrap();
    // Four vertical edges and four horizontal ones, a tick at each end: 16 lines.
    assert_eq!(m.lines.len(), 16);
    assert!(close(m.width_pt, mm_to_pt(0.25)));
    assert_eq!(m.color, [0, 0, 0]);
    let first = sheets[0].placements[0].destination;
    let top = first.y;
    let (offset, length) = (mm_to_pt(1.0), mm_to_pt(3.0));
    // The tick above the block's left edge.
    assert!(m.lines.iter().any(|l| close(l[0], first.x)
        && close(l[2], first.x)
        && close(l[1], top - offset - length)
        && close(l[3], top - offset)));

    // With a 2 mm bleed the ticks start 2 mm further out.
    let mut both = marks(MarkStyle::Ticks);
    both.bleed.mm = 2.0;
    let (out, _) = finish_sheets(sheets, &docs, &finishing(both)).unwrap();
    let m = out[0].marks.as_ref().unwrap();
    assert!(m
        .lines
        .iter()
        .any(|l| close(l[0], first.x) && close(l[3], top - offset - mm_to_pt(2.0))));
}

#[test]
fn ticks_mark_the_inner_cuts_of_pieces_that_touch() {
    let docs = [source()];
    // 3 x 3 with no gap: four distinct edges each way.
    let sheets = plan(&docs, spec(3, 3, 0.0, 3.0), &[]);
    let (out, _) = finish_sheets(sheets, &docs, &finishing(marks(MarkStyle::Ticks))).unwrap();
    assert_eq!(out[0].marks.as_ref().unwrap().lines.len(), 16);
}

#[test]
fn ticks_can_add_corner_marks_where_the_gaps_cross() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let mut o = marks(MarkStyle::Ticks);
    o.marks.inner_crosses = true;
    let (out, _) = finish_sheets(sheets.clone(), &docs, &finishing(o.clone())).unwrap();
    let lines = &out[0].marks.as_ref().unwrap().lines;
    // The 16 ticks, and a square on the pieces' edges: a 6 mm gap is no wider than two 3 mm arms.
    assert_eq!(lines.len(), 20);
    let (a, d) = (
        sheets[0].placements[0].destination,
        sheets[0].placements[3].destination,
    );
    let (x0, y0, x1, y1) = (a.x + a.width, a.y + a.height, d.x, d.y);
    for y in [y0, y1] {
        assert!(lines
            .iter()
            .any(|l| close(l[0], x0) && close(l[1], y) && close(l[2], x1) && close(l[3], y)));
    }
    for x in [x0, x1] {
        assert!(lines
            .iter()
            .any(|l| close(l[0], x) && close(l[1], y0) && close(l[2], x) && close(l[3], y1)));
    }
    assert!(out[0].warnings.is_empty());

    // A 10 mm gap leaves the 3 mm arms apart: an L at each of the four corners.
    let sheets = plan(&docs, spec(2, 2, 10.0, 15.0), &[]);
    let (out, _) = finish_sheets(sheets.clone(), &docs, &finishing(o.clone())).unwrap();
    let lines = &out[0].marks.as_ref().unwrap().lines;
    assert_eq!(lines.len(), 16 + 8);
    let a = sheets[0].placements[0].destination;
    let (x0, y0, length) = (a.x + a.width, a.y + a.height, mm_to_pt(3.0));
    assert!(lines.iter().any(|l| close(l[0], x0)
        && close(l[1], y0)
        && close(l[2], x0 + length)
        && close(l[3], y0)));
    assert!(lines.iter().any(|l| close(l[0], x0)
        && close(l[1], y0)
        && close(l[2], x0)
        && close(l[3], y0 + length)));

    // 3 x 3 has four crossings; without the setting there are none.
    let sheets = plan(&docs, spec(3, 3, 6.0, 0.0), &[]);
    let (out, _) = finish_sheets(sheets.clone(), &docs, &finishing(o.clone())).unwrap();
    assert_eq!(out[0].marks.as_ref().unwrap().lines.len(), 24 + 16);
    let (out, _) = finish_sheets(sheets, &docs, &finishing(marks(MarkStyle::Ticks))).unwrap();
    assert_eq!(out[0].marks.as_ref().unwrap().lines.len(), 24);

    // Touching pieces leave no room for corner marks: the ticks stay, with the narrow-gap warning.
    let sheets = plan(&docs, spec(2, 2, 0.0, 15.0), &[]);
    let (out, _) = finish_sheets(sheets, &docs, &finishing(o)).unwrap();
    assert_eq!(out[0].marks.as_ref().unwrap().lines.len(), 12);
    assert!(out[0].warnings.contains(&SheetWarning::GapTooNarrowForLine));
}

#[test]
fn gap_lines_run_down_the_middle_of_wide_gaps_only() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let (out, _) =
        finish_sheets(sheets.clone(), &docs, &finishing(marks(MarkStyle::Gaps))).unwrap();
    let lines = &out[0].marks.as_ref().unwrap().lines;
    assert_eq!(lines.len(), 2);
    let (a, b) = (
        sheets[0].placements[0].destination,
        sheets[0].placements[3].destination,
    );
    let mid_x = (a.x + a.width + b.x) / 2.0;
    let vertical = lines.iter().find(|l| close(l[0], l[2])).unwrap();
    assert!(close(vertical[0], mid_x));
    // Across the whole block and a little into the margins.
    assert!(close(vertical[1], a.y - mm_to_pt(3.0)));
    assert!(close(vertical[3], b.y + b.height + mm_to_pt(3.0)));
    assert!(out[0].warnings.is_empty());

    // A 0.5 mm gap is too narrow for a 0.25 mm line plus clearance; so is no gap at all.
    for gap in [0.5, 0.0] {
        let sheets = plan(&docs, spec(2, 2, gap, 15.0), &[]);
        let (out, _) = finish_sheets(sheets, &docs, &finishing(marks(MarkStyle::Gaps))).unwrap();
        assert!(out[0].marks.is_none());
        assert!(out[0].warnings.contains(&SheetWarning::GapTooNarrowForLine));
    }
}

#[test]
fn marks_that_leave_the_page_are_reported_not_moved() {
    let docs = [source()];
    // 3 x 3 with 7 mm gaps leaves 2.75 mm either side of the block.
    let sheets = plan(&docs, spec(3, 3, 7.0, 0.0), &[]);
    let (out, _) = finish_sheets(sheets, &docs, &finishing(marks(MarkStyle::Ticks))).unwrap();
    assert!(out[0].warnings.contains(&SheetWarning::MarksOffPage));
    assert!(out[0].marks.is_some());
}

#[test]
fn settings_out_of_range_are_refused() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let mut bad: Vec<FinishOptions> = Vec::new();
    bad.push(bleed(6.0, BleedSource::Mirror));
    bad.push(bleed(f64::NAN, BleedSource::Mirror));
    let mut o = marks(MarkStyle::Ticks);
    o.marks.width_mm = 0.0;
    bad.push(o);
    let mut o = marks(MarkStyle::Ticks);
    o.marks.color = "red".into();
    bad.push(o);
    let mut o = FinishOptions::default();
    o.duplex.offset_x_mm = 11.0;
    bad.push(o);
    for options in bad {
        let r = finish_sheets(sheets.clone(), &docs, &finishing(options));
        assert!(matches!(r, Err(Error::InvalidSheet(_))), "{r:?}");
    }
}

/// A point of the piece's own frame: `u` along its width, `v` along its height, from the centre.
fn local(rect: &OrientedRect, p: Point) -> (f64, f64) {
    let (sin, cos) = rect.angle_deg.to_radians().sin_cos();
    let (dx, dy) = (p.x - rect.center.x, p.y - rect.center.y);
    (dx * cos + dy * sin, -dx * sin + dy * cos)
}

#[test]
fn every_bleed_region_shows_the_strip_of_the_piece_next_to_the_edge() {
    let b = mm_to_pt(2.0);
    for angle in [0.0, 7.0, -30.0, 90.0] {
        let rect = OrientedRect {
            center: Point { x: 300.0, y: 400.0 },
            width: 180.0,
            height: 250.0,
            angle_deg: angle,
        };
        let regions = bleed_regions(&rect, b, BleedSource::Mirror);
        assert_eq!(regions.len(), 8);
        for r in &regions {
            let centre = Point {
                x: r.quad.iter().map(|p| p.x).sum::<f64>() / 4.0,
                y: r.quad.iter().map(|p| p.y).sum::<f64>() / 4.0,
            };
            // The region lies outside the piece...
            let (u, v) = local(&rect, centre);
            assert!(u.abs() > rect.width / 2.0 || v.abs() > rect.height / 2.0);
            // ...and what it shows comes from inside the piece, as far in as the region is out.
            let from = r.reflect.apply(centre);
            let (fu, fv) = local(&rect, from);
            assert!(
                fu.abs() < rect.width / 2.0 && fv.abs() < rect.height / 2.0,
                "{angle}: {fu} {fv}"
            );
            let back = r.reflect.apply(from);
            assert!(close(back.x, centre.x) && close(back.y, centre.y));
            let outside = |a: f64, half: f64| (a.abs() - half).max(0.0);
            let inside = |a: f64, half: f64| (half - a.abs()).max(0.0);
            // Out past an edge by d means in from it by d; along an edge the position is kept.
            for (a, fa, half) in [(u, fu, rect.width / 2.0), (v, fv, rect.height / 2.0)] {
                if a.abs() > half {
                    assert!(close(outside(a, half), inside(fa, half)));
                } else {
                    assert!(close(a, fa));
                }
            }
        }
    }
    // From the source: one region, the piece grown by the bleed, nothing reflected.
    let rect = OrientedRect::from_rect(card_core::geometry::Rect::new(10.0, 20.0, 100.0, 150.0));
    let only = bleed_regions(&rect, b, BleedSource::Source);
    assert_eq!(only.len(), 1);
    assert!(close(only[0].quad[0].x, 10.0 - b) && close(only[0].quad[2].y, 170.0 + b));
}

#[test]
fn bleed_from_the_source_needs_that_much_room_around_every_piece() {
    // Pieces that touch in the source (gap 0) cannot lend any bleed.
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let (out, issues) = finish_sheets(
        sheets.clone(),
        &docs,
        &finishing(bleed(1.0, BleedSource::Source)),
    )
    .unwrap();
    assert!(!issues.is_empty());
    assert_eq!(issues[0].code, "bleed_exceeds_source_gap");
    assert!(out[0]
        .warnings
        .contains(&SheetWarning::BleedExceedsSourceGap));

    // Mirrored bleed does not look at the source.
    let (_, issues) =
        finish_sheets(sheets, &docs, &finishing(bleed(1.0, BleedSource::Mirror))).unwrap();
    assert!(issues.is_empty());

    // A source with 3 mm between pieces lends 2 mm but not 4 mm.
    let mut grid = sample_grid(0.0);
    grid.source_gap_x_mm = 3.0;
    grid.source_gap_y_mm = 3.0;
    let docs = [source_with(0, grid)];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let (_, issues) = finish_sheets(
        sheets.clone(),
        &docs,
        &finishing(bleed(2.0, BleedSource::Source)),
    )
    .unwrap();
    assert!(issues.is_empty(), "{issues:?}");
    let (_, issues) =
        finish_sheets(sheets, &docs, &finishing(bleed(4.0, BleedSource::Source))).unwrap();
    assert_eq!(issues.len(), 1);
}

#[test]
fn bleed_that_meets_a_neighbour_or_the_page_edge_is_a_warning() {
    let docs = [source()];
    // 6 mm gap: 2 mm of bleed on each side is fine; 4 mm each meets in the middle.
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let (out, _) = finish_sheets(
        sheets.clone(),
        &docs,
        &finishing(bleed(2.0, BleedSource::Mirror)),
    )
    .unwrap();
    assert!(out[0].warnings.is_empty());
    let (out, _) = finish_sheets(
        sheets.clone(),
        &docs,
        &finishing(bleed(4.0, BleedSource::Mirror)),
    )
    .unwrap();
    assert!(out[0]
        .warnings
        .contains(&SheetWarning::BleedOverlapsNeighbour));
    // No margin: the bleed leaves the page.
    let sheets = plan(&docs, spec(3, 3, 7.0, 0.0), &[]);
    let (out, _) =
        finish_sheets(sheets, &docs, &finishing(bleed(3.0, BleedSource::Mirror))).unwrap();
    assert!(out[0].warnings.contains(&SheetWarning::BleedOffPage));
}

/// The decompressed content stream of the first page of `doc`.
fn first_page_content(doc: &lopdf::Document) -> String {
    let id = *doc.get_pages().get(&1).unwrap();
    card_core::export::drawn_content(doc, id)
}

#[test]
fn the_export_paints_bleed_then_pieces_then_marks_and_never_rasterises() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let mut options = marks(MarkStyle::Ticks);
    options.bleed.mm = 2.0;
    options.marks.color = "#ff0000".into();
    let (out, _) = finish_sheets(sheets, &docs, &finishing(options)).unwrap();
    let pdf = export_sheets(vec![(0, sample_pdf())], &out[..1]).unwrap();
    let content = first_page_content(&pdf);
    // 4 pieces: 8 bleed draws + 1 piece each.
    assert_eq!(content.matches(" Do").count(), 4 * 9);
    let last_do = content.rfind(" Do").unwrap();
    let marks_at = content.find("1 0 0 RG").unwrap();
    assert!(marks_at > last_do);
    // The bleed of the last piece comes before the first piece's own draw.
    let piece_draws: Vec<_> = content.match_indices("re W n").collect();
    assert_eq!(piece_draws.len(), 4);
    assert!(content.find("h W n").unwrap() < piece_draws[0].0);
    // Only forms: no image was added.
    assert!(!pdf.objects.values().any(|o| matches!(
        o,
        lopdf::Object::Stream(s) if s.dict.get(b"Subtype").and_then(|s| s.as_name()).map(|n| n == b"Image").unwrap_or(false)
    )));
}

#[test]
fn marks_are_solid_unless_dashed_or_dotted_is_chosen() {
    let docs = [source()];
    let content_with = |line: MarkLine| {
        let mut options = marks(MarkStyle::Gaps);
        options.marks.line = line;
        let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
        let (out, _) = finish_sheets(sheets, &docs, &finishing(options)).unwrap();
        let marks = out[0].marks.clone().unwrap();
        let pdf = export_sheets(vec![(0, sample_pdf())], &out[..1]).unwrap();
        (marks, first_page_content(&pdf))
    };
    let (solid, content) = content_with(MarkLine::Solid);
    assert!(solid.dash.is_empty());
    assert!(!content.contains(" d\n") && !content.contains("1 J"));

    let (dashed, content) = content_with(MarkLine::Dashed);
    assert_eq!(dashed.dash.len(), 2);
    assert!(close(dashed.dash[0], mm_to_pt(2.0)));
    assert!(close(dashed.dash[1], mm_to_pt(1.0)));
    assert!(content.contains("] 0 d\n"), "a dash pattern");
    assert!(!content.contains("1 J"));

    let (dotted, content) = content_with(MarkLine::Dotted);
    assert_eq!(dotted.dash[0], 0.0, "dots are dashes of length 0");
    assert!(content.contains("[0 "), "a dot pattern");
    assert!(
        content.contains("1 J"),
        "with round caps, so each dot shows"
    );
    assert_eq!(dotted.lines, solid.lines, "the style never moves a mark");
}

#[test]
fn the_dash_pattern_opens_up_for_a_thick_line() {
    let thick = mm_to_pt(2.0);
    let dashes = card_core::finish::dash_pattern(MarkLine::Dashed, thick);
    assert!(dashes[1] >= 2.0 * thick, "the gaps stay open");
    let dots = card_core::finish::dash_pattern(MarkLine::Dotted, thick);
    assert!(dots[1] > thick, "the dots do not touch");
}

#[test]
fn a_sheet_without_bleed_or_marks_exports_the_same_stream_as_before() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let (out, _) = finish_sheets(sheets.clone(), &docs, &Finishing::default()).unwrap();
    let before = first_page_content(&export_sheets(vec![(0, sample_pdf())], &sheets).unwrap());
    let after = first_page_content(&export_sheets(vec![(0, sample_pdf())], &out).unwrap());
    assert_eq!(before, after);
    assert!(!after.contains("RG"));
}

#[test]
fn the_background_colours_are_painted_first_as_plain_fills() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let options = FinishOptions {
        bleed: BleedOptions {
            mm: 2.0,
            source: BleedSource::Mirror,
        },
        background: BackgroundOptions {
            sheet: Some("#000000".into()),
            pieces: Some("#ffffff".into()),
        },
        ..FinishOptions::default()
    };
    let (out, _) = finish_sheets(sheets, &docs, &finishing(options)).unwrap();
    assert_eq!(out[0].background.sheet, Some([0, 0, 0]));
    assert_eq!(out[0].background.pieces, Some([255, 255, 255]));
    let pdf = export_sheets(vec![(0, sample_pdf())], &out[..1]).unwrap();
    let content = first_page_content(&pdf);
    assert!(
        content.starts_with("q\n0 0 0 rg\n0 0 "),
        "the sheet is filled first: {content}"
    );
    // One rectangle per piece, filled once, before anything is drawn.
    let pieces_at = content.find("1 1 1 rg\n").unwrap();
    let fill_end = pieces_at + content[pieces_at..].find("f\nQ").unwrap();
    assert_eq!(content[pieces_at..fill_end].matches(" re\n").count(), 4);
    assert!(fill_end < content.find(" Do").unwrap());
}

#[test]
fn the_edge_bleed_fills_each_piece_with_its_colour_and_mirrors_one_without() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let options = FinishOptions {
        bleed: BleedOptions {
            mm: 2.0,
            source: BleedSource::Edge,
        },
        ..FinishOptions::default()
    };
    let colors = [(0, 0), (0, 1), (1, 0)].map(|(r, c)| EdgeColor {
        card: card(r, c),
        color: [200, 10, 10],
    });
    let f = Finishing {
        edge_colors: colors.to_vec(),
        ..finishing(options)
    };
    let (out, issues) = finish_sheets(sheets, &docs, &f).unwrap();
    assert!(issues.is_empty());
    assert_eq!(out[0].edge_fills.len(), 3);
    let pdf = export_sheets(vec![(0, sample_pdf())], &out[..1]).unwrap();
    let content = first_page_content(&pdf);
    // Three plain fills; the fourth piece is mirrored (8 regions), and every piece is drawn once.
    assert_eq!(content.matches(" rg\n").count(), 3);
    assert_eq!(content.matches(" Do").count(), 8 + 4);
    let fill = content.find(" rg\n").unwrap();
    assert!(fill < content.find("re W n").unwrap(), "under the pieces");
}

#[test]
fn an_ai_fill_is_laid_over_the_mirrored_bleed_and_under_its_piece_as_a_picture() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let dir = std::env::temp_dir().join(format!("card-core-ai-fill-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("fill.png");
    image::RgbaImage::from_pixel(70, 90, image::Rgba([0, 0, 200, 255]))
        .save(&file)
        .unwrap();
    let options = FinishOptions {
        bleed: BleedOptions {
            mm: 2.0,
            source: BleedSource::Ai,
        },
        ..FinishOptions::default()
    };
    let f = Finishing {
        image_fills: vec![PieceFill {
            card: card(0, 0),
            path: file.to_string_lossy().into_owned(),
            inset: 5,
        }],
        ..finishing(options)
    };
    let (out, _) = finish_sheets(sheets, &docs, &f).unwrap();
    assert_eq!(out[0].image_fills.len(), 1);
    let pdf = export_sheets(vec![(0, sample_pdf())], &out[..1]).unwrap();
    let content = first_page_content(&pdf);
    // Every piece is mirrored (8 regions each); the picture comes after the mirrored bleed and before the pieces.
    let picture = content.find("/F").unwrap();
    assert_eq!(content[..picture].matches(" Do").count(), 8);
    assert_eq!(content[picture..].matches(" Do").count(), 1 + 3 * 8 + 4);
    let images: Vec<_> = pdf
        .objects
        .values()
        .filter_map(|o| match o {
            lopdf::Object::Stream(s)
                if s.dict.get(b"Subtype").and_then(|s| s.as_name()).ok() == Some(b"Image") =>
            {
                Some(s)
            }
            _ => None,
        })
        .collect();
    // The picture and its transparency.
    assert_eq!(images.len(), 2);
    assert!(images.iter().any(|s| s.dict.has(b"SMask")));
}

#[test]
fn a_bad_background_colour_is_refused() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let options = FinishOptions {
        background: BackgroundOptions {
            sheet: Some("black".into()),
            pieces: None,
        },
        ..FinishOptions::default()
    };
    assert!(finish_sheets(sheets, &docs, &finishing(options)).is_err());
}

// ---- duplex ----------------------------------------------------------------------------

fn duplex(flip: Flip, common_back: Option<CardId>) -> FinishOptions {
    FinishOptions {
        duplex: DuplexOptions {
            on: true,
            flip,
            offset_x_mm: 0.0,
            offset_y_mm: 0.0,
            common_back,
            ..DuplexOptions::default()
        },
        ..FinishOptions::default()
    }
}

fn setting(id: CardId, turn: Turn) -> CardSetting {
    CardSetting {
        scale_y: None,
        id,
        quantity: 1,
        turn,
        scale: 1.0,
    }
}

fn corners_on_sheet(p: &card_core::sheet::SheetPlacement) -> [Point; 4] {
    let t = card_transform(&p.source, p.scale, p.turn, &p.destination);
    p.source.corners().map(|c| t.apply(c))
}

#[test]
fn a_back_sheet_follows_each_front_sheet() {
    let docs = [source()];
    // Nine pieces, four to a sheet: three fronts.
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    assert_eq!(sheets.len(), 3);
    let (out, _) = finish_sheets(
        sheets.clone(),
        &docs,
        &finishing(duplex(Flip::Long, Some(card(0, 1)))),
    )
    .unwrap();
    let sides: Vec<Side> = out.iter().map(|s| s.side).collect();
    assert_eq!(
        sides,
        [
            Side::Front,
            Side::Back,
            Side::Front,
            Side::Back,
            Side::Front,
            Side::Back
        ]
    );
    // The last front has one piece, so its back has one.
    assert_eq!(out[5].placements.len(), 1);
    assert!(out
        .iter()
        .step_by(2)
        .zip(&sheets)
        .all(|(a, b)| a.placements == b.placements));
    assert!(out[1].marks.is_none());
}

#[test]
fn backs_are_the_mirror_of_the_fronts_for_every_turn_and_flip() {
    let docs = [source()];
    for &(w, h) in &[(595.0, 842.0), (842.0, 595.0)] {
        for flip in [Flip::Long, Flip::Short] {
            for turn in [Turn::R0, Turn::R90, Turn::R180, Turn::R270] {
                let mut docs = docs.to_vec();
                docs[0].pages = vec![PageSize {
                    width_pt: w,
                    height_pt: h,
                }];
                let mut s = spec(1, 2, 6.0, 10.0);
                s.page = SheetPage::Size(PageSize {
                    width_pt: w,
                    height_pt: h,
                });
                let sheets = plan(
                    &docs,
                    s,
                    &[setting(card(0, 0), turn), setting(card(0, 1), turn)],
                );
                let (out, _) =
                    finish_sheets(sheets, &docs, &finishing(duplex(flip, Some(card(2, 2)))))
                        .unwrap();
                let (front, back) = (&out[0], &out[1]);
                assert_eq!(back.placements.len(), front.placements.len());
                let portrait = w <= h;
                let mirror_x = (flip == Flip::Long) == portrait;
                for (f, b) in front.placements.iter().zip(&back.placements) {
                    assert_eq!(b.card_id, card(2, 2));
                    let (fc, bc) = (corners_on_sheet(f), corners_on_sheet(b));
                    // Corners of the source are TL, TR, BR, BL. The back is read with its top at
                    // the card's top edge, so the front's left corner is the back's right one.
                    let pair = [1, 0, 3, 2];
                    for (i, &j) in pair.iter().enumerate() {
                        let want = if mirror_x {
                            Point {
                                x: w - fc[i].x,
                                y: fc[i].y,
                            }
                        } else {
                            Point {
                                x: fc[i].x,
                                y: h - fc[i].y,
                            }
                        };
                        assert!(
                            close(bc[j].x, want.x) && close(bc[j].y, want.y),
                            "{w}x{h} {flip:?} {turn:?}: corner {i}: {:?} vs {want:?}",
                            bc[j]
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn the_offset_moves_the_whole_back_in_the_printed_sheet() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let plain = duplex(Flip::Long, Some(card(0, 0)));
    let (a, _) = finish_sheets(sheets.clone(), &docs, &finishing(plain.clone())).unwrap();
    let mut moved = plain;
    moved.duplex.offset_x_mm = 2.0;
    moved.duplex.offset_y_mm = -1.0;
    moved.bleed.mm = 1.0;
    let (b, _) = finish_sheets(sheets, &docs, &finishing(moved)).unwrap();
    for (p, q) in a[1].placements.iter().zip(&b[1].placements) {
        assert!(close(q.destination.x - p.destination.x, mm_to_pt(2.0)));
        assert!(close(q.destination.y - p.destination.y, mm_to_pt(-1.0)));
    }
    // Fronts stay put.
    assert_eq!(a[0].placements, b[0].placements);
    assert_eq!(b[1].bleed.mm, 1.0);
}

#[test]
fn back_sheets_get_cut_marks_only_when_asked_and_they_follow_the_backs() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let mut options = duplex(Flip::Long, Some(card(0, 0)));
    options.marks.style = MarkStyle::Ticks;
    options.duplex.offset_x_mm = 2.0;
    let (out, _) = finish_sheets(sheets.clone(), &docs, &finishing(options.clone())).unwrap();
    assert!(out[0].marks.is_some());
    assert!(out[1].marks.is_none());

    options.marks.on_backs = true;
    let (out, _) = finish_sheets(sheets, &docs, &finishing(options)).unwrap();
    let sorted = |lines: &[[f64; 4]]| {
        let mut v: Vec<[i64; 4]> = lines
            .iter()
            .map(|l| l.map(|n| (n * 1000.0).round() as i64))
            .collect();
        v.sort();
        v
    };
    let front = out[0].marks.as_ref().unwrap();
    let back = out[1].marks.as_ref().unwrap();
    assert_eq!(back.width_pt, front.width_pt);
    // The grid is centred, so its mirror is the same block: the back's marks are the front's,
    // moved by the back offset.
    let dx = mm_to_pt(2.0);
    let moved: Vec<[f64; 4]> = front
        .lines
        .iter()
        .map(|&[x1, y1, x2, y2]| [x1 + dx, y1, x2 + dx, y2])
        .collect();
    assert_eq!(sorted(&back.lines), sorted(&moved));
    // The last front has one piece in the top-left corner, so its back has one in the top-right,
    // with marks round it there.
    let last = out[5].marks.as_ref().unwrap();
    let b = out[5].placements[0].destination;
    assert!(last
        .lines
        .iter()
        .any(|l| close(l[0], b.x) && close(l[2], b.x)));
    assert!(last
        .lines
        .iter()
        .any(|l| close(l[0], b.x + b.width) && close(l[2], b.x + b.width)));
}

#[test]
fn a_piece_without_a_back_leaves_its_slot_empty_and_a_sheet_without_backs_has_no_back() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    // Nothing chosen: no back sheets at all.
    let (out, _) =
        finish_sheets(sheets.clone(), &docs, &finishing(duplex(Flip::Long, None))).unwrap();
    assert_eq!(out.len(), 3);
    assert!(out.iter().all(|s| s.side == Side::Front));
    // Only the second piece has a back.
    let f = Finishing {
        options: duplex(Flip::Long, None),
        backs: vec![BackPair {
            card: card(0, 1),
            back: card(1, 1),
            turn: Turn::R0,
        }],
        edge_colors: Vec::new(),
        image_fills: Vec::new(),
    };
    let (out, _) = finish_sheets(sheets, &docs, &f).unwrap();
    assert_eq!(out.len(), 4);
    assert_eq!(out[1].placements.len(), 1);
    assert_eq!(out[1].placements[0].card_id, card(1, 1));
    // A per-piece back wins over the common one.
    let f = Finishing {
        options: duplex(Flip::Long, Some(card(0, 0))),
        backs: vec![BackPair {
            card: card(0, 1),
            back: card(1, 1),
            turn: Turn::R0,
        }],
        edge_colors: Vec::new(),
        image_fills: Vec::new(),
    };
    let docs2 = [source()];
    let (out, _) = finish_sheets(plan(&docs2, spec(2, 2, 6.0, 15.0), &[]), &docs2, &f).unwrap();
    assert_eq!(out[1].placements[1].card_id, card(1, 1));
    assert_eq!(out[1].placements[0].card_id, card(0, 0));
}

#[test]
fn a_back_turned_by_the_user_is_turned_that_much_more_on_the_back_sheet() {
    let docs = [source()];
    let sheets = plan(&docs, spec(2, 2, 6.0, 15.0), &[]);
    let pair = |turn| Finishing {
        options: duplex(Flip::Long, None),
        backs: vec![BackPair {
            card: card(0, 0),
            back: card(1, 1),
            turn,
        }],
        edge_colors: Vec::new(),
        image_fills: Vec::new(),
    };
    let (plain, _) = finish_sheets(sheets.clone(), &docs, &pair(Turn::R0)).unwrap();
    let (turned, _) = finish_sheets(sheets.clone(), &docs, &pair(Turn::R180)).unwrap();
    let (p, t) = (plain[1].placements[0], turned[1].placements[0]);
    // A long-edge flip of a portrait sheet keeps backs upright.
    assert_eq!(p.turn, Turn::R0);
    assert_eq!(t.turn, Turn::R180);
    assert_eq!(p.destination, t.destination);
    // The common back's own turn works the same way.
    let mut options = duplex(Flip::Long, Some(card(1, 1)));
    options.duplex.common_back_turn = Turn::R180;
    let (common, _) = finish_sheets(sheets, &docs, &finishing(options)).unwrap();
    assert!(common[1].placements.iter().all(|b| b.turn == Turn::R180));
}

#[test]
fn a_back_of_another_size_is_reported_and_an_unknown_back_is_refused() {
    let mut big = sample_grid(0.0);
    big.columns = 2;
    let docs = [source(), source_with(1, big)];
    let other = CardId::Grid {
        document_id: 1,
        page_index: 0,
        grid: 0,
        row: 0,
        column: 0,
    };
    let sheets = plan(&docs[..1], spec(2, 2, 6.0, 15.0), &[]);
    let (out, _) = finish_sheets(
        sheets.clone(),
        &docs,
        &finishing(duplex(Flip::Long, Some(other))),
    )
    .unwrap();
    assert!(out[1].warnings.contains(&SheetWarning::BackSizeDiffers));
    // It is centred on the mirrored slot.
    let (f, b) = (
        out[0].placements[0].destination,
        out[1].placements[0].destination,
    );
    assert!(close(
        b.x + b.width / 2.0,
        out[0].page.width_pt - (f.x + f.width / 2.0)
    ));

    let missing = CardId::Grid {
        document_id: 0,
        page_index: 5,
        grid: 0,
        row: 0,
        column: 0,
    };
    let r = finish_sheets(
        sheets,
        &docs[..1],
        &finishing(duplex(Flip::Long, Some(missing))),
    );
    assert!(matches!(r, Err(Error::InvalidSheet(_))));
}

// ---- gutterfold ------------------------------------------------------------------------------

fn gutterfold(fold: FoldAxis, gap_mm: f64) -> FinishOptions {
    FinishOptions {
        duplex: DuplexOptions {
            on: true,
            layout: BackLayout::Gutterfold,
            fold,
            fold_gap_mm: gap_mm,
            ..DuplexOptions::default()
        },
        ..FinishOptions::default()
    }
}

/// Settings that print only the piece at row 0, column 0, once (the other eight get no copies).
fn only_first() -> Vec<CardSetting> {
    (0..9)
        .map(|i| CardSetting {
            quantity: usize::from(i == 0),
            ..setting(card(i / 3, i % 3), Turn::R0)
        })
        .collect()
}

/// Plans and finishes on an A4 sheet with no margins and a 5 mm gap, with every piece's back
/// being the piece at row 2, column 2.
fn gutterfold_sheets(options: FinishOptions, settings: &[CardSetting]) -> Vec<OutputSheet> {
    let docs = [source()];
    let mut s = spec(1, 1, 5.0, 0.0);
    s.page = SheetPage::Size(PageSize {
        width_pt: 595.0,
        height_pt: 842.0,
    });
    s.rows = None;
    s.columns = None;
    let mut f = finishing(options);
    f.options.duplex.common_back = Some(card(2, 2));
    plan_and_finish(
        &docs,
        settings,
        &PrintLayout::Grid { spec: s },
        &PaginateOptions::default(),
        &f,
    )
    .unwrap()
    .0
}

#[test]
fn a_vertical_fold_puts_each_back_beside_its_front_reading_as_printed() {
    let out = gutterfold_sheets(gutterfold(FoldAxis::Vertical, 0.0), &only_first());
    assert_eq!(out.len(), 1, "no back sheets with gutterfold");
    let sheet = &out[0];
    assert_eq!(sheet.side, Side::Front);
    let [front, back] = [sheet.placements[0], sheet.placements[1]];
    assert_eq!(back.card_id, card(2, 2));
    // Same size, side by side, touching at the fold, at the same height.
    let (f, b) = (front.destination, back.destination);
    assert!((b.width - f.width).abs() < 1e-6 && (b.height - f.height).abs() < 1e-6);
    assert!((b.x - (f.x + f.width)).abs() < 1e-6);
    assert!((b.y - f.y).abs() < 1e-6);
    assert_eq!(back.turn, Turn::R0);
    // One fold line, down the edge they share.
    assert_eq!(sheet.folds, vec![[b.x, f.y, b.x, f.y + f.height]]);
}

#[test]
fn a_horizontal_fold_puts_each_back_below_its_front_upside_down() {
    let out = gutterfold_sheets(gutterfold(FoldAxis::Horizontal, 2.0), &only_first());
    let sheet = &out[0];
    let [front, back] = [sheet.placements[0], sheet.placements[1]];
    let (f, b) = (front.destination, back.destination);
    let gap = mm_to_pt(2.0);
    assert!((b.y - (f.y + f.height + gap)).abs() < 1e-6);
    assert!((b.x - f.x).abs() < 1e-6);
    assert_eq!(back.turn, Turn::R180);
    // The fold is in the middle of the gap.
    let y = f.y + f.height + gap / 2.0;
    assert_eq!(sheet.folds, vec![[f.x, y, f.x + f.width, y]]);
    // Upside down can be turned off for a file whose backs are printed upright.
    let mut options = gutterfold(FoldAxis::Horizontal, 2.0);
    options.duplex.back_upside_down = Some(false);
    let out = gutterfold_sheets(options, &only_first());
    assert_eq!(out[0].placements[1].turn, Turn::R0);
}

#[test]
fn a_back_turned_by_the_user_adds_its_turn_to_the_fold() {
    let mut options = gutterfold(FoldAxis::Horizontal, 0.0);
    options.duplex.common_back_turn = Turn::R180;
    let out = gutterfold_sheets(options, &only_first());
    assert_eq!(out[0].placements[1].turn, Turn::R0);
    let mut options = gutterfold(FoldAxis::Vertical, 0.0);
    options.duplex.common_back_turn = Turn::R90;
    let out = gutterfold_sheets(options, &only_first());
    assert_eq!(out[0].placements[1].turn, Turn::R90);
}

#[test]
fn pairs_fill_the_sheet_like_pieces_and_never_overlap() {
    // Nine pieces 63.5 x 88 mm, folded side by side: a pair is 127 x 88 mm, so A4 portrait with a
    // 5 mm gap holds 1 x 3 pairs; nine pieces need three sheets.
    let out = gutterfold_sheets(gutterfold(FoldAxis::Vertical, 0.0), &[]);
    assert_eq!(out.len(), 3);
    assert!(out.iter().all(|s| s.side == Side::Front));
    for sheet in &out {
        let rects: Vec<_> = sheet.placements.iter().map(|p| p.destination).collect();
        for (i, a) in rects.iter().enumerate() {
            for b in &rects[i + 1..] {
                let apart = a.x + a.width <= b.x + 1e-6
                    || b.x + b.width <= a.x + 1e-6
                    || a.y + a.height <= b.y + 1e-6
                    || b.y + b.height <= a.y + 1e-6;
                assert!(apart, "{a:?} overlaps {b:?}");
            }
        }
    }
}

#[test]
fn cut_marks_go_round_the_pair_not_across_the_fold() {
    let mut options = gutterfold(FoldAxis::Vertical, 0.0);
    options.marks.style = MarkStyle::Ticks;
    let out = gutterfold_sheets(options, &only_first());
    let sheet = &out[0];
    let fold_x = sheet.folds[0][0];
    let marks = sheet.marks.as_ref().unwrap();
    // Vertical ticks only at the outer left and right edges of the pair, none at the fold.
    let xs: Vec<f64> = marks
        .lines
        .iter()
        .filter(|l| l[0] == l[2])
        .map(|l| l[0])
        .collect();
    assert!(!xs.is_empty());
    assert!(xs.iter().all(|x| (x - fold_x).abs() > 1.0), "{xs:?}");
}

#[test]
fn pairs_cut_apart_have_no_fold_line_and_marks_between_front_and_back() {
    let mut options = gutterfold(FoldAxis::Vertical, 0.0);
    options.duplex.cut_apart = true;
    options.marks.style = MarkStyle::Ticks;
    let out = gutterfold_sheets(options, &only_first());
    let sheet = &out[0];
    assert!(sheet.folds.is_empty(), "no fold line");
    let [front, back] = [sheet.placements[0], sheet.placements[1]];
    let (f, b) = (front.destination, back.destination);
    // Placed as when folding: side by side, touching.
    assert!((b.x - (f.x + f.width)).abs() < 1e-6);
    assert_eq!(back.turn, Turn::R0);
    // Vertical ticks at the left of the front, the edge they share and the right of the back.
    let xs: Vec<f64> = sheet
        .marks
        .as_ref()
        .unwrap()
        .lines
        .iter()
        .filter(|l| l[0] == l[2])
        .map(|l| l[0])
        .collect();
    for x in [f.x, b.x, b.x + b.width] {
        assert!(
            xs.iter().any(|m| (m - x).abs() < 1e-6),
            "a tick at {x}: {xs:?}"
        );
    }
}

#[test]
fn a_back_below_its_front_cut_apart_stays_upright_unless_asked() {
    let mut options = gutterfold(FoldAxis::Horizontal, 2.0);
    options.duplex.cut_apart = true;
    let out = gutterfold_sheets(options, &only_first());
    let sheet = &out[0];
    assert!(sheet.folds.is_empty());
    let [front, back] = [sheet.placements[0], sheet.placements[1]];
    let (f, b) = (front.destination, back.destination);
    // The gap at the fold is a plain gap.
    assert!((b.y - (f.y + f.height + mm_to_pt(2.0))).abs() < 1e-6);
    assert_eq!(
        back.turn,
        Turn::R0,
        "nothing is folded, so nothing is upside down"
    );
    let mut options = gutterfold(FoldAxis::Horizontal, 2.0);
    options.duplex.cut_apart = true;
    options.duplex.back_upside_down = Some(true);
    let out = gutterfold_sheets(options, &only_first());
    assert_eq!(out[0].placements[1].turn, Turn::R180);
}

#[test]
fn gutterfold_needs_a_sheet_grid() {
    let docs = [source()];
    let err = plan_and_finish(
        &docs,
        &[],
        &PrintLayout::SameAsSource,
        &PaginateOptions::default(),
        &finishing(gutterfold(FoldAxis::Vertical, 0.0)),
    )
    .unwrap_err();
    assert!(matches!(err, Error::InvalidSheet(_)));
}

#[test]
fn a_gutterfold_sheet_exports_with_dashed_fold_lines() {
    let out = gutterfold_sheets(gutterfold(FoldAxis::Vertical, 0.0), &only_first());
    let doc = export_sheets(vec![(0, sample_pdf())], &out).unwrap();
    let id = *doc.get_pages().values().next().unwrap();
    let content = card_core::export::drawn_content(&doc, id);
    assert_eq!(
        content.matches(" Do\n").count(),
        2,
        "the front and its back"
    );
    assert!(content.contains("[2 2] 0 d"), "a dashed fold line");
}
