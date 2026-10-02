use pdfium_render::prelude::Pdfium;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct AppState {
    pdfium: Mutex<Option<Arc<Pdfium>>>,
    path: Mutex<Option<PathBuf>>,
}

impl AppState {
    /// Bind pdfium on first use so a missing library becomes a UI error
    /// instead of a crash at startup.
    pub fn pdfium(&self, app: &AppHandle) -> Result<Arc<Pdfium>, String> {
        let mut slot = self.pdfium.lock().map_err(|e| e.to_string())?;
        if let Some(p) = slot.as_ref() {
            return Ok(p.clone());
        }
        // Search every candidate: in `tauri dev` the (empty) resource dir under
        // target/ exists, so the first existing directory is not necessarily the one
        // that holds the library.
        let mut dirs: Vec<PathBuf> = Vec::new();
        if let Ok(d) = app.path().resource_dir() {
            dirs.push(d.join("resources").join("pdfium"));
            dirs.push(d.join("pdfium"));
        }
        dirs.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("pdfium"));
        let p = Arc::new(card_core::render::bind_pdfium(&dirs).map_err(|e| e.to_string())?);
        *slot = Some(p.clone());
        Ok(p)
    }

    pub fn set_path(&self, p: PathBuf) {
        *self.path.lock().unwrap() = Some(p);
    }

    pub fn path(&self) -> Result<PathBuf, String> {
        self.path.lock().unwrap().clone().ok_or_else(|| "no PDF is open".to_string())
    }
}
