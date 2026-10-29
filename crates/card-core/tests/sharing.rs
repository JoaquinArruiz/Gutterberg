//! A shared project finds its PDFs beside it, and its readme goes beside it too.
use card_core::project::file_hash;
use card_core::sharing::{find_beside, readme_path, write_readme, Beside};
use std::path::{Path, PathBuf};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("card-core-sharing-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn file(dir: &Path, name: &str, content: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, content).unwrap();
    path
}

#[test]
fn the_pdf_is_found_by_name_then_by_content() {
    let dir = scratch("found");
    let project = dir.join("kit.gtr");
    let pdf = file(&dir, "cards.pdf", "the cards");
    let hash = file_hash(&pdf).unwrap();
    let same = |path: &PathBuf| {
        Some(Beside {
            path: path.clone(),
            same: true,
        })
    };

    assert_eq!(
        find_beside(&project, "cards.pdf", &hash).unwrap(),
        same(&pdf)
    );
    // Renamed by whoever shared it: found by its content.
    assert_eq!(
        find_beside(&project, "old name.pdf", &hash).unwrap(),
        same(&pdf)
    );
    // The same name with other content (an updated PDF) is offered, as not the same file.
    let other = file_hash(&file(&dir, "x.txt", "other")).unwrap();
    assert_eq!(
        find_beside(&project, "cards.pdf", &other).unwrap(),
        Some(Beside {
            path: pdf.clone(),
            same: false
        })
    );
    // Only files of the same kind are compared.
    let png = file(&dir, "art.png", "the cards");
    assert_eq!(
        find_beside(&project, "front.png", &hash).unwrap(),
        same(&png)
    );
    // Neither: nothing.
    assert_eq!(find_beside(&project, "tokens.pdf", &other).unwrap(), None);
}

#[test]
fn a_name_never_reaches_outside_the_folder() {
    let dir = scratch("outside");
    let inner = dir.join("inner");
    std::fs::create_dir_all(&inner).unwrap();
    let pdf = file(&dir, "cards.pdf", "the cards");
    let hash = file_hash(&pdf).unwrap();
    assert_eq!(
        find_beside(&inner.join("kit.gtr"), "../cards.pdf", &hash).unwrap(),
        None
    );
}

#[test]
fn the_readme_is_named_after_the_project_and_written_beside_it() {
    let dir = scratch("readme");
    let project = dir.join("my game.gtr");
    assert_eq!(
        readme_path(&project).unwrap(),
        dir.join("my game-Gutterberg-readme.txt")
    );
    assert!(readme_path(&dir.join("my game.pdf")).is_err());
    let written = write_readme(&project, "Hello\n").unwrap();
    assert_eq!(std::fs::read_to_string(written).unwrap(), "Hello\n");
}
