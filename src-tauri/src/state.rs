use crate::keychain::KeyringStore;
use card_ai::Gate;
use card_core::card::DocumentId;
use card_core::render_worker::RenderWorker;
use card_core::{Error, ErrorInfo, ErrorParam};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct AppState {
    worker: Mutex<Option<Arc<RenderWorker>>>,
    /// The file each open document was read from, by the id its cards carry.
    paths: Mutex<HashMap<DocumentId, PathBuf>>,
    /// Whether AI Mode is on; every AI command refuses while it is off.
    pub ai_gate: Arc<Gate>,
    /// API keys, in the system keychain.
    pub ai_keys: Arc<KeyringStore>,
}

impl AppState {
    /// Start the render thread (which binds pdfium) on first use so a missing
    /// library becomes a UI error instead of a crash at startup.
    pub fn worker(&self, app: &AppHandle) -> Result<Arc<RenderWorker>, ErrorInfo> {
        let mut slot = self.worker.lock().map_err(internal)?;
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
        let w = Arc::new(RenderWorker::spawn(dirs)?);
        *slot = Some(w.clone());
        Ok(w)
    }

    pub fn set_path(&self, id: DocumentId, p: PathBuf) -> Result<(), ErrorInfo> {
        self.paths.lock().map_err(internal)?.insert(id, p);
        Ok(())
    }

    /// Forget one open document, or all of them (`None`).
    pub fn clear_paths(&self, id: Option<DocumentId>) -> Result<(), ErrorInfo> {
        let mut paths = self.paths.lock().map_err(internal)?;
        match id {
            Some(id) => {
                paths.remove(&id);
            }
            None => paths.clear(),
        }
        Ok(())
    }

    pub fn path(&self, id: DocumentId) -> Result<PathBuf, ErrorInfo> {
        self.paths
            .lock()
            .map_err(internal)?
            .get(&id)
            .cloned()
            .ok_or_else(|| Error::NoDocument.into())
    }
}

/// A failure that is the app's, not the user's (a poisoned lock, a stopped task).
pub fn internal(e: impl std::fmt::Display) -> ErrorInfo {
    let message = e.to_string();
    let mut info = ErrorInfo::new("internal", &message);
    info.params
        .insert("detail".into(), ErrorParam::Text(message));
    info
}
