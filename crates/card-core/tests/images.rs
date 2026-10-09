//! Images as pieces: PNG, JPEG and WebP become pages of a PDF, with their pixels kept.
//!
//! The images are tiny and made here, never real card art.
use card_core::card::{CardId, OrientedRect, PageGroup, PageGroupKind, PageRange};
use card_core::export::{export_sheets, page_sizes};
use card_core::finish::{
    finish_sheets, BleedOptions, BleedSource, FinishOptions, Finishing, MarkOptions, MarkStyle,
    SheetWarning,
};
use card_core::geometry::{PageSize, Rect};
use card_core::images::{
    build_images_pdf, images_cache_key, images_document, plan_image, probe_image, Fit, ImageFormat,
    ImageSpec, Placement, Quality,
};
use card_core::layout::GridLayout;
use card_core::sheet::{
    paginate, plan_print_in, Card, DocumentSource, Margins, PaginateOptions, PrintLayout,
    SheetPage, SheetSpec,
};
use card_core::units::mm_to_pt;
use card_core::Error;
use image::{ImageEncoder, Rgb, RgbImage, Rgba, RgbaImage};
use lopdf::{Document, Object};
use std::path::{Path, PathBuf};

fn dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("card-core-images-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn close(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-3, "{a} != {b}");
}

fn jpeg_bytes(w: u32, h: u32) -> Vec<u8> {
    let img = RgbImage::from_fn(w, h, |x, y| Rgb([(x * 9) as u8, (y * 7) as u8, 90]));
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
        .write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgb8)
        .unwrap();
    out
}

/// The JPEG with an EXIF block saying `orientation` (and `dpi`, when given) right after its SOI.
fn with_exif(jpeg: &[u8], orientation: u16, dpi: Option<u32>) -> Vec<u8> {
    let mut tiff = b"MM\0\x2A\0\0\0\x08".to_vec();
    let entries: u16 = if dpi.is_some() { 3 } else { 1 };
    tiff.extend(entries.to_be_bytes());
    // Orientation (SHORT).
    tiff.extend([0x01, 0x12, 0, 3, 0, 0, 0, 1]);
    tiff.extend(orientation.to_be_bytes());
    tiff.extend([0, 0]);
    if dpi.is_some() {
        let data_at = 8 + 2 + 3 * 12 + 4;
        // XResolution (RATIONAL, at `data_at`) and ResolutionUnit (SHORT, 2 = inch).
        tiff.extend([0x01, 0x1A, 0, 5, 0, 0, 0, 1]);
        tiff.extend((data_at as u32).to_be_bytes());
        tiff.extend([0x01, 0x28, 0, 3, 0, 0, 0, 1, 0, 2, 0, 0]);
    }
    tiff.extend([0, 0, 0, 0]); // no next IFD
    if let Some(dpi) = dpi {
        tiff.extend(dpi.to_be_bytes());
        tiff.extend(1u32.to_be_bytes());
    }
    let mut segment = b"Exif\0\0".to_vec();
    segment.extend(tiff);
    let mut out = vec![0xFF, 0xD8, 0xFF, 0xE1];
    out.extend(((segment.len() + 2) as u16).to_be_bytes());
    out.extend(segment);
    out.extend(&jpeg[2..]);
    out
}

fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let p = dir.join(name);
    std::fs::write(&p, bytes).unwrap();
    p
}

fn png_rgba(w: u32, h: u32) -> Vec<u8> {
    let img = RgbaImage::from_fn(w, h, |x, y| Rgba([200, (x * 5) as u8, (y * 3) as u8, 128]));
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new(&mut out)
        .write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgba8)
        .unwrap();
    out
}

fn webp(w: u32, h: u32) -> Vec<u8> {
    let img = RgbImage::from_fn(w, h, |x, y| Rgb([(x * 4) as u8, 20, (y * 4) as u8]));
    let mut out = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut out)
        .write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgb8)
        .unwrap();
    out
}

fn placement(w: f64, h: f64) -> Placement {
    Placement {
        width_mm: w,
        height_mm: h,
        bleed_mm: 0.0,
        fit: Fit::Fit,
        reduce_large: false,
    }
}

fn spec(path: &Path, p: Placement) -> ImageSpec {
    ImageSpec {
        path: path.to_string_lossy().into_owned(),
        hash: probe_image(path).unwrap().hash,
        placement: p,
        missing: false,
    }
}

/// Builds a document of one image and loads it back.
fn build(path: &Path, p: Placement) -> Document {
    let out = path.with_extension("pdf");
    build_images_pdf(&[spec(path, p)], &out).unwrap();
    Document::load(&out).unwrap()
}

fn page_of(doc: &Document, n: usize) -> lopdf::ObjectId {
    *doc.get_pages().get(&(n as u32 + 1)).unwrap()
}

fn media_box(doc: &Document, page: lopdf::ObjectId) -> Vec<f64> {
    let b = doc
        .get_dictionary(page)
        .unwrap()
        .get(b"MediaBox")
        .unwrap()
        .as_array()
        .unwrap();
    b.iter().map(|o| o.as_float().unwrap() as f64).collect()
}

/// The image XObject of a page.
fn image_of(doc: &Document, page: lopdf::ObjectId) -> &lopdf::Stream {
    let (_, id) = doc
        .get_page_resources(page)
        .unwrap()
        .0
        .map(|r| {
            let x = r.get(b"XObject").unwrap().as_dict().unwrap();
            let id = x.get(b"Im0").unwrap().as_reference().unwrap();
            ((), id)
        })
        .unwrap();
    doc.get_object(id).unwrap().as_stream().unwrap()
}

/// The numbers of the page's `cm` operator.
fn cm(doc: &Document, page: lopdf::ObjectId) -> Vec<f64> {
    let text = String::from_utf8(doc.get_page_content(page)).unwrap();
    let before = text.split(" cm").next().unwrap();
    before
        .split_whitespace()
        .rev()
        .take(6)
        .map(|n| n.parse::<f64>().unwrap())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

#[test]
fn a_jpeg_goes_in_byte_for_byte() {
    let d = dir("jpeg");
    let bytes = jpeg_bytes(30, 42);
    let path = write(&d, "card.jpg", &bytes);
    let doc = build(&path, placement(63.0, 88.0));
    let stream = image_of(&doc, page_of(&doc, 0));
    assert_eq!(
        stream.dict.get(b"Filter").unwrap().as_name().unwrap(),
        b"DCTDecode"
    );
    assert_eq!(stream.content, bytes);
    assert_eq!(stream.dict.get(b"Width").unwrap().as_i64().unwrap(), 30);
    assert_eq!(
        stream.dict.get(b"ColorSpace").unwrap().as_name().unwrap(),
        b"DeviceRGB"
    );
}

#[test]
fn a_png_with_transparency_gets_a_soft_mask_and_keeps_its_pixels() {
    let d = dir("png");
    let path = write(&d, "token.png", &png_rgba(20, 28));
    let doc = build(&path, placement(40.0, 56.0));
    let stream = image_of(&doc, page_of(&doc, 0));
    assert_eq!(
        stream.dict.get(b"Filter").unwrap().as_name().unwrap(),
        b"FlateDecode"
    );
    let smask = stream.dict.get(b"SMask").unwrap().as_reference().unwrap();
    let mask = doc.get_object(smask).unwrap().as_stream().unwrap();
    let alpha = mask.decompressed_content().unwrap();
    assert_eq!(alpha.len(), 20 * 28);
    assert!(alpha.iter().all(|a| *a == 128));
    let color = stream.decompressed_content().unwrap();
    assert_eq!(color.len(), 20 * 28 * 3);
    assert_eq!(&color[..3], &[200, 0, 0]);
}

#[test]
fn a_sixteen_bit_png_stays_sixteen_bit() {
    let d = dir("png16");
    let mut samples = Vec::new();
    for i in 0..(8 * 8) {
        samples.extend(((i * 1000) as u16).to_ne_bytes());
    }
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut bytes)
        .write_image(&samples, 8, 8, image::ExtendedColorType::L16)
        .unwrap();
    let path = write(&d, "deep.png", &bytes);
    let doc = build(&path, placement(20.0, 20.0));
    let stream = image_of(&doc, page_of(&doc, 0));
    assert_eq!(
        stream
            .dict
            .get(b"BitsPerComponent")
            .unwrap()
            .as_i64()
            .unwrap(),
        16
    );
    assert_eq!(
        stream.dict.get(b"ColorSpace").unwrap().as_name().unwrap(),
        b"DeviceGray"
    );
    let data = stream.decompressed_content().unwrap();
    assert_eq!(data.len(), 8 * 8 * 2);
    assert_eq!(u16::from_be_bytes([data[2], data[3]]), 1000);
}

#[test]
fn a_webp_is_decoded_and_stored_losslessly() {
    let d = dir("webp");
    let path = write(&d, "art.webp", &webp(16, 24));
    let probe = probe_image(&path).unwrap();
    assert_eq!(probe.format, ImageFormat::Webp);
    assert_eq!((probe.width_px, probe.height_px), (16, 24));
    let doc = build(&path, placement(20.0, 30.0));
    let stream = image_of(&doc, page_of(&doc, 0));
    assert_eq!(
        stream.dict.get(b"Filter").unwrap().as_name().unwrap(),
        b"FlateDecode"
    );
    let data = stream.decompressed_content().unwrap();
    assert_eq!(data.len(), 16 * 24 * 3);
    assert_eq!(&data[..3], &[0, 20, 0]);
}

#[test]
fn exif_orientation_turns_the_placement_not_the_pixels() {
    let d = dir("exif");
    let plain = jpeg_bytes(30, 20);
    let turned = with_exif(&plain, 6, Some(300));
    let path = write(&d, "turned.jpg", &turned);
    let probe = probe_image(&path).unwrap();
    // Stored 30 x 20, shown on its side: 20 x 30.
    assert_eq!((probe.width_px, probe.height_px), (20, 30));
    close(probe.dpi.unwrap(), 300.0);
    close(probe.native_width_mm.unwrap(), 20.0 / 300.0 * 25.4);

    let doc = build(&path, placement(20.0, 30.0));
    let stream = image_of(&doc, page_of(&doc, 0));
    assert_eq!(stream.content, turned, "the bytes are not re-encoded");
    assert_eq!(stream.dict.get(b"Width").unwrap().as_i64().unwrap(), 30);
    let m = cm(&doc, page_of(&doc, 0));
    // A quarter turn: no horizontal or vertical scale terms, only the cross terms.
    close(m[0], 0.0);
    close(m[3], 0.0);
    assert!(m[1] < 0.0 && m[2] > 0.0, "{m:?}");
    // Shown 20 mm wide and 30 mm tall: |c| is the width on the page and |b| the height.
    close(m[2].abs(), mm_to_pt(20.0));
    close(m[1].abs(), mm_to_pt(30.0));
}

#[test]
fn the_page_is_the_chosen_size_with_and_without_bleed() {
    let d = dir("pagesize");
    let path = write(&d, "a.jpg", &jpeg_bytes(63, 88));
    let doc = build(&path, placement(63.0, 88.0));
    let b = media_box(&doc, page_of(&doc, 0));
    close(b[2], mm_to_pt(63.0));
    close(b[3], mm_to_pt(88.0));

    let mut with_bleed = placement(63.0, 88.0);
    with_bleed.bleed_mm = 3.0;
    let doc = build(&path, with_bleed);
    let b = media_box(&doc, page_of(&doc, 0));
    close(b[2], mm_to_pt(69.0));
    close(b[3], mm_to_pt(94.0));

    let plan = plan_image(&probe_image(&path).unwrap(), &with_bleed);
    close(plan.page_width_mm, 69.0);
    // The piece is in the middle of the page.
    close(plan.piece.x, 3.0 / 69.0);
    close(plan.piece.y, 3.0 / 94.0);
    close(plan.piece.width, 63.0 / 69.0);
    close(plan.piece.height, 88.0 / 94.0);
}

#[test]
fn fit_shows_the_whole_image_and_fill_covers_the_page() {
    let d = dir("fit");
    // Twice as wide as tall on a page that is taller than wide.
    let path = write(&d, "wide.jpg", &jpeg_bytes(60, 30));
    let probe = probe_image(&path).unwrap();

    let fit = placement(50.0, 80.0);
    assert!(plan_image(&probe, &fit).proportions_differ);
    let doc = build(&path, fit);
    let page = page_of(&doc, 0);
    let m = cm(&doc, page);
    close(m[0], mm_to_pt(50.0));
    close(m[3], mm_to_pt(25.0));
    // Centred, with blank margins above and below, and no clipping.
    close(m[5], mm_to_pt((80.0 - 25.0) / 2.0));
    let text = String::from_utf8(doc.get_page_content(page)).unwrap();
    assert!(!text.contains(" re W n"));

    let mut fill = placement(50.0, 80.0);
    fill.fit = Fit::Fill;
    let doc = build(&path, fill);
    let page = page_of(&doc, 0);
    let m = cm(&doc, page);
    close(m[3], mm_to_pt(80.0));
    close(m[0], mm_to_pt(160.0));
    close(m[4], mm_to_pt((50.0 - 160.0) / 2.0));
    let text = String::from_utf8(doc.get_page_content(page)).unwrap();
    assert!(
        text.contains("re W n"),
        "what runs past the page is clipped"
    );
}

#[test]
fn an_image_within_one_percent_fills_the_piece_without_a_word() {
    let d = dir("close");
    let path = write(&d, "a.jpg", &jpeg_bytes(100, 140));
    let probe = probe_image(&path).unwrap();
    // 100 / 140 = 0.714; 50 / 70 = 0.714; and 50 x 70.4 is 1% off, but not more.
    assert!(!plan_image(&probe, &placement(50.0, 70.2)).proportions_differ);
    assert!(plan_image(&probe, &placement(50.0, 76.0)).proportions_differ);
    let doc = build(&path, placement(50.0, 70.2));
    let m = cm(&doc, page_of(&doc, 0));
    close(m[0], mm_to_pt(50.0));
    close(m[3], mm_to_pt(70.2));
}

#[test]
fn the_resolution_check_grades_the_print() {
    let d = dir("dpi");
    let path = write(&d, "a.jpg", &jpeg_bytes(100, 140));
    let probe = probe_image(&path).unwrap();
    // 100 px over 50 mm: about 51 dpi.
    let plan = plan_image(&probe, &placement(50.0, 70.0));
    assert!((plan.dpi - 50.8).abs() < 0.1, "{}", plan.dpi);
    assert_eq!(plan.quality, Quality::Blurry);
    // 100 px over 10 mm: 254 dpi.
    assert_eq!(
        plan_image(&probe, &placement(10.0, 14.0)).quality,
        Quality::Soft
    );
    // 100 px over 8 mm: 317 dpi.
    assert_eq!(
        plan_image(&probe, &placement(8.0, 11.2)).quality,
        Quality::Good
    );
    assert!(!plan.very_large);
    assert!(plan_image(&probe, &placement(2.0, 2.8)).very_large);
}

#[test]
fn the_cache_name_follows_the_images_and_how_they_are_placed() {
    let d = dir("key");
    let path = write(&d, "a.jpg", &jpeg_bytes(30, 42));
    let base = spec(&path, placement(63.0, 88.0));
    let key = images_cache_key(std::slice::from_ref(&base));
    assert_eq!(key, images_cache_key(std::slice::from_ref(&base)));

    let mut other = base.clone();
    other.placement.width_mm = 64.0;
    assert_ne!(key, images_cache_key(&[other]));
    let mut other = base.clone();
    other.placement.bleed_mm = 3.0;
    assert_ne!(key, images_cache_key(&[other]));
    let mut other = base.clone();
    other.placement.fit = Fit::Fill;
    assert_ne!(key, images_cache_key(&[other]));
    let mut other = base.clone();
    other.placement.reduce_large = true;
    assert_ne!(key, images_cache_key(&[other]));
    let mut other = base.clone();
    other.hash = "0".repeat(64);
    assert_ne!(key, images_cache_key(&[other]));
}

#[test]
fn the_document_is_built_once_and_found_again() {
    let d = dir("cache");
    let path = write(&d, "a.jpg", &jpeg_bytes(30, 42));
    let specs = [spec(&path, placement(63.0, 88.0))];
    let cache = d.join("cache");
    let first = images_document(&specs, &cache).unwrap();
    assert!(first.starts_with(cache.join("images")));
    let modified = std::fs::metadata(&first).unwrap().modified().unwrap();
    let again = images_document(&specs, &cache).unwrap();
    assert_eq!(first, again);
    assert_eq!(
        std::fs::metadata(&again).unwrap().modified().unwrap(),
        modified
    );
    // Cleared cache: built again from the image.
    std::fs::remove_dir_all(&cache).unwrap();
    assert!(images_document(&specs, &cache).unwrap().is_file());
}

#[test]
fn several_images_are_several_pages_of_one_document() {
    let d = dir("pages");
    let a = write(&d, "a.jpg", &jpeg_bytes(30, 42));
    let b = write(&d, "b.png", &png_rgba(30, 42));
    let c = write(&d, "c.webp", &webp(30, 42));
    let specs: Vec<_> = [&a, &b, &c]
        .iter()
        .map(|p| spec(p, placement(63.0, 88.0)))
        .collect();
    let out = d.join("all.pdf");
    build_images_pdf(&specs, &out).unwrap();
    assert_eq!(Document::load(&out).unwrap().get_pages().len(), 3);
}

#[test]
fn a_large_png_is_reduced_to_600_dpi_only_when_asked() {
    let d = dir("reduce");
    // 600 px over 10 mm is about 1524 dpi.
    let png = {
        // Noise, so that it does not compress to nothing and shrinking it shows.
        let img = RgbImage::from_fn(600, 600, |x, y| {
            let n = x.wrapping_mul(2654435761) ^ y.wrapping_mul(40503);
            Rgb([(n >> 3) as u8, (n >> 11) as u8, (n >> 19) as u8])
        });
        let mut out = Vec::new();
        image::codecs::png::PngEncoder::new(&mut out)
            .write_image(img.as_raw(), 600, 600, image::ExtendedColorType::Rgb8)
            .unwrap();
        out
    };
    let path = write(&d, "big.png", &png);
    let probe = probe_image(&path).unwrap();
    let off = placement(10.0, 10.0);
    let plan = plan_image(&probe, &off);
    assert!(plan.very_large);
    assert_eq!(plan.reduced_to_dpi, None);

    let doc = build(&path, off);
    let full = image_of(&doc, page_of(&doc, 0));
    assert_eq!(full.dict.get(b"Width").unwrap().as_i64().unwrap(), 600);

    let mut on = off;
    on.reduce_large = true;
    let plan_on = plan_image(&probe, &on);
    assert_eq!(plan_on.reduced_to_dpi, Some(600.0));
    assert!(plan_on.stored_bytes < plan.stored_bytes);
    let out = d.join("small.pdf");
    build_images_pdf(&[spec(&path, on)], &out).unwrap();
    let doc = Document::load(&out).unwrap();
    let small = image_of(&doc, page_of(&doc, 0));
    // 10 mm at 600 dpi is 236 px.
    assert_eq!(small.dict.get(b"Width").unwrap().as_i64().unwrap(), 236);
    // The piece is the same size.
    let b = media_box(&doc, page_of(&doc, 0));
    close(b[2], mm_to_pt(10.0));
    assert!(
        std::fs::metadata(&out).unwrap().len()
            < std::fs::metadata(path.with_extension("pdf")).unwrap().len()
    );

    // A small PNG is left alone with the switch on.
    let small_png = write(&d, "small.png", &png_rgba(20, 20));
    let mut on = placement(40.0, 40.0);
    on.reduce_large = true;
    let doc = build(&small_png, on);
    assert_eq!(
        image_of(&doc, page_of(&doc, 0))
            .dict
            .get(b"Width")
            .unwrap()
            .as_i64()
            .unwrap(),
        20
    );
}

#[test]
fn a_jpeg_is_never_reduced() {
    let d = dir("jpegreduce");
    let bytes = jpeg_bytes(600, 600);
    let path = write(&d, "big.jpg", &bytes);
    let mut p = placement(10.0, 10.0);
    p.reduce_large = true;
    let plan = plan_image(&probe_image(&path).unwrap(), &p);
    assert!(plan.very_large);
    assert_eq!(plan.reduced_to_dpi, None);
    assert_eq!(plan.stored_bytes, bytes.len() as u64);
    let doc = build(&path, p);
    assert_eq!(image_of(&doc, page_of(&doc, 0)).content, bytes);
}

#[test]
fn other_formats_are_refused_with_the_file_named() {
    let d = dir("refuse");
    for name in [
        "photo.heic",
        "photo.avif",
        "scan.tiff",
        "logo.svg",
        "anim.gif",
    ] {
        let p = write(&d, name, b"not an image");
        match probe_image(&p) {
            Err(Error::ImageUnsupported { name: n }) => assert_eq!(n, name),
            other => panic!("{name}: {other:?}"),
        }
    }
    // A PNG named .jpg is not a JPEG.
    let p = write(&d, "liar.jpg", &png_rgba(4, 4));
    assert!(matches!(
        probe_image(&p),
        Err(Error::ImageUnsupported { .. })
    ));
    // A damaged file of a known format is unreadable, not unsupported.
    let p = write(&d, "cut.png", &png_rgba(4, 4)[..20]);
    assert!(matches!(
        probe_image(&p),
        Err(Error::ImageUnreadable { .. })
    ));
}

#[test]
fn an_image_over_the_limits_is_refused() {
    let d = dir("limits");
    // A header that claims 20000 x 10000 pixels (200 megapixels); no pixels are needed to be refused.
    let mut png = png_rgba(4, 4);
    png[16..20].copy_from_slice(&20000u32.to_be_bytes());
    png[20..24].copy_from_slice(&10000u32.to_be_bytes());
    // Fix the IHDR checksum.
    let crc = {
        let mut crc = 0xFFFF_FFFFu32;
        for b in &png[12..29] {
            crc ^= u32::from(*b);
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    };
    png[29..33].copy_from_slice(&crc.to_be_bytes());
    let p = write(&d, "huge.png", &png);
    match probe_image(&p) {
        Err(Error::ImageTooLarge {
            name, megapixels, ..
        }) => {
            assert_eq!(name, "huge.png");
            close(megapixels, 200.0);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn errors_reach_the_ui_as_codes() {
    let v = serde_json::to_value(Error::ImageUnsupported {
        name: "a.heic".into(),
    })
    .unwrap();
    assert_eq!(v["code"], "image_unsupported");
    assert_eq!(v["name"], "a.heic");
    let v = serde_json::to_value(Error::ImageTooLarge {
        name: "a.png".into(),
        megapixels: 120.0,
        mb: 10.0,
    })
    .unwrap();
    assert_eq!(v["code"], "image_too_large");
    assert_eq!(v["megapixels"].as_f64(), Some(120.0));
}

/// The same image printed 50 times is stored once: each source page is one form, drawn 50 times.
#[test]
fn an_image_printed_fifty_times_is_stored_once() {
    let d = dir("fifty");
    let path = write(&d, "a.png", &png_rgba(40, 56));
    let spec = spec(&path, placement(63.0, 88.0));
    let out = d.join("one.pdf");
    build_images_pdf(&[spec], &out).unwrap();
    let source = Document::load(&out).unwrap();

    let id = CardId::Grid {
        document_id: 0,
        page_index: 0,
        row: 0,
        column: 0,
    };
    let rect = Rect::new(0.0, 0.0, mm_to_pt(63.0), mm_to_pt(88.0));
    let card = Card::new(id, OrientedRect::from_rect(rect));
    let sheet = SheetSpec {
        page: SheetPage::Size(PageSize {
            width_pt: 595.2756,
            height_pt: 841.8898,
        }),
        rows: None,
        columns: None,
        gap_x_mm: 0.0,
        gap_y_mm: 0.0,
        margins: Margins::default(),
    };
    let sheets = paginate(&[(card, 50)], &sheet, &PaginateOptions::default()).unwrap();
    assert_eq!(sheets.len(), 6, "9 to a sheet");

    let result = export_sheets(vec![(0, source)], &sheets).unwrap();
    let mut bytes = Vec::new();
    result.clone().save_to(&mut bytes).unwrap();
    let reloaded = Document::load_mem(&bytes).unwrap();
    let images = reloaded
        .objects
        .values()
        .filter(|o| match o {
            Object::Stream(s) => {
                s.dict.get(b"Subtype").and_then(|v| v.as_name()).ok() == Some(b"Image")
            }
            _ => false,
        })
        .count();
    // The picture and its soft mask, once each.
    assert_eq!(images, 2);
    assert_eq!(reloaded.get_pages().len(), 6);
}

#[test]
fn a_missing_image_keeps_its_page_blank() {
    let d = dir("missing");
    let present = write(&d, "a.jpg", &jpeg_bytes(30, 42));
    let gone = ImageSpec {
        path: d.join("gone.jpg").to_string_lossy().into_owned(),
        hash: "f".repeat(64),
        placement: placement(63.0, 88.0),
        missing: true,
    };
    let specs = [spec(&present, placement(63.0, 88.0)), gone.clone()];
    let out = d.join("both.pdf");
    build_images_pdf(&specs, &out).unwrap();
    let doc = Document::load(&out).unwrap();
    assert_eq!(doc.get_pages().len(), 2);
    let b = media_box(&doc, page_of(&doc, 1));
    close(b[2], mm_to_pt(63.0));
    close(b[3], mm_to_pt(88.0));
    assert!(doc
        .get_page_content(page_of(&doc, 1))
        .iter()
        .all(|b| b.is_ascii_whitespace()));
    // Being missing is part of the cache name: finding the image again builds the page again.
    let mut found = gone.clone();
    found.missing = false;
    assert_ne!(images_cache_key(&[gone]), images_cache_key(&[found]));
}

/// The project's side of an images document: one 1 x 1 grid over the piece, on every page.
fn image_source(doc: &Document, spec: &ImageSpec, count: usize) -> DocumentSource {
    let plan = plan_image(
        &probe_image(Path::new(&spec.path)).unwrap(),
        &spec.placement,
    );
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
    DocumentSource {
        document_id: 0,
        pages: page_sizes(doc).into_iter().map(|p| p.unwrap()).collect(),
        groups: vec![PageGroup {
            pages: PageRange {
                first: 0,
                last: count - 1,
            },
            kind: PageGroupKind::Grid { grid },
        }],
    }
}

fn a4_three_by_three() -> SheetSpec {
    SheetSpec {
        page: SheetPage::Size(PageSize {
            width_pt: mm_to_pt(210.0),
            height_pt: mm_to_pt(297.0),
        }),
        rows: Some(3),
        columns: Some(3),
        gap_x_mm: 0.0,
        gap_y_mm: 0.0,
        margins: Margins::default(),
    }
}

fn nine_images(name: &str, bleed_mm: f64) -> (Document, DocumentSource, Vec<ImageSpec>) {
    let d = dir(name);
    let mut p = placement(63.0, 88.0);
    p.bleed_mm = bleed_mm;
    let specs: Vec<ImageSpec> = (0..9)
        .map(|n| {
            let path = write(&d, &format!("card{n}.jpg"), &jpeg_bytes(63 + n, 88));
            spec(&path, p)
        })
        .collect();
    let out = d.join("nine.pdf");
    build_images_pdf(&specs, &out).unwrap();
    let doc = Document::load(&out).unwrap();
    let source = image_source(&doc, &specs[0], 9);
    (doc, source, specs)
}

#[test]
fn nine_jpegs_print_on_one_a4_sheet_in_a_three_by_three_grid_at_true_size_with_cut_marks() {
    let (doc, source, _) = nine_images("nine", 0.0);
    let sheets = plan_print_in(
        std::slice::from_ref(&source),
        &[],
        &PrintLayout::Grid {
            spec: a4_three_by_three(),
        },
        &PaginateOptions::default(),
    )
    .unwrap();
    assert_eq!(sheets.len(), 1);
    assert_eq!(sheets[0].placements.len(), 9, "nine pieces");
    for p in &sheets[0].placements {
        close(p.destination.width, mm_to_pt(63.0));
        close(p.destination.height, mm_to_pt(88.0));
    }
    let finishing = Finishing {
        options: FinishOptions {
            marks: MarkOptions {
                style: MarkStyle::Ticks,
                ..MarkOptions::default()
            },
            ..FinishOptions::default()
        },
        backs: Vec::new(),
    };
    let (sheets, issues) =
        finish_sheets(sheets, std::slice::from_ref(&source), &finishing).unwrap();
    assert!(issues.is_empty());
    assert!(sheets[0].marks.is_some(), "cut marks");
    let out = export_sheets(vec![(0, doc)], &sheets).unwrap();
    assert_eq!(out.get_pages().len(), 1);
}

#[test]
fn an_image_with_bleed_works_with_bleed_from_the_source() {
    let (doc, source, _) = nine_images("bleed", 3.0);
    // The page is the piece and 3 mm all round; the piece is the middle.
    let b = media_box(&doc, page_of(&doc, 0));
    close(b[2], mm_to_pt(69.0));
    let sheets = plan_print_in(
        std::slice::from_ref(&source),
        &[],
        &PrintLayout::Grid {
            spec: a4_three_by_three(),
        },
        &PaginateOptions::default(),
    )
    .unwrap();
    for p in &sheets[0].placements {
        close(p.destination.width, mm_to_pt(63.0));
    }
    let finishing = Finishing {
        options: FinishOptions {
            bleed: BleedOptions {
                mm: 3.0,
                source: BleedSource::Source,
            },
            ..FinishOptions::default()
        },
        backs: Vec::new(),
    };
    // Nothing is in the way of the bleed: it is the image's own, so no warning and no error.
    let (sheets, issues) =
        finish_sheets(sheets, std::slice::from_ref(&source), &finishing).unwrap();
    assert!(issues.is_empty(), "{issues:?}");
    assert!(sheets
        .iter()
        .all(|s| !s.warnings.contains(&SheetWarning::BleedExceedsSourceGap)));
    assert_eq!(
        export_sheets(vec![(0, doc)], &sheets)
            .unwrap()
            .get_pages()
            .len(),
        1
    );
}
