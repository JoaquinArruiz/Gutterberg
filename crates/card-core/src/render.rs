//! Raster previews via pdfium. Used only for the UI; export never touches this.

use crate::error::{Error, Result};
use crate::geometry::PageSize;
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
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
    Pdfium::bind_to_system_library().map(Pdfium::new).map_err(|e| {
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
        .map(|p| PageSize { width_pt: p.width().value as f64, height_pt: p.height().value as f64 })
        .collect::<Vec<_>>();
    Ok(DocumentInfo { page_count: pages.len(), pages })
}

/// Render one page (0-based) as a PNG whose width is `width_px`
/// (height follows the page aspect ratio).
pub fn render_page_png(pdfium: &Pdfium, path: &Path, page_index: usize, width_px: u32) -> Result<Vec<u8>> {
    let doc = pdfium.load_pdf_from_file(path, None).map_err(pdfium_err)?;
    let count = doc.pages().len() as usize;
    let page = doc
        .pages()
        .get(i32::try_from(page_index).map_err(|_| Error::PageOutOfRange(page_index, count))?)
        .map_err(|_| Error::PageOutOfRange(page_index, count))?;
    let cfg = PdfRenderConfig::new().set_target_width(width_px.clamp(16, 8192) as i32);
    let img = page.render_with_config(&cfg).map_err(pdfium_err)?.as_image().map_err(pdfium_err)?;
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|e| Error::Pdfium(e.to_string()))?;
    Ok(out)
}
