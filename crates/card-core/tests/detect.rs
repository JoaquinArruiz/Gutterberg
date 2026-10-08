//! Detecting pieces: the three engines on data built by hand, the interface that lets engines
//! plug in, and the whole path through pdfium on generated PDFs. Tests that need pdfium are
//! skipped when it is not available (set `PDFIUM_LIB_PATH`).
use card_core::card::OrientedRect;
use card_core::detect::read::read_page_data;
use card_core::detect::{
    default_engines, detect_page, BlobsEngine, Detection, Detector, EdgesEngine, EngineResult,
    GreyImage, Note, ObjectKind, ObjectsEngine, PageData, PageObject, Proposal, ProposalKind,
    GREY_LONG_SIDE_PX,
};
use card_core::geometry::{PageSize, Point, Rect};
use card_core::render::bind_pdfium;
use card_core::units::{mm_to_pt, pt_to_mm};
use lopdf::{dictionary, Dictionary, Document, Object, Stream};
use std::cell::Cell;

const A4_MM: (f64, f64) = (210.0, 297.0);

fn a4() -> PageSize {
    PageSize {
        width_pt: mm_to_pt(A4_MM.0),
        height_pt: mm_to_pt(A4_MM.1),
    }
}

fn near(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol
}

fn grid_of(p: &Proposal) -> (Rect, usize, usize, f64, f64) {
    match &p.kind {
        ProposalKind::Grid {
            bounds,
            rows,
            columns,
            source_gap_x_mm,
            source_gap_y_mm,
        } => (*bounds, *rows, *columns, *source_gap_x_mm, *source_gap_y_mm),
        other => panic!("not a grid: {other:?}"),
    }
}

fn rects_of(p: &Proposal) -> &[OrientedRect] {
    match &p.kind {
        ProposalKind::Rects { rects } => rects,
        other => panic!("not rectangles: {other:?}"),
    }
}

/// `x, y, w, h` in mm, top-left origin, as points.
fn rect_mm(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect::new(mm_to_pt(x), mm_to_pt(y), mm_to_pt(w), mm_to_pt(h))
}

fn object(kind: ObjectKind, rect: Rect) -> PageObject {
    PageObject { kind, rect }
}

fn data(objects: Vec<PageObject>) -> PageData {
    PageData {
        size: a4(),
        objects,
        grey: None,
    }
}

/// A `columns` x `rows` grid of pieces `w` x `h` mm with `gap` mm between, from (`x0`, `y0`) mm.
fn grid_objects(
    columns: usize,
    rows: usize,
    w: f64,
    h: f64,
    gap: f64,
    x0: f64,
    y0: f64,
) -> Vec<PageObject> {
    let mut v = Vec::new();
    for r in 0..rows {
        for c in 0..columns {
            let rect = rect_mm(x0 + c as f64 * (w + gap), y0 + r as f64 * (h + gap), w, h);
            v.push(object(ObjectKind::Rect, rect));
        }
    }
    v
}

// ---- engine 1: the page's objects ------------------------------------------------------

#[test]
fn a_regular_arrangement_of_same_size_objects_is_the_grid_exactly() {
    let page = data(grid_objects(3, 3, 63.5, 88.0, 0.0, 9.75, 16.5));
    let found = ObjectsEngine.detect(&page).proposals;
    assert_eq!(found.len(), 1);
    let (b, rows, columns, gx, gy) = grid_of(&found[0]);
    assert_eq!((rows, columns), (3, 3));
    assert!(near(pt_to_mm(b.x), 9.75, 0.01) && near(pt_to_mm(b.y), 16.5, 0.01));
    assert!(near(pt_to_mm(b.width), 190.5, 0.01) && near(pt_to_mm(b.height), 264.0, 0.01));
    assert!(near(gx, 0.0, 0.01) && near(gy, 0.0, 0.01));
    assert!(found[0].confidence >= 0.9);
    assert_eq!(found[0].engine, "pdf-objects");
    assert!(found[0].notes.is_empty());
}

#[test]
fn the_source_gap_is_the_pitch_minus_the_size() {
    let page = data(grid_objects(3, 2, 63.5, 88.0, 6.0, 3.0, 20.0));
    let (_, rows, columns, gx, gy) = grid_of(&ObjectsEngine.detect(&page).proposals[0]);
    assert_eq!((rows, columns), (2, 3));
    assert!(near(gx, 6.0, 0.01) && near(gy, 6.0, 0.01));
}

#[test]
fn a_fill_and_a_stroke_of_one_rectangle_count_once() {
    let mut objects = grid_objects(2, 2, 63.5, 88.0, 0.0, 20.0, 20.0);
    objects.extend(objects.clone());
    let found = ObjectsEngine.detect(&data(objects)).proposals;
    let (_, rows, columns, _, _) = grid_of(&found[0]);
    assert_eq!((rows, columns), (2, 2));
}

#[test]
fn a_missing_cell_is_noted_and_lowers_the_confidence() {
    let mut objects = grid_objects(4, 2, 40.0, 60.0, 0.0, 15.0, 30.0);
    objects.pop();
    let found = ObjectsEngine.detect(&data(objects)).proposals;
    assert!(found[0].notes.contains(&Note::MissingCells));
    assert!(found[0].confidence < 0.75, "{}", found[0].confidence);
}

#[test]
fn two_or_three_objects_are_only_a_hint() {
    let found = ObjectsEngine
        .detect(&data(grid_objects(2, 1, 63.5, 88.0, 0.0, 20.0, 20.0)))
        .proposals;
    assert!(found[0].notes.contains(&Note::FewObjects));
    assert!(found[0].confidence <= 0.6);
}

#[test]
fn objects_that_are_not_on_a_regular_grid_or_overlap_are_not_one() {
    let mut off = grid_objects(3, 1, 60.0, 80.0, 2.0, 10.0, 40.0);
    off[2].rect.x += mm_to_pt(5.0); // the pitch changes
    assert!(ObjectsEngine.detect(&data(off)).proposals.is_empty());
    let overlapping = grid_objects(3, 1, 60.0, 80.0, -10.0, 10.0, 40.0);
    assert!(ObjectsEngine
        .detect(&data(overlapping))
        .proposals
        .is_empty());
}

#[test]
fn the_page_background_and_small_art_are_not_pieces() {
    let mut objects = grid_objects(2, 2, 63.5, 88.0, 0.0, 20.0, 20.0);
    objects.push(object(
        ObjectKind::Image,
        Rect::new(0.0, 0.0, a4().width_pt, a4().height_pt),
    ));
    // Small icons repeated on every card.
    objects.extend(grid_objects(2, 2, 10.0, 10.0, 0.0, 30.0, 30.0));
    let found = ObjectsEngine.detect(&data(objects)).proposals;
    assert_eq!(found.len(), 1);
    assert_eq!(grid_of(&found[0]).1, 2);
}

#[test]
fn objects_of_several_sizes_give_one_proposal_each_best_first() {
    let mut objects = grid_objects(3, 3, 60.0, 80.0, 0.0, 15.0, 20.0);
    // Art inside every card, a little smaller.
    objects.extend(grid_objects(3, 3, 50.0, 70.0, 10.0, 20.0, 25.0));
    let page = data(objects);
    let detection = detect_page(&page, &[Box::new(ObjectsEngine)]);
    assert_eq!(detection.proposals.len(), 2);
    // Both are complete grids; the larger one comes first.
    assert!(detection.proposals[0].coverage() > detection.proposals[1].coverage());
}

#[test]
fn crop_marks_that_line_up_confirm_the_grid() {
    let mut objects = grid_objects(2, 2, 63.5, 88.0, 0.0, 30.0, 40.0);
    let (x0, y0, x1, y1) = (30.0, 40.0, 30.0 + 127.0, 40.0 + 176.0);
    for x in [x0, x1] {
        for (a, b) in [(y0 - 8.0, y0 - 3.0), (y1 + 3.0, y1 + 8.0)] {
            objects.push(object(ObjectKind::Line, rect_mm(x, a, 0.0, b - a)));
        }
    }
    let with = ObjectsEngine.detect(&data(objects.clone())).proposals;
    assert!(with[0].notes.contains(&Note::CropMarks));
    objects.retain(|o| o.kind != ObjectKind::Line);
    let without = ObjectsEngine.detect(&data(objects)).proposals;
    assert!(with[0].confidence > without[0].confidence);
}

// ---- the interface -------------------------------------------------------------------------

struct Fake {
    confidence: f64,
    rows: usize,
    ran: Cell<bool>,
}

impl Detector for Fake {
    fn engine(&self) -> &'static str {
        "fake"
    }
    fn detect(&self, _: &PageData) -> EngineResult {
        self.ran.set(true);
        EngineResult {
            proposals: vec![Proposal {
                kind: ProposalKind::Grid {
                    bounds: Rect::new(0.0, 0.0, 100.0, 100.0),
                    rows: self.rows,
                    columns: 1,
                    source_gap_x_mm: 0.0,
                    source_gap_y_mm: 0.0,
                },
                confidence: self.confidence,
                engine: "fake".into(),
                notes: Vec::new(),
            }],
            reasons: vec![Note::NoRegularPattern],
        }
    }
}

fn fake(confidence: f64, rows: usize) -> Fake {
    Fake {
        confidence,
        rows,
        ran: Cell::new(false),
    }
}

#[test]
fn engines_are_tried_in_order_sorted_and_cut_below_the_minimum() {
    let page = data(Vec::new());
    let engines: Vec<Box<dyn Detector>> = vec![
        Box::new(fake(0.5, 1)),
        Box::new(fake(0.34, 2)),
        Box::new(fake(0.6, 3)),
    ];
    let d = detect_page(&page, &engines);
    let rows: Vec<usize> = d.proposals.iter().map(|p| grid_of(p).1).collect();
    assert_eq!(rows, [3, 1]); // 0.6 then 0.5; 0.34 is not offered
    assert!(d.reasons.is_empty()); // there are proposals, so no reason is needed
}

#[test]
fn the_search_ends_when_an_engine_is_sure_and_reasons_stay_when_nothing_is_offered() {
    let page = data(Vec::new());
    let (first, second) = (fake(0.9, 1), fake(0.8, 2));
    let engines: Vec<Box<dyn Detector>> = vec![Box::new(first), Box::new(second)];
    // Boxed fakes cannot be inspected afterwards, so use the proposals as evidence.
    let d = detect_page(&page, &engines);
    assert_eq!(
        d.proposals.len(),
        1,
        "the second engine should not have run"
    );

    let nothing: Vec<Box<dyn Detector>> = vec![Box::new(fake(0.2, 1))];
    let d = detect_page(&page, &nothing);
    assert!(d.proposals.is_empty());
    assert_eq!(d.reasons, [Note::NoRegularPattern]);
}

#[test]
fn a_detection_round_trips_through_serde() {
    let d = Detection {
        proposals: vec![
            Proposal {
                kind: ProposalKind::Grid {
                    bounds: Rect::new(1.0, 2.0, 3.0, 4.0),
                    rows: 2,
                    columns: 3,
                    source_gap_x_mm: 1.5,
                    source_gap_y_mm: 0.0,
                },
                confidence: 0.95,
                engine: "pdf-objects".into(),
                notes: vec![Note::CropMarks],
            },
            Proposal {
                kind: ProposalKind::Rects {
                    rects: vec![OrientedRect {
                        center: Point { x: 5.0, y: 6.0 },
                        width: 7.0,
                        height: 8.0,
                        angle_deg: -9.0,
                    }],
                },
                confidence: 0.5,
                engine: "blobs".into(),
                notes: vec![],
            },
        ],
        reasons: vec![],
    };
    let json = serde_json::to_value(&d).unwrap();
    assert_eq!(json["proposals"][0]["kind"], "grid");
    assert_eq!(json["proposals"][0]["rows"], 2);
    assert_eq!(json["proposals"][0]["notes"][0], "crop_marks");
    assert_eq!(json["proposals"][1]["kind"], "rects");
    assert_eq!(json["proposals"][1]["rects"][0]["angle_deg"], -9.0);
    let back: Detection = serde_json::from_value(json).unwrap();
    assert_eq!(back, d);
}

// ---- engines 2 and 3 on images made here ----------------------------------------------

/// A grey page of `w_px` x `h_px` for A4: `shade(x_mm, y_mm)` gives each pixel its level.
fn grey_page(w_px: usize, mut shade: impl FnMut(f64, f64) -> u8) -> GreyImage {
    let h_px = (w_px as f64 * A4_MM.1 / A4_MM.0).round() as usize;
    let (kx, ky) = (A4_MM.0 / w_px as f64, A4_MM.1 / h_px as f64);
    let mut data = Vec::with_capacity(w_px * h_px);
    for y in 0..h_px {
        for x in 0..w_px {
            data.push(shade((x as f64 + 0.5) * kx, (y as f64 + 0.5) * ky));
        }
    }
    GreyImage {
        width: w_px,
        height: h_px,
        data,
        pt_per_px_x: mm_to_pt(kx),
        pt_per_px_y: mm_to_pt(ky),
    }
}

/// A sheet of `columns` x `rows` pieces `w` x `h` mm from (`x0`, `y0`) with `gap` between, each with
/// its own tone, a dark border line and some art, on white.
fn sheet_shade(
    columns: usize,
    rows: usize,
    w: f64,
    h: f64,
    gap: f64,
    x0: f64,
    y0: f64,
) -> impl Fn(f64, f64) -> u8 {
    move |x, y| {
        let (u, v) = (x - x0, y - y0);
        if u < 0.0 || v < 0.0 {
            return 255;
        }
        let (c, r) = (
            (u / (w + gap)).floor() as usize,
            (v / (h + gap)).floor() as usize,
        );
        if c >= columns || r >= rows {
            return 255;
        }
        let (lu, lv) = (u - c as f64 * (w + gap), v - r as f64 * (h + gap));
        if lu > w || lv > h {
            return 255; // the gap
        }
        let border = 0.4;
        if lu < border || lv < border || lu > w - border || lv > h - border {
            return 20;
        }
        // Art: a tone per piece and a disc in the middle.
        let tone = 90 + ((r * columns + c) * 17 % 90) as i32;
        let (du, dv) = (lu - w / 2.0, lv - h / 2.0);
        if du * du + dv * dv < (w.min(h) * 0.3).powi(2) {
            return 250;
        }
        tone as u8
    }
}

fn page_with_grey(img: GreyImage) -> PageData {
    PageData {
        size: a4(),
        objects: Vec::new(),
        grey: Some(img),
    }
}

#[allow(clippy::too_many_arguments)]
fn assert_grid(
    p: &Proposal,
    columns: usize,
    rows: usize,
    x0: f64,
    y0: f64,
    w: f64,
    h: f64,
    gap: f64,
    tol: f64,
) {
    let (b, r, c, gx, gy) = grid_of(p);
    assert_eq!((r, c), (rows, columns), "{p:?}");
    let total_w = columns as f64 * w + (columns - 1) as f64 * gap;
    let total_h = rows as f64 * h + (rows - 1) as f64 * gap;
    assert!(
        near(pt_to_mm(b.x), x0, tol),
        "left {} vs {x0}",
        pt_to_mm(b.x)
    );
    assert!(
        near(pt_to_mm(b.y), y0, tol),
        "top {} vs {y0}",
        pt_to_mm(b.y)
    );
    assert!(
        near(pt_to_mm(b.width), total_w, tol),
        "width {} vs {total_w}",
        pt_to_mm(b.width)
    );
    assert!(
        near(pt_to_mm(b.height), total_h, tol),
        "height {} vs {total_h}",
        pt_to_mm(b.height)
    );
    assert!(
        near(gx, if columns > 1 { gap } else { 0.0 }, tol),
        "gap x {gx}"
    );
    assert!(
        near(gy, if rows > 1 { gap } else { 0.0 }, tol),
        "gap y {gy}"
    );
}

#[test]
fn edges_find_an_edge_to_edge_grid_to_half_a_millimetre() {
    let img = grey_page(
        GREY_LONG_SIDE_PX as usize * 210 / 297,
        sheet_shade(3, 3, 63.5, 88.0, 0.0, 9.75, 16.5),
    );
    let found = EdgesEngine.detect(&page_with_grey(img)).proposals;
    assert_eq!(found.len(), 1);
    assert_grid(&found[0], 3, 3, 9.75, 16.5, 63.5, 88.0, 0.0, 0.5);
    assert!(
        found[0].confidence >= 0.7 && found[0].confidence <= 0.9,
        "{}",
        found[0].confidence
    );
    assert_eq!(found[0].engine, "edges");
}

#[test]
fn edges_find_a_grid_with_plain_gaps_and_the_gap_itself() {
    let img = grey_page(1131, sheet_shade(3, 3, 63.5, 88.0, 6.0, 3.75, 10.5));
    let found = EdgesEngine.detect(&page_with_grey(img)).proposals;
    assert_eq!(found.len(), 1);
    assert_grid(&found[0], 3, 3, 3.75, 10.5, 63.5, 88.0, 6.0, 0.5);
}

#[test]
fn edges_find_other_shapes_of_grid_and_two_columns() {
    for (columns, rows, w, h, x0, y0) in [
        (5, 2, 36.0, 50.0, 15.0, 80.0),
        (2, 4, 70.0, 60.0, 35.0, 25.0),
        (2, 2, 80.0, 100.0, 25.0, 40.0),
    ] {
        let img = grey_page(1131, sheet_shade(columns, rows, w, h, 0.0, x0, y0));
        let found = EdgesEngine.detect(&page_with_grey(img)).proposals;
        assert_eq!(found.len(), 1, "{columns}x{rows}");
        assert_grid(&found[0], columns, rows, x0, y0, w, h, 0.0, 0.5);
    }
}

#[test]
fn edges_find_a_single_row_across_the_ink() {
    let img = grey_page(1131, sheet_shade(4, 1, 45.0, 65.0, 0.0, 15.0, 100.0));
    let found = EdgesEngine.detect(&page_with_grey(img)).proposals;
    assert_eq!(found.len(), 1);
    assert_grid(&found[0], 4, 1, 15.0, 100.0, 45.0, 65.0, 0.0, 0.5);
    // One axis had nothing to repeat, so it is not as sure as a full grid.
    assert!(found[0].confidence < 0.9);
}

#[test]
fn edges_offer_nothing_for_a_blank_page_noise_or_a_smooth_picture() {
    let blank = EdgesEngine.detect(&page_with_grey(grey_page(800, |_, _| 255)));
    assert!(blank.proposals.is_empty());
    let mut state = 12345u32;
    let noise = grey_page(800, |_, _| {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        (state >> 24) as u8
    });
    let found = detect_page(&page_with_grey(noise), &[Box::new(EdgesEngine)]);
    assert!(
        found.proposals.iter().all(|p| p.confidence < 0.7),
        "{found:?}"
    );
    let smooth = EdgesEngine.detect(&page_with_grey(grey_page(800, |x, y| {
        (60.0 + x * 0.4 + y * 0.3) as u8
    })));
    assert!(smooth.proposals.is_empty());
    assert_eq!(smooth.reasons, [Note::NoRegularPattern]);
}

/// A scan: a plain bed with a little noise and the given pieces (centre mm, size mm, angle degrees,
/// corner radius mm), each a tone with a lighter stripe.
fn scan(pieces: &[(f64, f64, f64, f64, f64, f64)]) -> GreyImage {
    let mut state = 99u32;
    grey_page(1131, move |x, y| {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        let noise = ((state >> 28) as i32) - 8; // -8..7
        for &(cx, cy, w, h, angle, radius) in pieces {
            let (s, c) = angle.to_radians().sin_cos();
            let (dx, dy) = (x - cx, y - cy);
            // Into the piece's own axes.
            let (u, v) = (dx * c + dy * s, -dx * s + dy * c);
            let (hw, hh) = (w / 2.0, h / 2.0);
            let inside = if radius > 0.0 {
                let (qx, qy) = (
                    (u.abs() - (hw - radius)).max(0.0),
                    (v.abs() - (hh - radius)).max(0.0),
                );
                u.abs() <= hw && v.abs() <= hh && qx * qx + qy * qy <= radius * radius
            } else {
                u.abs() <= hw && v.abs() <= hh
            };
            if inside {
                let stripe = ((u * 0.4).floor() as i64).rem_euclid(2) == 0;
                return (if stripe { 70 } else { 110 } + noise).clamp(0, 255) as u8;
            }
        }
        (205 + noise).clamp(0, 255) as u8
    })
}

#[test]
fn blobs_give_one_rotated_rectangle_per_piece_tilt_included() {
    // Six pieces, 3 columns by 2 rows, each tilted differently; one has rounded corners.
    let tilts = [-12.0, 5.0, 15.0, -4.0, 9.0, 0.0];
    let pieces: Vec<_> = (0..6)
        .map(|i| {
            let (col, row) = (i % 3, i / 3);
            let radius = if i == 4 { 4.0 } else { 0.0 };
            (
                35.0 + col as f64 * 70.0,
                80.0 + row as f64 * 100.0,
                45.0,
                63.0,
                tilts[i],
                radius,
            )
        })
        .collect();
    let found = BlobsEngine.detect(&page_with_grey(scan(&pieces))).proposals;
    assert_eq!(found.len(), 1);
    let rects = rects_of(&found[0]);
    assert_eq!(rects.len(), 6);
    for (r, &(cx, cy, w, h, angle, _)) in rects.iter().zip(&pieces) {
        assert!(
            near(pt_to_mm(r.center.x), cx, 1.0) && near(pt_to_mm(r.center.y), cy, 1.0),
            "{r:?} vs {cx},{cy}"
        );
        assert!(
            near(r.angle_deg, angle, 1.0),
            "angle {} vs {angle}",
            r.angle_deg
        );
        assert!(
            near(pt_to_mm(r.width), w, 1.0) && near(pt_to_mm(r.height), h, 1.0),
            "{r:?} vs {w}x{h}"
        );
    }
    assert!(found[0].confidence >= 0.7, "{}", found[0].confidence);
    assert_eq!(found[0].engine, "blobs");
}

#[test]
fn blobs_say_pieces_that_touch_cannot_be_told_apart() {
    // Two pieces overlapping at different angles make one lumpy shape.
    let pieces = [
        (80.0, 120.0, 60.0, 80.0, 20.0, 0.0),
        (125.0, 150.0, 60.0, 80.0, -15.0, 0.0),
    ];
    let found = BlobsEngine.detect(&page_with_grey(scan(&pieces)));
    assert!(found.proposals.is_empty(), "{found:?}");
    assert_eq!(found.reasons, [Note::MergedPieces]);
}

#[test]
fn blobs_offer_nothing_for_a_blank_page_and_little_for_one_piece_at_the_edge() {
    assert!(BlobsEngine
        .detect(&page_with_grey(grey_page(800, |_, _| 240)))
        .proposals
        .is_empty());
    let one = BlobsEngine.detect(&page_with_grey(scan(&[(
        100.0, 150.0, 50.0, 70.0, 6.0, 0.0,
    )])));
    assert!(one.proposals[0].confidence < 0.7);
    assert!(one.proposals[0].notes.contains(&Note::OnePiece));
}

// ---- the whole path through pdfium ---------------------------------------------------------

fn pdfium() -> Option<pdfium_render::prelude::Pdfium> {
    match bind_pdfium(&[]) {
        Ok(p) => Some(p),
        Err(_) => {
            assert!(
                std::env::var_os("CI").is_none(),
                "pdfium not available in CI"
            );
            eprintln!("SKIPPED pdfium detect: pdfium not available (set PDFIUM_LIB_PATH)");
            None
        }
    }
}

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("card-core-detect-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn read(pdfium: &pdfium_render::prelude::Pdfium, mut doc: Document, name: &str) -> PageData {
    let path = scratch(name).join("page.pdf");
    doc.save(&path).unwrap();
    let loaded = pdfium.load_pdf_from_file(&path, None).unwrap();
    read_page_data(&loaded, 0).unwrap()
}

/// A page of `w_mm` x `h_mm` with the given content stream and resources.
fn pdf_page(w_mm: f64, h_mm: f64, ops: String, resources: Dictionary) -> Document {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let content_id = doc.add_object(Stream::new(dictionary! {}, ops.into_bytes()));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), Object::Real(mm_to_pt(w_mm) as f32), Object::Real(mm_to_pt(h_mm) as f32)],
        "Resources" => resources,
        "Contents" => content_id,
    });
    doc.objects.insert(
        pages_id,
        Object::Dictionary(
            dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 },
        ),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    doc
}

/// Vector pieces: a filled rectangle and a stroked one each, like a publisher's sheet. Millimetres, top-left origin.
fn vector_ops(rects: &[(f64, f64, f64, f64)]) -> String {
    let mut ops = String::new();
    for (i, &(x, y, w, h)) in rects.iter().enumerate() {
        let (px, py) = (mm_to_pt(x), mm_to_pt(A4_MM.1 - y - h));
        let tone = 0.3 + 0.05 * (i % 8) as f64;
        ops.push_str(&format!(
            "{tone:.2} 0.5 0.6 rg\n{px:.3} {py:.3} {:.3} {:.3} re f\n0 G 1 w\n{px:.3} {py:.3} {:.3} {:.3} re S\n",
            mm_to_pt(w),
            mm_to_pt(h),
            mm_to_pt(w),
            mm_to_pt(h),
        ));
    }
    ops
}

#[allow(clippy::too_many_arguments)]
fn vector_grid(
    columns: usize,
    rows: usize,
    w: f64,
    h: f64,
    gap: f64,
    x0: f64,
    y0: f64,
    skip: usize,
) -> Document {
    let mut rects = Vec::new();
    for r in 0..rows {
        for c in 0..columns {
            rects.push((x0 + c as f64 * (w + gap), y0 + r as f64 * (h + gap), w, h));
        }
    }
    rects.truncate(rects.len() - skip);
    pdf_page(A4_MM.0, A4_MM.1, vector_ops(&rects), dictionary! {})
}

/// A picture of `rgb` as the only content of an A4 page.
fn image_pdf(rgb: &image::RgbImage) -> Document {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut stream = Stream::new(
        dictionary! {
            "Type" => "XObject", "Subtype" => "Image",
            "Width" => rgb.width() as i64, "Height" => rgb.height() as i64,
            "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8,
        },
        rgb.as_raw().clone(),
    );
    let _ = stream.compress();
    let image_id = doc.add_object(stream);
    let (w, h) = (mm_to_pt(A4_MM.0), mm_to_pt(A4_MM.1));
    let content_id = doc.add_object(Stream::new(
        dictionary! {},
        format!("q {w:.3} 0 0 {h:.3} 0 0 cm /Im Do Q").into_bytes(),
    ));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), Object::Real(w as f32), Object::Real(h as f32)],
        "Resources" => dictionary! { "XObject" => dictionary! { "Im" => image_id } },
        "Contents" => content_id,
    });
    doc.objects.insert(
        pages_id,
        Object::Dictionary(
            dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 },
        ),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    doc
}

/// What pdfium draws for `doc`, as one flat picture of an A4 page.
fn rasterised(pdfium: &pdfium_render::prelude::Pdfium, mut doc: Document, name: &str) -> Document {
    let path = scratch(name).join("source.pdf");
    doc.save(&path).unwrap();
    let png = card_core::render::render_page_png(pdfium, &path, 0, 1240).unwrap();
    image_pdf(&image::load_from_memory(&png).unwrap().to_rgb8())
}

fn best(d: &Detection) -> &Proposal {
    d.proposals
        .first()
        .unwrap_or_else(|| panic!("nothing was offered: {d:?}"))
}

#[test]
fn a_vector_sheet_is_found_exactly_by_the_objects_engine() {
    let Some(pdfium) = pdfium() else { return };
    let sample = card_core::sample::sample_pdf();
    let d = detect_page(&read(&pdfium, sample, "vector"), &default_engines());
    let p = best(&d);
    assert_eq!(p.engine, "pdf-objects");
    assert!(p.confidence >= 0.9, "{}", p.confidence);
    // The sample's own grid, to a hundredth of a millimetre.
    let want = card_core::sample::sample_grid(0.0);
    let (b, rows, columns, gx, gy) = grid_of(p);
    assert_eq!((rows, columns), (3, 3));
    assert!(near(b.x / a4().width_pt, want.bounds.x, 1e-4), "{b:?}");
    assert!(near(b.y / a4().height_pt, want.bounds.y, 1e-4));
    assert!(near(b.width / a4().width_pt, want.bounds.width, 1e-4));
    assert!(near(b.height / a4().height_pt, want.bounds.height, 1e-4));
    assert!(near(gx, 0.0, 0.01) && near(gy, 0.0, 0.01));

    // The proposal is a grid the layout engine reads back as the same cards.
    let grid = card_core::layout::GridLayout {
        bounds: Rect::new(
            b.x / a4().width_pt,
            b.y / a4().height_pt,
            b.width / a4().width_pt,
            b.height / a4().height_pt,
        ),
        rows,
        columns,
        source_gap_x_mm: gx,
        source_gap_y_mm: gy,
        ..want
    };
    let cards = card_core::layout::source_cards(a4(), &grid).unwrap();
    let truth = card_core::layout::source_cards(a4(), &want).unwrap();
    for (c, t) in cards.iter().zip(&truth) {
        assert!(
            near(pt_to_mm(c.rect.x), pt_to_mm(t.rect.x), 0.05)
                && near(pt_to_mm(c.rect.width), pt_to_mm(t.rect.width), 0.05)
        );
        assert!(
            near(pt_to_mm(c.rect.y), pt_to_mm(t.rect.y), 0.05)
                && near(pt_to_mm(c.rect.height), pt_to_mm(t.rect.height), 0.05)
        );
    }
}

#[test]
fn a_vector_sheet_with_gaps_a_missing_cell_and_crop_marks() {
    let Some(pdfium) = pdfium() else { return };
    let d = detect_page(
        &read(
            &pdfium,
            vector_grid(3, 3, 63.5, 88.0, 6.0, 3.75, 10.5, 0),
            "gaps",
        ),
        &default_engines(),
    );
    assert_grid(best(&d), 3, 3, 3.75, 10.5, 63.5, 88.0, 6.0, 0.02);

    let d = detect_page(
        &read(
            &pdfium,
            vector_grid(4, 2, 45.0, 60.0, 0.0, 15.0, 40.0, 1),
            "missing",
        ),
        &default_engines(),
    );
    // The objects say a cell is empty; the edges, which cannot see that, may propose the full grid.
    let from_objects = d
        .proposals
        .iter()
        .find(|p| p.engine == "pdf-objects")
        .unwrap();
    assert!(from_objects.notes.contains(&Note::MissingCells));
    assert!(from_objects.confidence < 0.75);

    // Crop marks drawn as strokes in the margin.
    let mut rects = Vec::new();
    for r in 0..2 {
        for c in 0..2 {
            rects.push((40.0 + c as f64 * 63.5, 60.0 + r as f64 * 88.0, 63.5, 88.0));
        }
    }
    let mut ops = vector_ops(&rects);
    for x in [40.0, 167.0] {
        for (a, b) in [(50.0, 57.0), (239.0, 246.0)] {
            ops.push_str(&format!(
                "0 G 0.5 w {:.3} {:.3} m {:.3} {:.3} l S\n",
                mm_to_pt(x),
                mm_to_pt(A4_MM.1 - a),
                mm_to_pt(x),
                mm_to_pt(A4_MM.1 - b),
            ));
        }
    }
    let marked = pdf_page(A4_MM.0, A4_MM.1, ops, dictionary! {});
    let d = detect_page(&read(&pdfium, marked, "marks"), &default_engines());
    assert!(best(&d).notes.contains(&Note::CropMarks), "{:?}", best(&d));
}

#[test]
fn rotated_and_cropped_pages_are_found_where_the_preview_shows_them() {
    let Some(pdfium) = pdfium() else { return };
    let page_box = [20.0, 30.0, 560.0, 800.0];
    for rotate in [0, 90, 180, 270] {
        for crop in [false, true] {
            let mut doc = card_core::sample::sample_pdf();
            if rotate != 0 {
                card_core::sample::set_rotate(&mut doc, rotate);
            }
            let media = [0.0, 0.0, mm_to_pt(A4_MM.0), mm_to_pt(A4_MM.1)];
            if crop {
                card_core::sample::set_crop_box(&mut doc, page_box);
            }
            let used = if crop { page_box } else { media };
            let want = card_core::sample::sample_grid_for(used, rotate, 0.0);
            let data = read(&pdfium, doc, &format!("r{rotate}{crop}"));
            let d = detect_page(&data, &default_engines());
            let (b, rows, columns, _, _) = grid_of(best(&d));
            assert_eq!(best(&d).engine, "pdf-objects");
            assert_eq!((rows, columns), (3, 3), "rotate {rotate} crop {crop}");
            let (dw, dh) = (data.size.width_pt, data.size.height_pt);
            assert!(
                near(b.x / dw, want.bounds.x, 2e-4)
                    && near(b.y / dh, want.bounds.y, 2e-4)
                    && near(b.width / dw, want.bounds.width, 2e-4)
                    && near(b.height / dh, want.bounds.height, 2e-4),
                "rotate {rotate} crop {crop}: {b:?} vs {:?} on {dw}x{dh}",
                want.bounds
            );
        }
    }
}

#[test]
fn a_page_wrapped_in_one_form_and_a_background_picture_still_give_the_pieces() {
    let Some(pdfium) = pdfium() else { return };
    // The pieces drawn inside a form that covers the page, moved by the form's matrix.
    let mut doc = pdf_page(A4_MM.0, A4_MM.1, "/Fm Do".into(), dictionary! {});
    let rects: Vec<_> = (0..4)
        .map(|i| {
            (
                20.0 + (i % 2) as f64 * 70.0,
                30.0 + (i / 2) as f64 * 95.0,
                70.0,
                95.0,
            )
        })
        .collect();
    let (w, h) = (mm_to_pt(A4_MM.0), mm_to_pt(A4_MM.1));
    let form = Stream::new(
        dictionary! {
            "Type" => "XObject", "Subtype" => "Form",
            "BBox" => vec![0.into(), 0.into(), Object::Real(w as f32), Object::Real(h as f32)],
            "Matrix" => vec![1.into(), 0.into(), 0.into(), 1.into(), 0.into(), 0.into()],
        },
        vector_ops(&rects).into_bytes(),
    );
    let form_id = doc.add_object(form);
    let page_id = *doc.get_pages().values().next().unwrap();
    doc.get_dictionary_mut(page_id).unwrap().set(
        "Resources",
        dictionary! { "XObject" => dictionary! { "Fm" => form_id } },
    );
    let d = detect_page(&read(&pdfium, doc, "form"), &default_engines());
    assert_grid(best(&d), 2, 2, 20.0, 30.0, 70.0, 95.0, 0.0, 0.05);
    assert_eq!(best(&d).engine, "pdf-objects");

    // A picture over the whole page behind the pieces is not a piece.
    let bg = image::RgbImage::from_pixel(20, 28, image::Rgb([230, 230, 200]));
    let mut doc = image_pdf(&bg);
    let page_id = *doc.get_pages().values().next().unwrap();
    let content = doc.get_page_content(page_id);
    let mut ops = String::from_utf8(content).unwrap();
    ops.push('\n');
    ops.push_str(&vector_ops(&rects));
    let content_id = doc.add_object(Stream::new(dictionary! {}, ops.into_bytes()));
    doc.get_dictionary_mut(page_id)
        .unwrap()
        .set("Contents", content_id);
    let d = detect_page(&read(&pdfium, doc, "background"), &default_engines());
    assert_grid(best(&d), 2, 2, 20.0, 30.0, 70.0, 95.0, 0.0, 0.05);
}

#[test]
fn a_flat_edge_to_edge_sheet_is_found_by_the_edges_to_half_a_millimetre() {
    let Some(pdfium) = pdfium() else { return };
    let flat = rasterised(&pdfium, card_core::sample::sample_pdf(), "flat");
    let d = detect_page(&read(&pdfium, flat, "flat-read"), &default_engines());
    let p = best(&d);
    assert_eq!(p.engine, "edges");
    assert!(
        p.confidence >= 0.7 && p.confidence <= 0.9,
        "{}",
        p.confidence
    );
    assert_grid(p, 3, 3, 9.75, 16.5, 63.5, 88.0, 0.0, 0.5);
}

#[test]
fn flat_sheets_with_white_gaps_and_other_shapes() {
    let Some(pdfium) = pdfium() else { return };
    let gapped = rasterised(
        &pdfium,
        vector_grid(3, 3, 63.5, 88.0, 6.0, 3.75, 10.5, 0),
        "flatgaps",
    );
    let d = detect_page(&read(&pdfium, gapped, "flatgaps-read"), &default_engines());
    assert_eq!(best(&d).engine, "edges");
    assert_grid(best(&d), 3, 3, 3.75, 10.5, 63.5, 88.0, 6.0, 0.5);

    let wide = rasterised(
        &pdfium,
        vector_grid(5, 2, 36.0, 50.0, 0.0, 15.0, 80.0, 0),
        "flat52",
    );
    let d = detect_page(&read(&pdfium, wide, "flat52-read"), &default_engines());
    assert_grid(best(&d), 5, 2, 15.0, 80.0, 36.0, 50.0, 0.0, 0.5);
}

#[test]
fn a_scan_gives_one_rotated_rectangle_per_piece_through_pdfium() {
    let Some(pdfium) = pdfium() else { return };
    let pieces = [
        (50.0, 70.0, 45.0, 63.0, -10.0, 0.0),
        (110.0, 75.0, 45.0, 63.0, 8.0, 0.0),
        (165.0, 72.0, 45.0, 63.0, 0.0, 3.0),
        (50.0, 170.0, 45.0, 63.0, 14.0, 0.0),
        (110.0, 172.0, 45.0, 63.0, -3.0, 0.0),
    ];
    let img = scan(&pieces);
    let rgb = image::RgbImage::from_fn(img.width as u32, img.height as u32, |x, y| {
        let v = img.at(x as usize, y as usize);
        image::Rgb([v, v, v])
    });
    let d = detect_page(&read(&pdfium, image_pdf(&rgb), "scan"), &default_engines());
    let p = best(&d);
    assert_eq!(p.engine, "blobs");
    let rects = rects_of(p);
    assert_eq!(rects.len(), 5);
    for (r, &(cx, cy, w, h, angle, _)) in rects.iter().zip(&pieces) {
        assert!(near(pt_to_mm(r.center.x), cx, 1.0) && near(pt_to_mm(r.center.y), cy, 1.0));
        assert!(near(r.angle_deg, angle, 1.0));
        assert!(near(pt_to_mm(r.width), w, 1.0) && near(pt_to_mm(r.height), h, 1.0));
    }
}

#[test]
fn weak_cases_say_so_instead_of_offering_a_confident_wrong_grid() {
    let Some(pdfium) = pdfium() else { return };
    // A blank page.
    let blank = pdf_page(A4_MM.0, A4_MM.1, String::new(), dictionary! {});
    assert!(
        detect_page(&read(&pdfium, blank, "blank"), &default_engines())
            .proposals
            .is_empty()
    );
    // A page that is one smooth picture.
    let photo = image::RgbImage::from_fn(300, 420, |x, y| {
        image::Rgb([(60 + x / 3) as u8, (80 + y / 4) as u8, 120])
    });
    let d = detect_page(
        &read(&pdfium, image_pdf(&photo), "photo"),
        &default_engines(),
    );
    assert!(d.proposals.iter().all(|p| p.confidence < 0.7), "{d:?}");
    // Noise.
    let mut state = 7u32;
    let noise = image::RgbImage::from_fn(400, 560, |_, _| {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        let v = (state >> 24) as u8;
        image::Rgb([v, v, v])
    });
    let d = detect_page(
        &read(&pdfium, image_pdf(&noise), "noise"),
        &default_engines(),
    );
    assert!(d.proposals.iter().all(|p| p.confidence < 0.7), "{d:?}");
}

#[test]
fn the_render_worker_detects_on_the_right_document() {
    use card_core::render_worker::RenderWorker;
    let Some(_) = pdfium() else { return };
    let dir = scratch("worker");
    let (a, b) = (dir.join("a.pdf"), dir.join("b.pdf"));
    card_core::sample::sample_pdf().save(&a).unwrap();
    vector_grid(2, 2, 70.0, 95.0, 0.0, 20.0, 30.0, 0)
        .save(&b)
        .unwrap();
    let worker = RenderWorker::spawn(Vec::new()).unwrap();
    worker.open(0, a).unwrap();
    worker.open(1, b).unwrap();
    let first = worker.detect(0, 0).unwrap();
    let second = worker.detect(1, 0).unwrap();
    assert_eq!(grid_of(best(&first)).1, 3);
    assert_eq!(grid_of(best(&second)).1, 2);
    assert!(worker.detect(9, 0).is_err());
    assert!(worker.detect(0, 5).is_err());
}

#[test]
fn the_detection_the_frontend_parses_is_the_one_rust_writes() {
    // Read by src/lib/detect.test.ts too: the two sides cannot drift apart unnoticed.
    let text = include_str!("data/detection.json");
    let d: Detection = serde_json::from_str(text).unwrap();
    assert_eq!(d.proposals.len(), 2);
    assert_eq!(grid_of(&d.proposals[0]).1, 3);
    assert_eq!(rects_of(&d.proposals[1]).len(), 2);
    assert_eq!(d.proposals[1].notes, [Note::UnevenSizes, Note::TouchesEdge]);
    // Written back, it is the same document.
    let written = serde_json::to_value(&d).unwrap();
    let original: serde_json::Value = serde_json::from_str(text).unwrap();
    assert_eq!(written, original);
}
