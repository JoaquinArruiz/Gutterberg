//! Project files (`.gtr`): reading, checking, migrating and writing.
//!
//! A project is a JSON object that starts with `"format": "gutterberg-project"` and a
//! `"version"`. Everything after those two keys belongs to the UI (its page groups, plan and
//! output settings), so this module only owns the envelope: it decides whether a file is a
//! project at all, upgrades older versions, refuses newer ones, and writes the two keys first.
//!
//! The check runs before anything else touches the file, with three outcomes:
//! not a project ([`Error::NotAProject`]), older (migrated silently) and newer
//! ([`Error::ProjectTooNew`], never opened partially).

use crate::error::{Error, Result};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

/// The value of the `format` key: the file's signature while it stays readable JSON.
pub const FORMAT: &str = "gutterberg-project";

/// The version this build writes and reads without migrating.
pub const VERSION: u32 = 1;

/// File extension of a project, without the dot.
pub const EXTENSION: &str = "gtr";

/// A project file's top-level object.
pub type Body = Map<String, Value>;

/// Upgrades the object of one version to the next, in place. `MIGRATIONS[i]` takes version
/// `i + 1` to `i + 2`. Empty while version 1 is the only one.
pub type Migration = fn(&mut Body);

const MIGRATIONS: &[Migration] = &[];

/// A project file is a few hundred kilobytes at most; anything much larger is some other file.
const MAX_PROJECT_BYTES: u64 = 64 * 1024 * 1024;

/// Checks that `text` is a project of a version this build can read, and returns it at
/// [`VERSION`]. Not JSON, a `format` that is missing or different, or an unusable `version`
/// is [`Error::NotAProject`]; a newer `version` is [`Error::ProjectTooNew`].
pub fn parse_project(text: &str) -> Result<Body> {
    parse_project_with(text, VERSION, MIGRATIONS)
}

/// [`parse_project`] for any `current` version and migration chain (`migrations[i]` takes
/// version `i + 1` to `i + 2`), so the migration machinery can be tested before a second
/// version exists.
pub fn parse_project_with(text: &str, current: u32, migrations: &[Migration]) -> Result<Body> {
    let Ok(Value::Object(mut body)) = serde_json::from_str::<Value>(text) else {
        return Err(Error::NotAProject);
    };
    if body.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(Error::NotAProject);
    }
    let found = body
        .get("version")
        .and_then(Value::as_u64)
        .filter(|v| *v >= 1)
        .ok_or(Error::NotAProject)?;
    if found > u64::from(current) {
        return Err(Error::ProjectTooNew {
            found: u32::try_from(found).unwrap_or(u32::MAX),
            supported: current,
        });
    }
    for version in found as usize..current as usize {
        let step = migrations.get(version - 1).ok_or_else(|| {
            Error::Malformed(format!("no migration from project version {version}"))
        })?;
        step(&mut body);
    }
    body.insert("version".into(), Value::from(current));
    Ok(body)
}

/// Reads and checks the project at `path`. A file that is not text, or is far larger than any
/// project, is [`Error::NotAProject`] without being read whole.
pub fn read_project(path: &Path) -> Result<Body> {
    let mut file = std::fs::File::open(path)?;
    if file.metadata()?.len() > MAX_PROJECT_BYTES {
        return Err(Error::NotAProject);
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let text = String::from_utf8(bytes).map_err(|_| Error::NotAProject)?;
    parse_project(&text)
}

#[derive(Serialize)]
struct Envelope<'a> {
    format: &'static str,
    version: u32,
    #[serde(flatten)]
    rest: &'a Body,
}

/// The file's text: `format` and `version` first, then the rest of `body` (any `format` or
/// `version` it carries is replaced), indented so a person can read it.
pub fn project_to_string(body: &Body) -> Result<String> {
    let rest: Body = body
        .iter()
        .filter(|(k, _)| k.as_str() != "format" && k.as_str() != "version")
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let mut text = serde_json::to_string_pretty(&Envelope {
        format: FORMAT,
        version: VERSION,
        rest: &rest,
    })
    .map_err(|e| Error::Malformed(e.to_string()))?;
    text.push('\n');
    Ok(text)
}

/// Writes `body` as a project at `path` through a temporary file beside it, so a failed save
/// never leaves a truncated project.
pub fn save_project(path: &Path, body: &Body) -> Result<()> {
    let text = project_to_string(body)?;
    let name = path
        .file_name()
        .ok_or_else(|| Error::Malformed("project path has no file name".into()))?
        .to_string_lossy();
    let tmp = path.with_file_name(format!(".{name}.{}.tmp", std::process::id()));
    let result = std::fs::write(&tmp, text).and_then(|()| std::fs::rename(&tmp, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(result?)
}

/// SHA-256 of the file at `path` as lowercase hex: how a project recognises its PDFs.
pub fn file_hash(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}
