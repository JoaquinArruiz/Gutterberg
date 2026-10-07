//! Real-world page structures: rotation, CropBox offsets, inherited boxes, outlines.
//! Each must export, and (with pdfium available) the exported cards must be exactly where
//! pdfium shows them in the source.
use card_core::export::{export_document, export_pdf, page_size, ExportJob, PageJob};
use card_core::layout::{calculate_layout, GridLayout};
use card_core::render::{bind_pdfium, document_info, render_page_png};
use card_core::sample::{
    add_outlines, inherit_page_attributes, sample_grid_for, sample_pdf, set_crop_box, set_rotate,
    A4_MM,
};
use card_core::units::mm_to_pt;
use card_core::Error;
use lopdf::{Document, Object};

struct Fixture {
    name: &'static str,
    doc: Document,
    grid: GridLayout,
}

fn full_box() -> [f64; 4] {
    [0.0, 0.0, mm_to_pt(A4_MM.0), mm_to_pt(A4_MM.1)]
}

fn fixtures() -> Vec<Fixture> {
    let gap = 3.0;
    let mut v = Vec::new();
    for angle in [0, 90, 180, 270] {
        let mut doc = sample_pdf();
        set_rotate(&mut doc, angle);
        v.push(Fixture {
            name: ["rotate-0", "rotate-90", "rotate-180", "rotate-270"][(angle / 90) as usize],
            doc,
            grid: sample_grid_for(full_box(), angle, gap),
        });
    }

    let crop = [10.0, 20.0, 585.0, 820.0];
    let mut doc = sample_pdf();
    set_crop_box(&mut doc, crop);
    v.push(Fixture {
        name: "crop-box-offset",
        doc,
        grid: sample_grid_for(crop, 0, gap),
    });

    let mut doc = sample_pdf();
    set_crop_box(&mut doc, crop);
    set_rotate(&mut doc, 90);
    v.push(Fixture {
        name: "crop-box-rotated",
        doc,
        grid: sample_grid_for(crop, 90, gap),
    });

    let mut doc = sample_pdf();
    set_rotate(&mut doc, 270);
    inherit_page_attributes(&mut doc);
    v.push(Fixture {
        name: "inherited-boxes",
        doc,
        grid: sample_grid_for(full_box(), 270, gap),
    });

    let mut doc = sample_pdf();
    add_outlines(&mut doc);
    v.push(Fixture {
        name: "outlines",
        doc,
        grid: sample_grid_for(full_box(), 0, gap),
    });
    v
}

fn rgb_at(img: &image::RgbaImage, x: f64, y: f64) -> [u8; 3] {
    let p = img.get_pixel(
        (x as u32).min(img.width() - 1),
        (y as u32).min(img.height() - 1),
    );
    [p[0], p[1], p[2]]
}

#[test]
fn every_fixture_exports_and_cards_land_where_pdfium_shows_them() {
    let pdfium = bind_pdfium(&[]).ok();
    if pdfium.is_none() {
        assert!(
            std::env::var_os("CI").is_none(),
            "pdfium not available in CI"
        );
        eprintln!("SKIPPED pdfium comparison: pdfium not available (set PDFIUM_LIB_PATH)");
    }
    let dir = std::env::temp_dir().join(format!("card-core-fixtures-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();

    for mut f in fixtures() {
        let size = page_size(&f.doc, 0).unwrap();
        let src = dir.join(format!("{}-src.pdf", f.name));
        let out = dir.join(format!("{}-out.pdf", f.name));
        f.doc.save(&src).unwrap();
        let job = ExportJob {
            pages: vec![PageJob {
                page_index: 0,
                grid: f.grid,
            }],
        };
        export_pdf(&src, &out, &job).unwrap_or_else(|e| panic!("{}: {e}", f.name));
        Document::load(&out).unwrap();
        let layout = calculate_layout(size, &f.grid, None).unwrap();
        assert_eq!(layout.placements.len(), 9, "{}", f.name);

        let Some(pdfium) = &pdfium else { continue };
        let info = document_info(pdfium, &src).unwrap();
        assert!(
            (info.pages[0].width_pt - size.width_pt).abs() < 0.01
                && (info.pages[0].height_pt - size.height_pt).abs() < 0.01,
            "{}: pdfium sees {:?}, we see {size:?}",
            f.name,
            info.pages[0]
        );

        let load = |path: &std::path::Path, w: f64| {
            let png = render_page_png(pdfium, path, 0, w.round() as u32).unwrap();
            image::load_from_memory(&png).unwrap().to_rgba8()
        };
        let a = load(&src, size.width_pt);
        let b = load(&out, layout.output_page.width_pt);
        let (sa, sb) = (
            a.width() as f64 / size.width_pt,
            b.width() as f64 / layout.output_page.width_pt,
        );
        let mut colours = std::collections::HashSet::new();
        for p in &layout.placements {
            // Just inside the card's top-left corner: plain fill, no text or circle.
            let (dx, dy) = (p.source.width * 0.1, p.source.height * 0.1);
            let s = rgb_at(&a, (p.source.x + dx) * sa, (p.source.y + dy) * sa);
            let d = rgb_at(&b, (p.destination.x + dx) * sb, (p.destination.y + dy) * sb);
            colours.insert(s);
            for c in 0..3 {
                assert!(
                    (s[c] as i32 - d[c] as i32).abs() <= 6,
                    "{}: card {} source {s:?} vs exported {d:?}",
                    f.name,
                    p.index
                );
            }
        }
        assert!(
            colours.len() >= 8,
            "{}: cards should look different",
            f.name
        );
    }
}

#[test]
fn outlines_do_not_keep_old_pages_alive() {
    let original = {
        let mut doc = sample_pdf();
        add_outlines(&mut doc);
        let mut buf = Vec::new();
        doc.save_to(&mut buf).unwrap();
        buf
    };
    let mut doc = Document::load_mem(&original).unwrap();
    let job = ExportJob {
        pages: vec![PageJob {
            page_index: 0,
            grid: sample_grid_for(full_box(), 0, 3.0),
        }],
    };
    export_document(&mut doc, &job).unwrap();
    let catalog = doc.catalog().unwrap();
    assert!(catalog.get(b"Outlines").is_err());
    let pages = doc
        .objects
        .values()
        .filter(|o| matches!(o, Object::Dictionary(d) if d.get(b"Type").and_then(|t| t.as_name()).is_ok_and(|n| n == b"Page")))
        .count();
    assert_eq!(pages, 1, "only the new page should remain");
    let mut buf = Vec::new();
    doc.save_to(&mut buf).unwrap();
    assert!(
        buf.len() < original.len() * 2,
        "{} vs {}",
        buf.len(),
        original.len()
    );
}

#[test]
fn unsupported_pages_fail_naming_the_page() {
    let job = |doc: &mut Document| {
        export_document(
            doc,
            &ExportJob {
                pages: vec![PageJob {
                    page_index: 0,
                    grid: sample_grid_for(full_box(), 0, 3.0),
                }],
            },
        )
    };

    let mut doc = sample_pdf();
    set_rotate(&mut doc, 45);
    let e = job(&mut doc).unwrap_err();
    assert!(matches!(e, Error::UnsupportedRotation(0, 45)));
    assert!(e.to_string().contains("page 1"), "{e}");

    let mut doc = sample_pdf();
    let id = *doc.get_pages().values().next().unwrap();
    doc.get_dictionary_mut(id).unwrap().set("UserUnit", 2);
    let e = job(&mut doc).unwrap_err();
    assert!(e.to_string().contains("page 1") && e.to_string().contains("UserUnit"));

    let mut doc = sample_pdf();
    set_crop_box(&mut doc, [1000.0, 1000.0, 1100.0, 1100.0]);
    let e = job(&mut doc).unwrap_err();
    assert!(e.to_string().contains("page 1"), "{e}");
}

#[test]
fn undecodable_content_is_an_error_not_a_raw_copy() {
    let mut doc = sample_pdf();
    let page = *doc.get_pages().values().next().unwrap();
    let content = doc.get_page_contents(page)[0];
    let Ok(Object::Stream(s)) = doc.get_object_mut(content) else {
        panic!("content stream")
    };
    s.dict.set("Filter", "JBIG2Decode");
    s.content = b"not content".to_vec();
    let e = export_document(
        &mut doc,
        &ExportJob {
            pages: vec![PageJob {
                page_index: 0,
                grid: sample_grid_for(full_box(), 0, 3.0),
            }],
        },
    )
    .unwrap_err();
    assert!(e.to_string().contains("page 1"), "{e}");
}

#[test]
fn failed_export_leaves_no_output_file() {
    let dir = std::env::temp_dir().join(format!("card-core-atomic-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let src = dir.join("in.pdf");
    let out = dir.join("out.pdf");
    sample_pdf().save(&src).unwrap();
    let job = ExportJob {
        pages: vec![PageJob {
            page_index: 0,
            grid: sample_grid_for(full_box(), 0, 50.0), // does not fit
        }],
    };
    assert!(export_pdf(&src, &out, &job).is_err());
    assert!(!out.exists());
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1, "no temp files");
}
