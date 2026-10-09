//! Images as pieces, drawn by pdfium: what the user sees on the page. Needs the pdfium shared
//! library; skipped (with a note) when unavailable.
use card_core::images::{build_images_pdf, probe_image, Fit, ImageSpec, Placement};
use card_core::render::{bind_pdfium, render_page_png};
use image::{ImageEncoder, Rgb, RgbImage};
use std::path::{Path, PathBuf};

fn dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "card-core-images-render-{}-{name}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// A 60 x 40 JPEG, blue with a red block at its top left.
fn red_corner_jpeg(dir: &Path, name: &str, orientation: Option<u8>) -> PathBuf {
    let img = RgbImage::from_fn(60, 40, |x, y| {
        if x < 20 && y < 16 {
            Rgb([255, 0, 0])
        } else {
            Rgb([0, 0, 255])
        }
    });
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95)
        .write_image(img.as_raw(), 60, 40, image::ExtendedColorType::Rgb8)
        .unwrap();
    if let Some(o) = orientation {
        let mut tiff = b"MM\0\x2A\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01".to_vec();
        tiff.extend([0, o, 0, 0, 0, 0, 0, 0]);
        let mut segment = b"Exif\0\0".to_vec();
        segment.extend(tiff);
        let mut out = vec![0xFF, 0xD8, 0xFF, 0xE1];
        out.extend(((segment.len() + 2) as u16).to_be_bytes());
        out.extend(segment);
        out.extend(&jpeg[2..]);
        jpeg = out;
    }
    let path = dir.join(name);
    std::fs::write(&path, jpeg).unwrap();
    path
}

fn render(path: &Path, p: Placement) -> Option<image::RgbImage> {
    let pdfium = match bind_pdfium(&[]) {
        Ok(p) => p,
        Err(e) => {
            assert!(
                std::env::var_os("CI").is_none(),
                "pdfium not available in CI: {e}"
            );
            eprintln!("SKIPPED: pdfium not available (set PDFIUM_LIB_PATH)");
            return None;
        }
    };
    let out = path.with_extension("pdf");
    let spec = ImageSpec {
        path: path.to_string_lossy().into_owned(),
        hash: probe_image(path).unwrap().hash,
        placement: p,
        missing: false,
    };
    build_images_pdf(&[spec], &out).unwrap();
    let png = render_page_png(&pdfium, &out, 0, 300).unwrap();
    Some(image::load_from_memory(&png).unwrap().to_rgb8())
}

fn placement(w: f64, h: f64, fit: Fit) -> Placement {
    Placement {
        width_mm: w,
        height_mm: h,
        bleed_mm: 0.0,
        fit,
        reduce_large: false,
    }
}

fn is_red(p: &Rgb<u8>) -> bool {
    p[0] > 200 && p[1] < 60 && p[2] < 60
}
fn is_blue(p: &Rgb<u8>) -> bool {
    p[2] > 200 && p[0] < 60 && p[1] < 60
}
fn is_white(p: &Rgb<u8>) -> bool {
    p.0.iter().all(|c| *c > 240)
}

#[test]
fn an_image_is_drawn_upright_and_filling_its_page() {
    let d = dir("upright");
    let path = red_corner_jpeg(&d, "a.jpg", None);
    let Some(img) = render(&path, placement(60.0, 40.0, Fit::Fit)) else {
        return;
    };
    let (w, h) = img.dimensions();
    assert!(is_red(img.get_pixel(8, 8)), "red block at the top left");
    assert!(is_blue(img.get_pixel(w - 8, 8)));
    assert!(is_blue(img.get_pixel(8, h - 8)));
    assert!(is_blue(img.get_pixel(w - 8, h - 8)));
}

#[test]
fn exif_orientation_six_shows_the_image_turned_a_quarter_clockwise() {
    let d = dir("turned");
    let path = red_corner_jpeg(&d, "t.jpg", Some(6));
    // Stored 60 x 40, shown 40 x 60.
    let Some(img) = render(&path, placement(40.0, 60.0, Fit::Fit)) else {
        return;
    };
    let (w, h) = img.dimensions();
    assert!(h > w);
    // The stored top-left corner is now at the top right.
    assert!(
        is_red(img.get_pixel(w - 8, 8)),
        "{:?}",
        img.get_pixel(w - 8, 8)
    );
    assert!(is_blue(img.get_pixel(8, 8)));
    assert!(is_blue(img.get_pixel(8, h - 8)));
}

#[test]
fn fit_leaves_blank_margins_and_fill_cuts_the_edges() {
    let d = dir("fitfill");
    let path = red_corner_jpeg(&d, "f.jpg", None);
    // A 60 x 40 image on a 40 x 40 page.
    let Some(fit) = render(&path, placement(40.0, 40.0, Fit::Fit)) else {
        return;
    };
    let (w, h) = fit.dimensions();
    assert!(is_white(fit.get_pixel(w / 2, 4)), "blank above the image");
    assert!(is_white(fit.get_pixel(w / 2, h - 4)), "blank below it");
    assert!(is_blue(fit.get_pixel(w / 2, h / 2)));

    let fill = render(&path, placement(40.0, 40.0, Fit::Fill)).unwrap();
    let (w, h) = fill.dimensions();
    assert!(is_blue(fill.get_pixel(w / 2, 4)), "no blank margin");
    assert!(is_blue(fill.get_pixel(w / 2, h - 4)));
    // The page shows the middle 40 of the image's 60 columns, so only the right half of the red block
    // (columns 10..20) is left, against the left edge.
    assert!(is_red(fill.get_pixel(4, 4)), "{:?}", fill.get_pixel(4, 4));
}
