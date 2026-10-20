//! The model lists already fetched, saved in a small JSON file in the app's cache folder, so the provider is
//! asked again only when the user presses reload or the list is a week old. A list is kept per provider,
//! address, workspace and whether a key was saved (a key can see models that no key cannot); never the key.

use crate::error::{AiError, Result};
use crate::models::ModelInfo;
use crate::provider::ProviderConfig;
use card_core::ErrorInfo;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// How long a saved list is used without asking the provider again.
pub const MAX_AGE_SECS: u64 = 7 * 24 * 60 * 60;

/// One saved list and when it was fetched (seconds since 1970).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedList {
    pub fetched_at: u64,
    pub models: Vec<ModelInfo>,
}

/// What the picker gets: the list, when it was fetched, and why it could not be fetched again, if it was
/// asked and failed (the saved list is then shown).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ModelList {
    pub models: Vec<ModelInfo>,
    pub fetched_at: u64,
    pub refresh_error: Option<ErrorInfo>,
}

/// Which saved list belongs to `config`.
pub fn cache_key(config: &ProviderConfig, keyed: bool) -> String {
    let kind = serde_json::to_value(config.kind)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    format!(
        "{kind}|{}|{}|{}",
        config.base(),
        config.workspace().unwrap_or(""),
        if keyed { "key" } else { "no-key" }
    )
}

/// The saved lists; a missing or unreadable file is no lists.
pub fn load(path: &Path) -> BTreeMap<String, SavedList> {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save(path: &Path, lists: &BTreeMap<String, SavedList>) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(lists).unwrap_or_default())?;
    std::fs::rename(tmp, path)
}

/// The list for `key`: the saved one while it is younger than [`MAX_AGE_SECS`] and `refresh` is false, else a
/// new one from `fetch`, which is saved. When `fetch` fails and a list is saved, that list comes back with the
/// error; with nothing saved, the error does. A file that cannot be written only means asking again next time.
pub fn cached(
    path: &Path,
    key: &str,
    refresh: bool,
    now: u64,
    fetch: impl FnOnce() -> Result<Vec<ModelInfo>>,
) -> Result<ModelList> {
    let mut lists = load(path);
    let saved = lists.get(key).cloned();
    if let Some(s) = &saved {
        if !refresh && now.saturating_sub(s.fetched_at) < MAX_AGE_SECS {
            return Ok(ModelList {
                models: s.models.clone(),
                fetched_at: s.fetched_at,
                refresh_error: None,
            });
        }
    }
    match fetch() {
        Ok(models) => {
            lists.insert(
                key.to_string(),
                SavedList {
                    fetched_at: now,
                    models: models.clone(),
                },
            );
            let _ = save(path, &lists);
            Ok(ModelList {
                models,
                fetched_at: now,
                refresh_error: None,
            })
        }
        Err(e @ AiError::Disabled) => Err(e),
        Err(e) => match saved {
            Some(s) => Ok(ModelList {
                models: s.models,
                fetched_at: s.fetched_at,
                refresh_error: Some(e.into()),
            }),
            None => Err(e),
        },
    }
}
