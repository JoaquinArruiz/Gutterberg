use crate::state::{internal, AppState};
use card_core::card::DocumentId;
use card_core::geometry::Rect;
use card_core::render_worker::RenderKind;
use card_core::ErrorInfo;
use serde::Deserialize;
use tauri::{ipc::Response, AppHandle, State};

/// Mirrors `RenderKind`; decides supersession and priority on the render thread.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Viewport,
    Magnifier,
    Thumbnail,
    Page,
}

impl From<Kind> for RenderKind {
    fn from(k: Kind) -> Self {
        match k {
            Kind::Viewport => RenderKind::Viewport,
            Kind::Magnifier => RenderKind::Magnifier,
            Kind::Thumbnail => RenderKind::Thumbnail,
            Kind::Page => RenderKind::Page,
        }
    }
}

/// Render a page (0-based) of an open document to a PNG of the given pixel width. Used for both
/// the page base layers and thumbnails.
#[tauri::command]
pub async fn render_page(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: Kind,
    document_id: DocumentId,
    page_index: usize,
    width_px: u32,
) -> Result<Response, ErrorInfo> {
    let worker = state.worker(&app)?;
    let png = tauri::async_runtime::spawn_blocking(move || {
        worker.render_page(kind.into(), document_id, page_index, width_px)
    })
    .await
    .map_err(internal)??;
    Ok(Response::new(png))
}

/// Render only `region` (normalized) of a page, at the scale where the whole
/// page would be `full_width_px` wide. Used by the main view's detail crop and
/// the magnifier.
#[tauri::command]
pub async fn render_region(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: Kind,
    document_id: DocumentId,
    page_index: usize,
    region: Rect,
    full_width_px: u32,
) -> Result<Response, ErrorInfo> {
    if cfg!(debug_assertions) {
        eprintln!("[render] request {kind:?} region of page {page_index} @ {full_width_px}px");
    }
    let worker = state.worker(&app)?;
    let png = tauri::async_runtime::spawn_blocking(move || {
        worker.render_region(kind.into(), document_id, page_index, region, full_width_px)
    })
    .await
    .map_err(internal)??;
    Ok(Response::new(png))
}
