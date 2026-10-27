use crate::state::internal;
use base64::{engine::general_purpose::STANDARD, Engine};
use card_core::fill::{copy_fills, fills_dir, save_fill};
use card_core::project::{file_hash, read_project, save_project, Body};
use card_core::sharing::{find_beside, write_readme, Beside};
use card_core::{Error, ErrorInfo};
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;

/// Read the project at `path`. The format check runs here, before anything else: a file that
/// is not a project, or was made by a newer version, is refused with its own error code, and an
/// older one comes back already migrated to the current version.
#[tauri::command]
pub async fn open_project(path: String) -> Result<Value, ErrorInfo> {
    tauri::async_runtime::spawn_blocking(move || read_project(&PathBuf::from(path)))
        .await
        .map_err(internal)?
        .map(Value::Object)
        .map_err(Into::into)
}

/// Write `project` (a JSON object) to `path` as a project file, signature first.
#[tauri::command]
pub async fn save_project_file(path: String, project: Value) -> Result<(), ErrorInfo> {
    let body: Body = match project {
        Value::Object(body) => body,
        _ => return Err(Error::Malformed("a project must be an object".into()).into()),
    };
    tauri::async_runtime::spawn_blocking(move || save_project(&PathBuf::from(path), &body))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}

/// SHA-256 of a file, as lowercase hex: how a project tells whether a PDF is still the same.
#[tauri::command]
pub async fn hash_file(path: String) -> Result<String, ErrorInfo> {
    tauri::async_runtime::spawn_blocking(move || file_hash(&PathBuf::from(path)))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}

/// Whether a file exists at `path`: a project's PDF that was moved or deleted.
#[tauri::command]
pub fn file_exists(path: String) -> bool {
    PathBuf::from(path).is_file()
}

/// Looks beside the project at `project` for its PDF `name` (by name, then by content): a shared
/// project whose PDF's saved path is on someone else's computer.
#[tauri::command]
pub async fn find_beside_project(
    project: String,
    name: String,
    hash: String,
) -> Result<Option<Beside>, ErrorInfo> {
    tauri::async_runtime::spawn_blocking(move || find_beside(&PathBuf::from(project), &name, &hash))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}

/// Writes the readme of a shared project beside it and returns the readme's path.
#[tauri::command]
pub async fn write_project_readme(project: String, text: String) -> Result<String, ErrorInfo> {
    tauri::async_runtime::spawn_blocking(move || write_readme(&PathBuf::from(project), &text))
        .await
        .map_err(internal)?
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(Into::into)
}

/// A picture of Fill with AI to keep: the piece's key, the band (PNG, base64) and the hash of what was sent.
#[derive(Debug, Deserialize)]
pub struct NewFill {
    pub key: String,
    pub png: String,
    pub hash: String,
}

/// Writes `fills` into the fills folder of the project at `project` and returns their file names, in order.
#[tauri::command]
pub async fn save_fills(project: String, fills: Vec<NewFill>) -> Result<Vec<String>, ErrorInfo> {
    tauri::async_runtime::spawn_blocking(move || {
        let project = PathBuf::from(project);
        fills
            .iter()
            .map(|f| {
                let png = STANDARD
                    .decode(&f.png)
                    .map_err(|e| Error::FillReply(e.to_string()))?;
                save_fill(&project, &f.key, &png, &f.hash)
            })
            .collect::<card_core::Result<Vec<_>>>()
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}

/// Copies the fills `names` of the project at `from` beside the project at `to` (Save As); how many were copied.
#[tauri::command]
pub async fn copy_project_fills(
    from: String,
    to: String,
    names: Vec<String>,
) -> Result<usize, ErrorInfo> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_fills(&PathBuf::from(from), &PathBuf::from(to), &names)
    })
    .await
    .map_err(internal)?
    .map_err(Into::into)
}

/// Of the fills `names` of the project at `project`, the ones that are not in its fills folder.
#[tauri::command]
pub fn missing_fills(project: String, names: Vec<String>) -> Vec<String> {
    let dir = fills_dir(&PathBuf::from(project));
    names
        .into_iter()
        .filter(|n| !dir.join(n).is_file())
        .collect()
}
