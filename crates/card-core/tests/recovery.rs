//! Recovery copies: written beside nothing of the user's, offered only once their app stopped
//! writing them, and removed on request.
use card_core::project::Body;
use card_core::recovery::{clear_recovery, find_recovery, write_recovery, RecoveryInfo};
use serde_json::json;

fn scratch(name: &str) -> std::path::PathBuf {
    let dir =
        std::env::temp_dir().join(format!("card-core-recovery-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn project(gap: f64) -> Body {
    json!({ "documents": [], "output": { "gapX": gap } })
        .as_object()
        .unwrap()
        .clone()
}

fn info(path: Option<&str>, written: u64) -> RecoveryInfo {
    RecoveryInfo {
        path: path.map(str::to_string),
        written,
    }
}

#[test]
fn a_copy_is_offered_once_its_app_stopped_writing_it() {
    let dir = scratch("offered");
    write_recovery(
        &dir,
        "run-1",
        &project(1.5),
        &info(Some("/games/kit.gtr"), 1000),
    )
    .unwrap();
    // Still being written by a running app.
    assert!(find_recovery(&dir, 1030, 90).unwrap().is_none());
    let found = find_recovery(&dir, 1200, 90).unwrap().unwrap();
    assert_eq!(found.id, "run-1");
    assert_eq!(found.info, info(Some("/games/kit.gtr"), 1000));
    // Read back as a project of this version, with the envelope.
    assert_eq!(found.project["output"]["gapX"], json!(1.5));
    assert_eq!(found.project["format"], json!("gutterberg-project"));
    clear_recovery(&dir, "run-1").unwrap();
    assert!(find_recovery(&dir, 1200, 90).unwrap().is_none());
    // Clearing what is gone, or a folder that was never made, is fine.
    clear_recovery(&dir, "run-1").unwrap();
    assert!(find_recovery(&scratch("never-made"), 0, 0)
        .unwrap()
        .is_none());
}

#[test]
fn the_newest_of_several_is_offered_and_a_broken_one_is_removed() {
    let dir = scratch("several");
    write_recovery(&dir, "old", &project(1.0), &info(None, 100)).unwrap();
    write_recovery(&dir, "new", &project(2.0), &info(None, 500)).unwrap();
    write_recovery(&dir, "broken", &project(3.0), &info(None, 900)).unwrap();
    std::fs::write(dir.join("broken.gtr"), "not a project").unwrap();
    let found = find_recovery(&dir, 2000, 90).unwrap().unwrap();
    assert_eq!(found.id, "new");
    assert!(!dir.join("broken.json").exists());
    assert!(dir.join("old.gtr").exists());
}

#[test]
fn an_id_never_leaves_the_folder() {
    let dir = scratch("ids");
    for id in ["", "../x", "a/b", "a.b"] {
        assert!(write_recovery(&dir, id, &project(1.0), &info(None, 1)).is_err());
        assert!(clear_recovery(&dir, id).is_err());
    }
}
