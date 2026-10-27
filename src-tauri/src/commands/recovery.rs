//! The recovery copy of an unsaved project (`card_core::recovery`), in the app's data folder.
use crate::state::internal;
use card_core::project::Body;
use card_core::recovery::{
    clear_recovery as clear, find_recovery as find, write_recovery as write, Recovered,
    RecoveryInfo,
};
use card_core::{Error, ErrorInfo};
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// A copy not written for this long belongs to an app that stopped: the running one writes every
/// half minute while there is something to keep.
const STALE_AFTER_SECS: u64 = 90;

fn folder(app: &AppHandle) -> Result<PathBuf, ErrorInfo> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(internal)?
        .join("recovery"))
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Writes this run's copy (`id`) of `project`, saved at `path` if it has a file.
#[tauri::command]
pub async fn write_recovery(
    app: AppHandle,
    id: String,
    project: Value,
    path: Option<String>,
) -> Result<(), ErrorInfo> {
    let body: Body = match project {
        Value::Object(body) => body,
        _ => return Err(Error::Malformed("a project must be an object".into()).into()),
    };
    let dir = folder(&app)?;
    let info = RecoveryInfo {
        path,
        written: now(),
    };
    tauri::async_runtime::spawn_blocking(move || write(&dir, &id, &body, &info))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}

/// Removes the copy `id`: the project was saved, or closed on purpose.
#[tauri::command]
pub async fn clear_recovery(app: AppHandle, id: String) -> Result<(), ErrorInfo> {
    let dir = folder(&app)?;
    tauri::async_runtime::spawn_blocking(move || clear(&dir, &id))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}

/// The newest copy left by an app that is no longer running, to offer at start.
#[tauri::command]
pub async fn find_recovery(app: AppHandle) -> Result<Option<Recovered>, ErrorInfo> {
    let dir = folder(&app)?;
    tauri::async_runtime::spawn_blocking(move || find(&dir, now(), STALE_AFTER_SECS))
        .await
        .map_err(internal)?
        .map_err(Into::into)
}
