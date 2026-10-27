//! Sharing a project: a `.gtr` handed to someone else, with its PDFs in the same folder.
//!
//! A project keeps each PDF's (and image's) full path on the computer it was saved on, so on
//! another computer the path is gone. [`find_beside`] looks for the file next to the project
//! instead, by name and then by content, before the user is asked. [`write_readme`] puts a text file beside a project
//! that says what it is and how to open it; nothing reads it back.

use crate::error::{Error, Result};
use crate::project::{file_hash, EXTENSION};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Most files of the folder that are hashed while looking for a file by its content.
const MAX_HASHED: usize = 200;

/// A file found beside a project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Beside {
    pub path: PathBuf,
    /// The file is the one the project was saved with (same SHA-256). False for a file with the
    /// same name but other content: the publisher may have updated their PDF.
    pub same: bool,
}

/// Looks in the folder of `project` for the file a project knows as `name` with the SHA-256
/// `hash`: first a file of that name with that content, then any file there with the same
/// extension (`.pdf`, `.png`, ...) and that content, then a file of that name whatever it holds.
/// `None` when there is none of these.
pub fn find_beside(project: &Path, name: &str, hash: &str) -> Result<Option<Beside>> {
    let Some(dir) = project.parent() else {
        return Ok(None);
    };
    // Only a plain file name: a name with a path in it never looks outside the folder.
    let named = Path::new(name)
        .file_name()
        .filter(|n| n.to_string_lossy() == name)
        .map(|n| dir.join(n))
        .filter(|p| p.is_file());
    if let Some(p) = &named {
        if file_hash(p)? == hash {
            return Ok(Some(Beside {
                path: p.clone(),
                same: true,
            }));
        }
    }
    let extension = Path::new(name).extension().map(|e| e.to_ascii_lowercase());
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.is_file()
                && Some(p) != named.as_ref()
                && extension.is_some()
                && p.extension().map(|e| e.to_ascii_lowercase()) == extension
        })
        .collect();
    candidates.sort();
    for p in candidates.into_iter().take(MAX_HASHED) {
        if file_hash(&p).is_ok_and(|h| h == hash) {
            return Ok(Some(Beside {
                path: p,
                same: true,
            }));
        }
    }
    Ok(named.map(|path| Beside { path, same: false }))
}

/// Where the readme of a shared project goes: `<name>-Gutterberg-readme.txt` beside `project`.
pub fn readme_path(project: &Path) -> Result<PathBuf> {
    let is_project = project
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case(EXTENSION));
    let stem = project
        .file_stem()
        .filter(|_| is_project)
        .ok_or_else(|| Error::Malformed("not a project path".into()))?;
    Ok(project.with_file_name(format!("{}-Gutterberg-readme.txt", stem.to_string_lossy())))
}

/// Writes `text` as the readme of `project`, replacing one already there, and returns its path.
pub fn write_readme(project: &Path, text: &str) -> Result<PathBuf> {
    let path = readme_path(project)?;
    std::fs::write(&path, text)?;
    Ok(path)
}
