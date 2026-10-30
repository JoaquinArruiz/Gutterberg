//! CMYK export, drawn by pdfium: the converted pictures still look like themselves. Needs the pdfium shared
//! library; skipped (with a note) when unavailable.
use card_core::card::{PageGroup, PageGroupKind, PageRange};
use card_core::cmyk::ColorMode;
use card_core::export::{export_sheets_with_images, page_sizes};
use card_core::finish::{plan_and_finish, FinishOptions, Finishing};
use card_core::geometry::PageSize;
use card_core::images::{build_images_pdf, plan_image, probe_image, Fit, ImageSpec, Placement};
use card_core::layout::GridLayout;
use card_core::render::{bind_pdfium, render_page_png};
use card_core::sheet::{
    DocumentSource, Margins, PaginateOptions, PrintLayout, SheetPage, SheetSpec,
};
use card_core::units::mm_to_pt;
use image::{ImageEncoder, Rgb, RgbImage};
use lopdf::Document;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

/// Width of the rendered sheet, in pixels.
const WIDTH_PX: u32 = 600;

fn dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "card-core-cmyk-render-{}-{name}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// A plain picture of `color`, as a PNG or a JPEG.
fn picture(dir: &Path, name: &str, color: [u8; 3]) -> PathBuf {
    let img = RgbImage::from_pixel(40, 56, Rgb(color));
    let mut out = Vec::new();
    if name.ends_with(".png") {
        image::codecs::png::PngEncoder::new(&mut out)
            .write_image(img.as_raw(), 40, 56, image::ExtendedColorType::Rgb8)
            .unwrap();
    } else {
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 95)
            .write_image(img.as_raw(), 40, 56, image::ExtendedColorType::Rgb8)
            .unwrap();
    }
    let p = dir.join(name);
    std::fs::write(&p, out).unwrap();
    p
}

#[test]
fn cmyk_pictures_keep_their_colour() {
    let pdfium = match bind_pdfium(&[]) {
        Ok(p) => p,
        Err(e) => {
            assert!(
                std::env::var_os("CI").is_none(),
                "pdfium not available in CI: {e}"
            );
            eprintln!("SKIPPED: pdfium not available (set PDFIUM_LIB_PATH)");
            return;
        }
    };
    let d = dir("colour");
    let paths = [
        picture(&d, "red.png", [220, 30, 30]),
        picture(&d, "blue.jpg", [30, 60, 200]),
    ];
    let specs: Vec<ImageSpec> = paths
        .iter()
        .map(|p| ImageSpec {
            path: p.to_string_lossy().into_owned(),
            hash: probe_image(p).unwrap().hash,
            placement: Placement {
                width_mm: 63.0,
                height_mm: 88.0,
                bleed_mm: 0.0,
                fit: Fit::Fill,
                reduce_large: false,
            },
            missing: false,
        })
        .collect();
    let source_path = d.join("images.pdf");
    build_images_pdf(&specs, &source_path).unwrap();
    let doc = Document::load(&source_path).unwrap();
    let plan = plan_image(&probe_image(&paths[0]).unwrap(), &specs[0].placement);
    let source = DocumentSource {
        document_id: 0,
        pages: page_sizes(&doc).into_iter().map(|p| p.unwrap()).collect(),
        groups: vec![PageGroup {
            pages: PageRange { first: 0, last: 1 },
            kind: PageGroupKind::grid(GridLayout {
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
            }),
        }],
    };
    let page = PageSize {
        width_pt: mm_to_pt(210.0),
        height_pt: mm_to_pt(297.0),
    };
    let (sheets, _) = plan_and_finish(
        std::slice::from_ref(&source),
        &[],
        &PrintLayout::Grid {
            spec: SheetSpec {
                page: SheetPage::Size(page),
                rows: None,
                columns: None,
                gap_x_mm: 2.0,
                gap_y_mm: 2.0,
                margins: Margins::default(),
            },
        },
        &PaginateOptions::default(),
        &Finishing {
            options: FinishOptions {
                colors: ColorMode::Cmyk,
                ..FinishOptions::default()
            },
            ..Finishing::default()
        },
    )
    .unwrap();
    let centres: Vec<(f64, f64)> = sheets[0]
        .placements
        .iter()
        .map(|p| {
            (
                p.destination.x + p.destination.width / 2.0,
                p.destination.y + p.destination.height / 2.0,
            )
        })
        .collect();
    let mut out = export_sheets_with_images(vec![(0, doc)], &sheets, &BTreeSet::from([0])).unwrap();
    let out_path = d.join("sheets.pdf");
    out.save(&out_path).unwrap();

    let png = render_page_png(&pdfium, &out_path, 0, WIDTH_PX).unwrap();
    let img = image::load_from_memory(&png).unwrap().to_rgb8();
    let k = img.width() as f64 / page.width_pt;
    let at = |(x, y): (f64, f64)| *img.get_pixel((x * k) as u32, (y * k) as u32);
    let red = at(centres[0]);
    let blue = at(centres[1]);
    // Printing inks cannot reach every screen colour, but red stays red and blue stays blue.
    assert!(red[0] > 150 && red[1] < 90 && red[2] < 90, "{red:?}");
    assert!(blue[2] > 120 && blue[0] < 90 && blue[1] < 120, "{blue:?}");
}
