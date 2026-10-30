//! CMYK export: the app's own colours and pictures are written in CMYK, the sources are left as they are.
//!
//! The images are tiny and made here, never real card art.
use card_core::card::{PageGroup, PageGroupKind, PageRange};
use card_core::cmyk::ColorMode;
use card_core::export::{drawn_content, export_sheets, export_sheets_with_images, page_sizes};
use card_core::finish::{
    plan_and_finish, BackgroundOptions, FinishOptions, Finishing, MarkOptions, MarkStyle,
};
use card_core::geometry::PageSize;
use card_core::images::{build_images_pdf, plan_image, probe_image, Fit, ImageSpec, Placement};
use card_core::layout::GridLayout;
use card_core::sample::{sample_grid, sample_pdf};
use card_core::sheet::{
    DocumentSource, Margins, OutputSheet, PaginateOptions, PrintLayout, SheetPage, SheetSpec,
};
use card_core::units::mm_to_pt;
use image::{ImageEncoder, Rgb, RgbImage, Rgba, RgbaImage};
use lopdf::{Document, Object, ObjectId};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("card-core-cmyk-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn png(dir: &Path, name: &str) -> PathBuf {
    let img = RgbaImage::from_fn(30, 42, |x, _| {
        Rgba([200, 30, 30, if x < 3 { 0 } else { 255 }])
    });
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new(&mut out)
        .write_image(img.as_raw(), 30, 42, image::ExtendedColorType::Rgba8)
        .unwrap();
    let p = dir.join(name);
    std::fs::write(&p, out).unwrap();
    p
}

fn jpeg(dir: &Path, name: &str) -> PathBuf {
    let img = RgbImage::from_fn(30, 42, |_, _| Rgb([30, 60, 200]));
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90)
        .write_image(img.as_raw(), 30, 42, image::ExtendedColorType::Rgb8)
        .unwrap();
    let p = dir.join(name);
    std::fs::write(&p, out).unwrap();
    p
}

fn spec(path: &Path) -> ImageSpec {
    ImageSpec {
        path: path.to_string_lossy().into_owned(),
        hash: probe_image(path).unwrap().hash,
        placement: Placement {
            width_mm: 63.0,
            height_mm: 88.0,
            bleed_mm: 0.0,
            fit: Fit::Fill,
            reduce_large: false,
        },
        missing: false,
    }
}

/// An images document of `paths` (one piece a page), as the planner reads it.
fn images_doc(d: &Path, paths: &[PathBuf]) -> (Document, DocumentSource) {
    let specs: Vec<ImageSpec> = paths.iter().map(|p| spec(p)).collect();
    let out = d.join("images.pdf");
    build_images_pdf(&specs, &out).unwrap();
    let doc = Document::load(&out).unwrap();
    let plan = plan_image(&probe_image(&paths[0]).unwrap(), &specs[0].placement);
    let grid = GridLayout {
        bounds: plan.piece,
        rows: 1,
        columns: 1,
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
    };
    let source = DocumentSource {
        document_id: 0,
        pages: page_sizes(&doc).into_iter().map(|p| p.unwrap()).collect(),
        groups: vec![PageGroup {
            pages: PageRange {
                first: 0,
                last: paths.len() - 1,
            },
            kind: PageGroupKind::grid(grid),
        }],
    };
    (doc, source)
}

fn a4() -> PrintLayout {
    PrintLayout::Grid {
        spec: SheetSpec {
            page: SheetPage::Size(PageSize {
                width_pt: mm_to_pt(210.0),
                height_pt: mm_to_pt(297.0),
            }),
            rows: None,
            columns: None,
            gap_x_mm: 2.0,
            gap_y_mm: 2.0,
            margins: Margins::default(),
        },
    }
}

/// Black ticks, a red sheet and the given colours.
fn finishing(colors: ColorMode) -> Finishing {
    Finishing {
        options: FinishOptions {
            marks: MarkOptions {
                style: MarkStyle::Ticks,
                color: "#000000".into(),
                ..MarkOptions::default()
            },
            background: BackgroundOptions {
                sheet: Some("#ff0000".into()),
                pieces: None,
            },
            colors,
            ..FinishOptions::default()
        },
        ..Finishing::default()
    }
}

fn sheets(source: &DocumentSource, colors: ColorMode) -> Vec<OutputSheet> {
    let (sheets, issues) = plan_and_finish(
        std::slice::from_ref(source),
        &[],
        &a4(),
        &PaginateOptions::default(),
        &finishing(colors),
    )
    .unwrap();
    assert!(issues.is_empty(), "{issues:?}");
    sheets
}

/// Every image XObject of `doc` with its colour space name (`ICCBased` for a profile).
fn images(doc: &Document) -> Vec<(ObjectId, String)> {
    doc.objects
        .iter()
        .filter_map(|(id, o)| {
            let s = o.as_stream().ok()?;
            (s.dict.get(b"Subtype").ok()?.as_name().ok()? == b"Image").then_some(())?;
            let space = match s.dict.get(b"ColorSpace").ok()? {
                Object::Name(n) => String::from_utf8_lossy(n).into_owned(),
                Object::Array(a) => String::from_utf8_lossy(a[0].as_name().unwrap()).into_owned(),
                _ => return None,
            };
            Some((*id, space))
        })
        .collect()
}

fn first_page(doc: &Document) -> String {
    drawn_content(doc, *doc.get_pages().get(&1).unwrap())
}

#[test]
fn the_default_is_rgb_and_a_sheet_says_nothing_about_it() {
    let opts: FinishOptions = serde_json::from_str("{}").unwrap();
    assert_eq!(opts.colors, ColorMode::Rgb);
    let sheet = OutputSheet::new(
        PageSize {
            width_pt: 100.0,
            height_pt: 100.0,
        },
        Vec::new(),
    );
    assert!(serde_json::to_value(&sheet)
        .unwrap()
        .get("colors")
        .is_none());
    assert_eq!(
        serde_json::to_value(ColorMode::Cmyk).unwrap(),
        serde_json::json!("cmyk")
    );
}

#[test]
fn rgb_sheets_draw_marks_and_colours_in_rgb() {
    let doc = sample_pdf();
    let source = DocumentSource {
        document_id: 0,
        pages: page_sizes(&doc).into_iter().map(|p| p.unwrap()).collect(),
        groups: vec![PageGroup {
            pages: PageRange { first: 0, last: 0 },
            kind: PageGroupKind::grid(sample_grid(0.0)),
        }],
    };
    let out = export_sheets(vec![(0, doc)], &sheets(&source, ColorMode::Rgb)).unwrap();
    let content = first_page(&out);
    assert!(content.contains("1 0 0 rg\n"), "red sheet in RGB");
    assert!(content.contains("0 0 0 RG\n"), "black marks in RGB");
    assert!(!content.contains(" k\n") && !content.contains(" K\n"));
}

#[test]
fn cmyk_sheets_draw_black_marks_on_the_black_ink_only_and_colours_in_cmyk() {
    let doc = sample_pdf();
    let source = DocumentSource {
        document_id: 0,
        pages: page_sizes(&doc).into_iter().map(|p| p.unwrap()).collect(),
        groups: vec![PageGroup {
            pages: PageRange { first: 0, last: 0 },
            kind: PageGroupKind::grid(sample_grid(0.0)),
        }],
    };
    let planned = sheets(&source, ColorMode::Cmyk);
    assert!(planned.iter().all(|s| s.colors == ColorMode::Cmyk));
    let out = export_sheets(vec![(0, doc)], &planned).unwrap();
    let content = first_page(&out);
    assert!(content.contains("0 0 0 1 K\n"), "{content}");
    // Red is magenta and yellow, with next to no cyan.
    let red = content
        .lines()
        .find(|l| l.ends_with(" k"))
        .expect("a CMYK fill");
    let v: Vec<f64> = red
        .split_whitespace()
        .take(4)
        .map(|n| n.parse().unwrap())
        .collect();
    assert!(v[0] < 0.1 && v[1] > 0.7 && v[2] > 0.7, "{red}");
    assert!(
        !content.contains(" rg\n") && !content.contains(" RG\n"),
        "{content}"
    );
}

#[test]
fn a_cmyk_export_turns_the_pictures_of_an_images_document_cmyk() {
    let d = dir("pictures");
    let (doc, source) = images_doc(&d, &[png(&d, "a.png"), jpeg(&d, "b.jpg")]);
    assert!(images(&doc).iter().any(|(_, s)| s == "DeviceRGB"));
    let planned = sheets(&source, ColorMode::Cmyk);
    let out = export_sheets_with_images(vec![(0, doc)], &planned, &BTreeSet::from([0])).unwrap();
    let mut bytes = Vec::new();
    out.clone().save_to(&mut bytes).unwrap();
    let out = Document::load_mem(&bytes).unwrap();

    let found = images(&out);
    // The two pictures, and the PNG's transparency, which stays grey.
    assert_eq!(found.len(), 3, "{found:?}");
    assert_eq!(found.iter().filter(|(_, s)| s == "DeviceCMYK").count(), 2);
    assert_eq!(found.iter().filter(|(_, s)| s == "DeviceGray").count(), 1);
    for (id, space) in &found {
        let s = out.get_object(*id).unwrap().as_stream().unwrap();
        if space != "DeviceCMYK" {
            continue;
        }
        assert_eq!(s.dict.get(b"Width").unwrap().as_i64().unwrap(), 30);
        match s.dict.get(b"Filter").unwrap().as_name().unwrap() {
            b"DCTDecode" => {
                // A JPEG stays a JPEG, written the way Adobe writes CMYK.
                assert!(s.dict.has(b"Decode"));
                let cmyk = image::load_from_memory(&s.content).unwrap();
                assert_eq!(cmyk.width(), 30);
            }
            b"FlateDecode" => {
                assert!(s.dict.has(b"SMask"), "transparency kept");
                let samples = s.decompressed_content().unwrap();
                assert_eq!(samples.len(), 30 * 42 * 4);
            }
            other => panic!("unexpected filter {other:?}"),
        }
    }
}

#[test]
fn an_rgb_export_or_a_source_pdf_keeps_its_pictures_as_they_are() {
    let d = dir("kept");
    let (doc, source) = images_doc(&d, &[png(&d, "a.png")]);
    let before = images(&doc).into_iter().map(|(_, s)| s).collect::<Vec<_>>();
    // RGB sheets, even of an images document.
    let out = export_sheets_with_images(
        vec![(0, doc.clone())],
        &sheets(&source, ColorMode::Rgb),
        &BTreeSet::from([0]),
    )
    .unwrap();
    let after = images(&out).into_iter().map(|(_, s)| s).collect::<Vec<_>>();
    assert_eq!(before.len(), after.len());
    assert!(after.contains(&"DeviceRGB".to_string()));
    // CMYK sheets of a document that is not one of the app's images documents: a source PDF.
    let out = export_sheets(vec![(0, doc)], &sheets(&source, ColorMode::Cmyk)).unwrap();
    assert!(images(&out).iter().any(|(_, s)| s == "DeviceRGB"));
}
