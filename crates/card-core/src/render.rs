//! Raster previews via pdfium. Used only for the UI; export never touches this.

use crate::error::{Error, Result};
use crate::geometry::PageSize;
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentInfo {
    pub page_count: usize,
    /// Size in points of every page, in order.
    pub pages: Vec<PageSize>,
}

fn pdfium_err(e: PdfiumError) -> Error {
    Error::Pdfium(e.to_string())
}

/// Bind to the pdfium shared library. Search order: `lib_dirs` (in order), the
/// `PDFIUM_LIB_PATH` env var, the executable's directory, then the system.
pub fn bind_pdfium(lib_dirs: &[std::path::PathBuf]) -> Result<Pdfium> {
    let mut dirs: Vec<std::path::PathBuf> = lib_dirs.to_vec();
    if let Ok(d) = std::env::var("PDFIUM_LIB_PATH") {
        dirs.push(d.into());
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            dirs.push(d.to_path_buf());
        }
    }
    for d in &dirs {
        if let Ok(b) = Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(d)) {
            return Ok(Pdfium::new(b));
        }
    }
    Pdfium::bind_to_system_library()
        .map(Pdfium::new)
        .map_err(|e| {
            Error::Pdfium(format!(
                "could not load the pdfium library (searched {dirs:?} and the system): {e}. \
             Run scripts/fetch-pdfium.sh or set PDFIUM_LIB_PATH."
            ))
        })
}

pub fn document_info(pdfium: &Pdfium, path: &Path) -> Result<DocumentInfo> {
    let doc = pdfium.load_pdf_from_file(path, None).map_err(pdfium_err)?;
    let pages = doc
        .pages()
        .iter()
        .map(|p| PageSize {
            width_pt: p.width().value as f64,
            height_pt: p.height().value as f64,
        })
        .collect::<Vec<_>>();
    Ok(DocumentInfo {
        page_count: pages.len(),
        pages,
    })
}

/// Encode quickly: these PNGs are transient UI previews, so favour speed over size.
fn encode_png(img: &image::DynamicImage) -> Result<Vec<u8>> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use image::ImageEncoder;
    let rgba = img.to_rgba8();
    let mut out = Vec::new();
    PngEncoder::new_with_quality(&mut out, CompressionType::Fast, FilterType::NoFilter)
        .write_image(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| Error::Pdfium(e.to_string()))?;
    Ok(out)
}

/// Debug builds print where render time goes (draw vs encode).
fn log_timing(what: &str, draw: std::time::Duration, encode: std::time::Duration, bytes: usize) {
    if cfg!(debug_assertions) {
        eprintln!(
            "[render] {what}: draw {draw:?}, encode {encode:?}, {} KiB",
            bytes / 1024
        );
    }
}

fn get_page<'a>(doc: &PdfDocument<'a>, page_index: usize) -> Result<PdfPage<'a>> {
    let count = doc.pages().len() as usize;
    doc.pages()
        .get(i32::try_from(page_index).map_err(|_| Error::PageOutOfRange(page_index, count))?)
        .map_err(|_| Error::PageOutOfRange(page_index, count))
}

/// Render one page (0-based) as a PNG whose width is `width_px`
/// (height follows the page aspect ratio).
pub fn render_page_png(
    pdfium: &Pdfium,
    path: &Path,
    page_index: usize,
    width_px: u32,
) -> Result<Vec<u8>> {
    let doc = pdfium.load_pdf_from_file(path, None).map_err(pdfium_err)?;
    render_page_png_in(&doc, page_index, width_px)
}

/// Like [`render_page_png`] on an already-loaded document (no re-parse).
pub fn render_page_png_in(doc: &PdfDocument, page_index: usize, width_px: u32) -> Result<Vec<u8>> {
    let page = get_page(doc, page_index)?;
    let t = std::time::Instant::now();
    let cfg = PdfRenderConfig::new().set_target_width(width_px.clamp(16, 8192) as i32);
    let img = page
        .render_with_config(&cfg)
        .map_err(pdfium_err)?
        .as_image()
        .map_err(pdfium_err)?;
    let draw = t.elapsed();
    let t = std::time::Instant::now();
    let out = encode_png(&img)?;
    log_timing(
        &format!("page {page_index} @ {width_px}px"),
        draw,
        t.elapsed(),
        out.len(),
    );
    Ok(out)
}

/// Render only `region` (normalized, top-left origin) of a page as a PNG, at the
/// scale where the whole page would be `full_width_px` wide. Only the region's
/// pixels are allocated and encoded, so a high zoom stays fast (used by the
/// magnifier).
pub fn render_region_png(
    pdfium: &Pdfium,
    path: &Path,
    page_index: usize,
    region: crate::geometry::Rect,
    full_width_px: u32,
) -> Result<Vec<u8>> {
    let doc = pdfium.load_pdf_from_file(path, None).map_err(pdfium_err)?;
    render_region_png_in(&doc, page_index, region, full_width_px)
}

/// Like [`render_region_png`] on an already-loaded document (no re-parse).
pub fn render_region_png_in(
    doc: &PdfDocument,
    page_index: usize,
    region: crate::geometry::Rect,
    full_width_px: u32,
) -> Result<Vec<u8>> {
    let page = get_page(doc, page_index)?;

    let full_w = full_width_px.clamp(16, 32768) as f64;
    let full_h = full_w * page.height().value as f64 / page.width().value as f64;
    let x0 = (region.x.clamp(0.0, 1.0) * full_w).floor();
    let y0 = (region.y.clamp(0.0, 1.0) * full_h).floor();
    let x1 = ((region.x + region.width).clamp(0.0, 1.0) * full_w).ceil();
    let y1 = ((region.y + region.height).clamp(0.0, 1.0) * full_h).ceil();
    let (w, h) = (
        (x1 - x0).clamp(1.0, 4096.0) as i32,
        (y1 - y0).clamp(1.0, 4096.0) as i32,
    );

    let t = std::time::Instant::now();
    let mut bitmap = PdfBitmap::empty(w, h, PdfBitmapFormat::BGRA).map_err(pdfium_err)?;
    let cfg = PdfRenderConfig::new()
        .set_target_size(full_w.round() as i32, full_h.round() as i32)
        .set_origin(-(x0 as i32), -(y0 as i32));
    page.render_into_bitmap_with_config(&mut bitmap, &cfg)
        .map_err(pdfium_err)?;
    let img = bitmap.as_image().map_err(pdfium_err)?;
    let draw = t.elapsed();
    let t = std::time::Instant::now();
    let out = encode_png(&img)?;
    log_timing(
        &format!("region {w}x{h} of page {page_index}"),
        draw,
        t.elapsed(),
        out.len(),
    );
    Ok(out)
}
