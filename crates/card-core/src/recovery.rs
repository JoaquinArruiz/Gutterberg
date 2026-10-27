//! Recovery copies: while a project has unsaved changes the app writes it, every half minute, to a
//! folder of its own (never over the user's `.gtr`), so a crash or a closed window loses little.
//! Each running copy of the app writes under its own id, a `.gtr` and a small `.json` that says
//! where the project was saved (if anywhere) and when the copy was written. A copy that has not
//! been written for a while belongs to an app that is no longer running, and the next start offers
//! it. A save, or closing the window on purpose, removes it.

use crate::project::{read_project, save_project, Body};
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// What is kept beside a recovery copy.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecoveryInfo {
    /// The `.gtr` the project was opened from or saved to; none for a project never saved.
    pub path: Option<String>,
    /// When the copy was written, in seconds since 1970.
    pub written: u64,
}

/// A copy found at start: its id, what was kept with it and the project, read and migrated.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Recovered {
    pub id: String,
    pub info: RecoveryInfo,
    pub project: Body,
}

/// An id is made by the app (letters, digits and `-`), so it never names a path outside `dir`.
fn check_id(id: &str) -> Result<()> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok {
        Ok(())
    } else {
        Err(Error::Malformed(format!("not a recovery id: {id:?}")))
    }
}

fn files(dir: &Path, id: &str) -> (PathBuf, PathBuf) {
    (
        dir.join(format!("{id}.gtr")),
        dir.join(format!("{id}.json")),
    )
}

/// Writes the recovery copy `id` of `project` in `dir` (made if missing), the project first, so
/// a copy is only ever offered whole.
pub fn write_recovery(dir: &Path, id: &str, project: &Body, info: &RecoveryInfo) -> Result<()> {
    check_id(id)?;
    std::fs::create_dir_all(dir)?;
    let (gtr, json) = files(dir, id);
    save_project(&gtr, project)?;
    let text = serde_json::to_string(info).map_err(|e| Error::Malformed(e.to_string()))?;
    let tmp = dir.join(format!(".{id}.json.tmp"));
    std::fs::write(&tmp, text).and_then(|()| std::fs::rename(&tmp, &json))?;
    Ok(())
}

/// Removes the recovery copy `id`; one that is not there is no error.
pub fn clear_recovery(dir: &Path, id: &str) -> Result<()> {
    check_id(id)?;
    let (gtr, json) = files(dir, id);
    for file in [json, gtr] {
        match std::fs::remove_file(file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
    }
    Ok(())
}

/// The newest copy in `dir` written at least `stale_after` seconds before `now`: one a running app
/// keeps writing is younger and left alone. A copy that cannot be read is removed and skipped.
pub fn find_recovery(dir: &Path, now: u64, stale_after: u64) -> Result<Option<Recovered>> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let mut found: Vec<(String, RecoveryInfo)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".json") else {
            continue;
        };
        if check_id(id).is_err() {
            continue;
        }
        let info = std::fs::read_to_string(entry.path())
            .ok()
            .and_then(|text| serde_json::from_str::<RecoveryInfo>(&text).ok());
        match info {
            Some(info) if now.saturating_sub(info.written) >= stale_after => {
                found.push((id.to_string(), info))
            }
            Some(_) => {}
            None => clear_recovery(dir, id)?,
        }
    }
    found.sort_by_key(|(_, info)| std::cmp::Reverse(info.written));
    for (id, info) in found {
        match read_project(&files(dir, &id).0) {
            Ok(project) => return Ok(Some(Recovered { id, info, project })),
            Err(_) => clear_recovery(dir, &id)?,
        }
    }
    Ok(None)
}
