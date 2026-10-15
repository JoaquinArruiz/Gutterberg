//! The straight edges of a page (sticky edges): from the page's objects, from its grey render, and
//! the whole path through pdfium. Tests that need pdfium are skipped when it is not available (set
//! `PDFIUM_LIB_PATH`).
use card_core::detect::read::read_page_data;
use card_core::detect::{
    page_edges, GreyImage, HorizontalEdge, ObjectKind, PageData, PageEdges, PageObject,
    VerticalEdge, MAX_EDGES_PER_AXIS, MIN_EDGE_MM,
};
use card_core::geometry::{PageSize, Rect};
use card_core::render::bind_pdfium;
use card_core::units::mm_to_pt;
use lopdf::{dictionary, Document, Object, Stream};

const A4_MM: (f64, f64) = (210.0, 297.0);

fn a4() -> PageSize {
    PageSize {
        width_pt: mm_to_pt(A4_MM.0),
        height_pt: mm_to_pt(A4_MM.1),
    }
}

/// `x, y, w, h` in mm, top-left origin, as points.
fn rect_mm(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect::new(mm_to_pt(x), mm_to_pt(y), mm_to_pt(w), mm_to_pt(h))
}

fn objects(objects: Vec<(ObjectKind, Rect)>) -> PageData {
    PageData {
        size: a4(),
        objects: objects
            .into_iter()
            .map(|(kind, rect)| PageObject { kind, rect })
            .collect(),
        grey: None,
    }
}

/// An A4 grey render `w_px` wide; `shade` gets the centre of each pixel in mm.
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

fn picture(img: GreyImage) -> PageData {
    PageData {
        size: a4(),
        objects: Vec::new(),
        grey: Some(img),
    }
}

/// The vertical edge at `x_mm` (within `tol_mm`), if any.
fn vertical_at(e: &PageEdges, x_mm: f64, tol_mm: f64) -> Option<VerticalEdge> {
    e.vertical
        .iter()
        .copied()
        .find(|v| (v.x - mm_to_pt(x_mm)).abs() <= mm_to_pt(tol_mm))
}

fn horizontal_at(e: &PageEdges, y_mm: f64, tol_mm: f64) -> Option<HorizontalEdge> {
    e.horizontal
        .iter()
        .copied()
        .find(|h| (h.y - mm_to_pt(y_mm)).abs() <= mm_to_pt(tol_mm))
}

fn near_mm(pt: f64, mm: f64, tol_mm: f64) -> bool {
    (pt - mm_to_pt(mm)).abs() <= mm_to_pt(tol_mm)
}

#[test]
fn drawn_rectangles_give_their_sides_exactly_and_shared_sides_once() {
    // Two pieces side by side, touching, and a cut line under them.
    let e = page_edges(&objects(vec![
        (ObjectKind::Rect, rect_mm(20.0, 30.0, 63.0, 88.0)),
        (ObjectKind::Rect, rect_mm(83.0, 30.0, 63.0, 88.0)),
        (ObjectKind::Line, rect_mm(10.0, 130.0, 150.0, 0.0)),
    ]));
    assert_eq!(e.vertical.len(), 3, "{e:?}");
    for x in [20.0, 83.0, 146.0] {
        let v = vertical_at(&e, x, 0.001).unwrap();
        assert!(
            near_mm(v.y0, 30.0, 0.001) && near_mm(v.y1, 118.0, 0.001),
            "{v:?}"
        );
        assert_eq!(v.strength, 1.0);
    }
    assert_eq!(e.horizontal.len(), 3, "{e:?}");
    let top = horizontal_at(&e, 30.0, 0.001).unwrap();
    assert!(near_mm(top.x0, 20.0, 0.001) && near_mm(top.x1, 146.0, 0.001));
    let cut = horizontal_at(&e, 130.0, 0.001).unwrap();
    assert!(near_mm(cut.x0, 10.0, 0.001) && near_mm(cut.x1, 160.0, 0.001));
}

#[test]
fn small_objects_and_the_page_border_give_no_edges() {
    let e = page_edges(&objects(vec![
        // The page's background.
        (ObjectKind::Rect, rect_mm(0.0, 0.0, A4_MM.0, A4_MM.1)),
        // Art smaller than the shortest edge.
        (
            ObjectKind::Rect,
            rect_mm(50.0, 50.0, MIN_EDGE_MM - 1.0, MIN_EDGE_MM - 1.0),
        ),
        (ObjectKind::Image, rect_mm(100.0, 50.0, 2.0, 2.0)),
    ]));
    assert_eq!(e, PageEdges::default());
}

#[test]
fn a_dark_rectangle_in_the_render_gives_its_four_sides() {
    // A dark piece from (40, 50) to (103, 138) mm, and a noisy patch of 3 mm well away from it.
    let mut state = 7u32;
    let img = grey_page(1131, |x, y| {
        if (40.0..103.0).contains(&x) && (50.0..138.0).contains(&y) {
            40
        } else if (150.0..153.0).contains(&x) && (200.0..203.0).contains(&y) {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            if state >> 31 == 1 {
                0
            } else {
                255
            }
        } else {
            255
        }
    });
    let e = page_edges(&picture(img));
    let tol = 0.2;
    for x in [40.0, 103.0] {
        let v = vertical_at(&e, x, tol).unwrap_or_else(|| panic!("no edge at x {x}: {e:?}"));
        assert!(
            near_mm(v.y0, 50.0, 0.5) && near_mm(v.y1, 138.0, 0.5),
            "{v:?}"
        );
        assert!(v.strength > 0.7, "{v:?}");
    }
    for y in [50.0, 138.0] {
        let h = horizontal_at(&e, y, tol).unwrap_or_else(|| panic!("no edge at y {y}: {e:?}"));
        assert!(
            near_mm(h.x0, 40.0, 0.5) && near_mm(h.x1, 103.0, 0.5),
            "{h:?}"
        );
    }
    // Nothing else: the noisy patch is smaller than the shortest edge.
    assert_eq!((e.vertical.len(), e.horizontal.len()), (2, 2), "{e:?}");
}

#[test]
fn short_art_inside_a_piece_is_not_an_edge_and_weak_contrast_is_ignored() {
    let img = grey_page(1131, |x, y| {
        // A faint wash: under the contrast that counts.
        if (20.0..180.0).contains(&x) && (20.0..280.0).contains(&y) {
            if (60.0..63.0).contains(&x) && (100.0..103.0).contains(&y) {
                0 // a dot of art
            } else {
                240
            }
        } else {
            255
        }
    });
    let e = page_edges(&picture(img));
    assert_eq!(e, PageEdges::default(), "{e:?}");
}

#[test]
fn an_edge_in_both_the_objects_and_the_render_counts_once() {
    let mut page = picture(grey_page(1131, |x, y| {
        if (40.0..103.0).contains(&x) && (50.0..138.0).contains(&y) {
            40
        } else {
            255
        }
    }));
    page.objects.push(PageObject {
        kind: ObjectKind::Rect,
        rect: rect_mm(40.0, 50.0, 63.0, 88.0),
    });
    let e = page_edges(&page);
    assert_eq!((e.vertical.len(), e.horizontal.len()), (2, 2), "{e:?}");
    assert!(e.vertical.iter().all(|v| v.strength == 1.0));
}

#[test]
fn the_number_of_edges_is_capped_and_the_strongest_are_kept() {
    // Many short stripes, then a few long ones: the long ones survive the cap.
    let mut objs = Vec::new();
    for i in 0..400 {
        let x = 5.0 + i as f64 * 0.45;
        objs.push((ObjectKind::Line, rect_mm(x, 10.0, 0.0, MIN_EDGE_MM + 1.0)));
    }
    let mut page = objects(objs);
    page.grey = Some(grey_page(1131, |x, _| {
        if (30.0..31.0).contains(&x) {
            0
        } else {
            255
        }
    }));
    let e = page_edges(&page);
    assert_eq!(e.vertical.len(), MAX_EDGES_PER_AXIS);
    assert!(
        e.vertical.windows(2).all(|w| w[0].x <= w[1].x),
        "in reading order"
    );

    // Render edges alone: stripes of contrast, more than the cap.
    let img = grey_page(1600, |x, y| {
        if y < 100.0 && (x * 4.0) as i64 % 2 == 0 {
            0
        } else {
            255
        }
    });
    let e = page_edges(&picture(img));
    assert!(
        e.vertical.len() <= MAX_EDGES_PER_AXIS,
        "{}",
        e.vertical.len()
    );
    assert!(e.vertical.len() > MAX_EDGES_PER_AXIS / 2);
    assert!(e.vertical.iter().all(|v| (0.0..=1.0).contains(&v.strength)));
}

#[test]
fn the_edges_the_frontend_parses_are_the_ones_rust_writes() {
    // Read by src/lib/edges-api.test.ts too: the two sides cannot drift apart unnoticed.
    let text = include_str!("data/page_edges.json");
    let e: PageEdges = serde_json::from_str(text).unwrap();
    assert_eq!((e.vertical.len(), e.horizontal.len()), (2, 1));
    let written = serde_json::to_value(&e).unwrap();
    let original: serde_json::Value = serde_json::from_str(text).unwrap();
    assert_eq!(written, original);
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
            eprintln!("SKIPPED pdfium page edges: pdfium not available (set PDFIUM_LIB_PATH)");
            None
        }
    }
}

/// An A4 page of pieces drawn as filled and stroked rectangles, in mm with a top-left origin.
fn vector_page(rects: &[(f64, f64, f64, f64)]) -> Document {
    let mut ops = String::new();
    for &(x, y, w, h) in rects {
        let (px, py) = (mm_to_pt(x), mm_to_pt(A4_MM.1 - y - h));
        let (pw, ph) = (mm_to_pt(w), mm_to_pt(h));
        ops.push_str(&format!(
            "0.4 0.5 0.6 rg\n{px:.3} {py:.3} {pw:.3} {ph:.3} re f\n0 G 1 w\n{px:.3} {py:.3} {pw:.3} {ph:.3} re S\n"
        ));
    }
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let content_id = doc.add_object(Stream::new(dictionary! {}, ops.into_bytes()));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page", "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), Object::Real(a4().width_pt as f32), Object::Real(a4().height_pt as f32)],
        "Resources" => dictionary! {},
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

#[test]
fn a_vector_page_gives_the_sides_of_its_pieces_through_pdfium() {
    let Some(pdfium) = pdfium() else { return };
    let dir = std::env::temp_dir().join(format!("card-core-edges-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("page.pdf");
    vector_page(&[(20.0, 30.0, 63.0, 88.0), (90.0, 30.0, 63.0, 88.0)])
        .save(&path)
        .unwrap();
    let doc = pdfium.load_pdf_from_file(&path, None).unwrap();
    let e = page_edges(&read_page_data(&doc, 0).unwrap());
    for x in [20.0, 83.0, 90.0, 153.0] {
        let v = vertical_at(&e, x, 0.01).unwrap_or_else(|| panic!("no edge at x {x}: {e:?}"));
        assert_eq!(v.strength, 1.0);
    }
    assert_eq!(
        e.vertical.len(),
        4,
        "the render adds nothing the objects explain: {e:?}"
    );
    assert_eq!(e.horizontal.len(), 4, "{e:?}");
}

#[test]
fn the_render_worker_gives_the_edges_of_a_page() {
    use card_core::render_worker::RenderWorker;
    let Some(_) = pdfium() else { return };
    let dir = std::env::temp_dir().join(format!("card-core-edges-worker-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("page.pdf");
    vector_page(&[(20.0, 30.0, 63.0, 88.0)])
        .save(&path)
        .unwrap();
    let worker = RenderWorker::spawn(Vec::new()).unwrap();
    worker.open(0, path).unwrap();
    let e = worker.page_edges(0, 0).unwrap();
    assert_eq!((e.vertical.len(), e.horizontal.len()), (2, 2), "{e:?}");
    assert!(worker.page_edges(9, 0).is_err());
}

#[test]
fn a_scanned_piece_slightly_turned_and_noisy_still_has_long_edges() {
    // A piece turned by 0.5°, on a scan with grain.
    let (s, c) = 0.5f64.to_radians().sin_cos();
    let mut state = 11u32;
    let img = grey_page(1131, |x, y| {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        let grain = ((state >> 28) as i32) - 8;
        let (u, v) = (
            (x - 70.0) * c + (y - 100.0) * s,
            -(x - 70.0) * s + (y - 100.0) * c,
        );
        let base = if u.abs() < 31.5 && v.abs() < 44.0 {
            60
        } else {
            235
        };
        (base + grain).clamp(0, 255) as u8
    });
    let e = page_edges(&picture(img));
    let left = e
        .vertical
        .iter()
        .filter(|v| (v.x - mm_to_pt(38.5)).abs() < mm_to_pt(1.5))
        .map(|v| v.y1 - v.y0)
        .fold(0.0, f64::max);
    assert!(left >= mm_to_pt(20.0), "{e:?}");
    let top = e
        .horizontal
        .iter()
        .filter(|h| (h.y - mm_to_pt(56.0)).abs() < mm_to_pt(1.5))
        .map(|h| h.x1 - h.x0)
        .fold(0.0, f64::max);
    assert!(top >= mm_to_pt(20.0), "{e:?}");
}
