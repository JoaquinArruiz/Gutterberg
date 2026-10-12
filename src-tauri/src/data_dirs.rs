//! Where the app keeps its data, and the one-time move from the folder the identifier used to name.
//!
//! On Windows and Linux the web view keeps its storage (the saved preferences, recent projects and the "tour
//! seen" flag among it) in the app's local data folder. Tauri named that folder after the `identifier`
//! (`dev.joaquinarruiz.gutterberg`); `app.appDirectoriesOverride` in `tauri.conf.json` now names it
//! `Gutterberg`, and `migrate` moves what the old name holds, once, before the web view opens. The identifier
//! itself stays as it was: it is also the app's identity for the installers, the updater and the file type.
//!
//! macOS is left alone: its web view keeps its storage under the bundle identifier whatever the override says,
//! so there is nothing to rename or move there.

use std::path::Path;

/// What the folders were named after: `identifier` in `tauri.conf.json`, which has not changed.
#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
const OLD_NAME: &str = "dev.joaquinarruiz.gutterberg";
/// What `app.appDirectoriesOverride` in `tauri.conf.json` names them now.
#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
const NEW_NAME: &str = "Gutterberg";

#[derive(Debug, PartialEq, Eq)]
#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
enum Moved {
    /// The old folder was renamed to the new name.
    Done,
    /// There is no old folder: a fresh install, or already moved.
    NothingToMove,
    /// Both exist: the new one is in use, so nothing is touched (never merge or overwrite).
    AlreadyThere,
    Failed(String),
}

/// Renames `old` to `new` when `old` is a folder and `new` does not exist yet. Both are in the same parent folder,
/// so this is a rename, not a copy: it is instant and either happens whole or not at all.
#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
fn move_dir(old: &Path, new: &Path) -> Moved {
    if !old.is_dir() {
        return Moved::NothingToMove;
    }
    if new.exists() {
        return Moved::AlreadyThere;
    }
    match std::fs::rename(old, new) {
        Ok(()) => Moved::Done,
        Err(e) => Moved::Failed(e.to_string()),
    }
}

/// Moves the old data folders to their new names. Call it first thing at start, before the web view is created.
/// A failure leaves the old folder where it is and is only reported on stderr: the app still starts, with
/// settings back at their defaults.
pub fn migrate() {
    #[cfg(any(windows, target_os = "linux"))]
    // The same base folders Tauri's own `$LOCALDATA`, `$DATA`, `$CONFIG` and `$CACHE` variables resolve to, the
    // local data one first because that is where the web view lives. On some systems two of them are the same
    // folder; the second then finds it already moved.
    for base in [
        dirs::data_local_dir(),
        dirs::data_dir(),
        dirs::config_dir(),
        dirs::cache_dir(),
    ]
    .into_iter()
    .flatten()
    {
        let (old, new) = (base.join(OLD_NAME), base.join(NEW_NAME));
        if let Moved::Failed(why) = move_dir(&old, &new) {
            eprintln!(
                "Gutterberg: could not move {} to {}: {why}",
                old.display(),
                new.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A fresh, empty folder under the system's temporary one.
    fn scratch() -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "gutterberg-data-dirs-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn moves_the_old_folder_with_everything_in_it() {
        let base = scratch();
        let (old, new) = (base.join(OLD_NAME), base.join(NEW_NAME));
        fs::create_dir_all(old.join("localstorage")).unwrap();
        fs::write(
            old.join("localstorage").join("prefs.db"),
            b"saved preferences",
        )
        .unwrap();
        assert_eq!(move_dir(&old, &new), Moved::Done);
        assert!(!old.exists());
        assert_eq!(
            fs::read(new.join("localstorage").join("prefs.db")).unwrap(),
            b"saved preferences"
        );
    }

    #[test]
    fn a_fresh_install_has_nothing_to_move_and_creates_nothing() {
        let base = scratch();
        let (old, new) = (base.join(OLD_NAME), base.join(NEW_NAME));
        assert_eq!(move_dir(&old, &new), Moved::NothingToMove);
        assert!(!old.exists() && !new.exists());
    }

    #[test]
    fn never_overwrites_or_merges_into_a_folder_already_in_use() {
        let base = scratch();
        let (old, new) = (base.join(OLD_NAME), base.join(NEW_NAME));
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("old.txt"), b"old").unwrap();
        fs::write(new.join("new.txt"), b"new").unwrap();
        assert_eq!(move_dir(&old, &new), Moved::AlreadyThere);
        assert!(old.join("old.txt").exists() && new.join("new.txt").exists());
        assert!(!new.join("old.txt").exists());
    }

    #[test]
    fn running_it_twice_moves_only_once() {
        let base = scratch();
        let (old, new) = (base.join(OLD_NAME), base.join(NEW_NAME));
        fs::create_dir_all(&old).unwrap();
        assert_eq!(move_dir(&old, &new), Moved::Done);
        assert_eq!(move_dir(&old, &new), Moved::NothingToMove);
    }

    #[test]
    fn a_plain_file_with_the_old_name_is_left_alone() {
        let base = scratch();
        let (old, new) = (base.join(OLD_NAME), base.join(NEW_NAME));
        fs::write(&old, b"not a folder").unwrap();
        assert_eq!(move_dir(&old, &new), Moved::NothingToMove);
        assert!(old.is_file() && !new.exists());
    }

    /// The names here and the ones in `tauri.conf.json` are one decision made in two places: keep them in step.
    #[test]
    fn the_constants_match_tauri_conf_json() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            conf["identifier"], OLD_NAME,
            "the identifier changed: the old folders are named after it"
        );
        let overrides = &conf["app"]["appDirectoriesOverride"];
        for (key, variable) in [
            ("config", "$CONFIG"),
            ("data", "$DATA"),
            ("localData", "$LOCALDATA"),
            ("cache", "$CACHE"),
        ] {
            assert_eq!(
                overrides[key],
                format!("{variable}/{NEW_NAME}"),
                "appDirectoriesOverride.{key}"
            );
        }
    }
}
