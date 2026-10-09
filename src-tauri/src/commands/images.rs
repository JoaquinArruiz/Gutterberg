use crate::state::internal;
use card_core::images::{
    images_document, plan_image, probe_image, ImagePlan, ImageProbe, ImageSpec, Placement,
};
use card_core::ErrorInfo;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// One file of an import: what is known about it, or why it cannot be used.
#[derive(Serialize)]
pub struct ProbeOutcome {
    path: String,
    probe: Option<ImageProbe>,
    error: Option<ErrorInfo>,
}

/// Check each file (format, size limits) and read what its header says. A file that cannot be used
/// is reported on its own, so the rest of the import goes on.
#[tauri::command]
pub async fn probe_images(paths: Vec<String>) -> Result<Vec<ProbeOutcome>, ErrorInfo> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| match probe_image(&PathBuf::from(&path)) {
                Ok(probe) => ProbeOutcome {
                    path,
                    probe: Some(probe),
                    error: None,
                },
                Err(e) => ProbeOutcome {
                    path,
                    probe: None,
                    error: Some(e.into()),
                },
            })
            .collect()
    })
    .await
    .map_err(internal)
}

#[derive(Deserialize)]
pub struct PlanRequest {
    probe: ImageProbe,
    placement: Placement,
}

/// What each placement does to its image: page, piece, resolution and size in the export.
#[tauri::command]
pub fn plan_images(requests: Vec<PlanRequest>) -> Vec<ImagePlan> {
    requests
        .iter()
        .map(|r| plan_image(&r.probe, &r.placement))
        .collect()
}

/// The PDF made of these images, from the app's cache (built if it is not there). Its path is then
/// opened like any other PDF.
#[tauri::command]
pub async fn build_images_document(
    app: AppHandle,
    specs: Vec<ImageSpec>,
) -> Result<String, ErrorInfo> {
    let cache = app.path().app_cache_dir().map_err(internal)?;
    tauri::async_runtime::spawn_blocking(move || images_document(&specs, &cache))
        .await
        .map_err(internal)?
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(Into::into)
}
