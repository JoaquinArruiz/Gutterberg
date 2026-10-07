use card_core::render_worker::RenderWorker;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct AppState {
    worker: Mutex<Option<Arc<RenderWorker>>>,
    path: Mutex<Option<PathBuf>>,
}

impl AppState {
    /// Start the render thread (which binds pdfium) on first use so a missing
    /// library becomes a UI error instead of a crash at startup.
    pub fn worker(&self, app: &AppHandle) -> Result<Arc<RenderWorker>, String> {
        let mut slot = self.worker.lock().map_err(|e| e.to_string())?;
        if let Some(w) = slot.as_ref() {
            return Ok(w.clone());
        }
        // Search every candidate: in `tauri dev` the (empty) resource dir under
        // target/ exists, so the first existing directory is not necessarily the one
        // that holds the library.
        let mut dirs: Vec<PathBuf> = Vec::new();
        if let Ok(d) = app.path().resource_dir() {
            dirs.push(d.join("resources").join("pdfium"));
            dirs.push(d.join("pdfium"));
        }
        dirs.push(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("pdfium"),
        );
        let w = Arc::new(RenderWorker::spawn(dirs).map_err(|e| e.to_string())?);
        *slot = Some(w.clone());
        Ok(w)
    }

    pub fn set_path(&self, p: PathBuf) -> Result<(), String> {
        *self.path.lock().map_err(|e| e.to_string())? = Some(p);
        Ok(())
    }

    pub fn path(&self) -> Result<PathBuf, String> {
        self.path
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or_else(|| "no PDF is open".to_string())
    }
}
