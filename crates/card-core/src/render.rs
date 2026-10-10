//! Raster previews via pdfium. Used only for the UI; export never touches this.

use crate::access::PdfAccess;
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
    /// What the PDF's publisher allows (see `access`).
    pub access: PdfAccess,
    /// Why the export will refuse this PDF (`printing` or `modifying`), if it will.
    pub locked: Option<String>,
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
    // pdfium binds once per process; later calls (parallel tests, a second window) share it.
    let shared = || Pdfium::default();
    for d in &dirs {
        match Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(d)) {
            Ok(b) => return Ok(Pdfium::new(b)),
            Err(PdfiumError::PdfiumLibraryBindingsAlreadyInitialized) => return Ok(shared()),
            Err(_) => {}
        }
    }
    match Pdfium::bind_to_system_library() {
        Ok(b) => Ok(Pdfium::new(b)),
        Err(PdfiumError::PdfiumLibraryBindingsAlreadyInitialized) => Ok(shared()),
        Err(e) => Err(e),
    }
    .map_err(|e| {
        Error::Pdfium(format!(
            "could not load the pdfium library (searched {dirs:?} and the system): {e}. \
             Run scripts/fetch-pdfium.sh or set PDFIUM_LIB_PATH."
        ))
    })
}

pub fn document_info(pdfium: &Pdfium, path: &Path) -> Result<DocumentInfo> {
    let doc = pdfium.load_pdf_from_file(path, None).map_err(pdfium_err)?;
    document_info_in(&doc, path)
}

/// Like [`document_info`] on an already-loaded document (no re-parse). `path` is the file it was loaded from, read
/// again only for the permissions of a PDF whose encryption pdfium-render cannot interpret.
pub fn document_info_in(doc: &PdfDocument, path: &Path) -> Result<DocumentInfo> {
    let pages = doc
        .pages()
        .iter()
        .map(|p| PageSize {
            width_pt: p.width().value as f64,
            height_pt: p.height().value as f64,
        })
        .collect::<Vec<_>>();
    let access = access_in(doc).unwrap_or_else(|| access_from_file(path));
    Ok(DocumentInfo {
        page_count: pages.len(),
        pages,
        locked: access.refusal().map(str::to_owned),
        access,
    })
}

/// The publisher's permissions as pdfium reads them, for the badge. A flag pdfium cannot tell counts as allowed.
/// Printing and modifying (what decides a refusal) are the same bits `access::access_of` reads from the file; for
/// the others pdfium looks at the accessibility copy flag on newer PDFs, so the export is what applies them exactly.
///
/// `None` when pdfium-render does not know the file's security handler: it only knows revisions 2 to 4, so an
/// AES-256 PDF (revision 5 or 6, what current tools write) would otherwise read as having no restrictions at all.
fn access_in(doc: &PdfDocument) -> Option<PdfAccess> {
    let p = doc.permissions();
    p.security_handler_revision().ok()?;
    let yes = |r: std::result::Result<bool, PdfiumError>| r.unwrap_or(true);
    let high = yes(p.can_print_high_quality());
    let low = yes(p.can_print_only_low_quality());
    Some(PdfAccess {
        print: high || low,
        modify: yes(p.can_modify_document_content()),
        other_restricted: !(high
            && yes(p.can_extract_text_and_graphics())
            && yes(p.can_assemble_document())
            && yes(p.can_fill_existing_interactive_form_fields())
            && yes(p.can_add_or_modify_text_annotations())),
    })
}

/// The permissions as the export reads them (lopdf), for a PDF pdfium-render cannot interpret. A file lopdf cannot
/// read counts as unrestricted here: the export reads it the same way and stops with its own error.
fn access_from_file(path: &Path) -> PdfAccess {
    lopdf::Document::load(path)
        .map(|d| crate::access::access_of(&d))
        .unwrap_or_default()
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

pub(crate) fn get_page<'a>(doc: &PdfDocument<'a>, page_index: usize) -> Result<PdfPage<'a>> {
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

/// A page as a PNG with the size it came out at.
#[derive(Debug, Clone)]
pub struct RenderedPage {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Render a page so its longer side is `long_side_px`, shrinking it until the PNG is at most
/// `max_bytes` (a provider's limit on one picture).
pub fn render_page_fit_in(
    doc: &PdfDocument,
    page_index: usize,
    long_side_px: u32,
    max_bytes: usize,
) -> Result<RenderedPage> {
    let page = get_page(doc, page_index)?;
    let (w, h) = (page.width().value as f64, page.height().value as f64);
    let mut long = long_side_px.clamp(64, 4096) as f64;
    for _ in 0..6 {
        let k = long / w.max(h);
        let (tw, th) = (
            (w * k).round().max(1.0) as i32,
            (h * k).round().max(1.0) as i32,
        );
        let cfg = PdfRenderConfig::new().set_target_size(tw, th);
        let img = page
            .render_with_config(&cfg)
            .map_err(pdfium_err)?
            .as_image()
            .map_err(pdfium_err)?;
        let png = encode_png(&img)?;
        if png.len() <= max_bytes {
            return Ok(RenderedPage {
                png,
                width: img.width(),
                height: img.height(),
            });
        }
        long *= 0.8;
    }
    Err(Error::Pdfium(format!(
        "page {} is too detailed to send within {} bytes",
        page_index + 1,
        max_bytes
    )))
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
