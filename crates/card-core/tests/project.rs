//! Project files: the format check, migrations, the written envelope and the PDF hash.
use card_core::project::{
    file_hash, parse_project, parse_project_with, project_to_string, read_project, save_project,
    Body, Migration, FORMAT, VERSION,
};
use card_core::{Error, ErrorInfo};
use serde_json::json;

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("card-core-project-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn a_current_project_opens_as_it_is() {
    let text = include_str!("data/project_v1.gtr");
    let body = parse_project(text).unwrap();
    assert_eq!(body["format"], FORMAT);
    assert_eq!(body["version"], VERSION);
    assert_eq!(body["documents"][0]["path"], "/games/poker.pdf");
}

#[test]
fn a_version_1_project_gets_the_finishing_defaults_and_nothing_else_changes() {
    let text = include_str!("data/project_v1_full.gtr");
    let original: serde_json::Value = serde_json::from_str(text).unwrap();
    let body = parse_project(text).unwrap();
    assert_eq!(body["version"], 2);
    assert_eq!(
        body["plan"]["finish"],
        json!({
            "marks": { "style": "off", "widthMm": 0.25, "color": "#000000", "lengthMm": 3, "offsetMm": 1 },
            "bleed": { "mm": 0, "source": "mirror" },
            "duplex": { "on": false, "flip": "long", "offsetXMm": 0, "offsetYMm": 0, "commonBack": null },
        })
    );
    assert_eq!(body["edits"]["backs"], json!({}));
    // Everything else is as it was.
    let mut migrated = serde_json::Value::Object(body);
    migrated.as_object_mut().unwrap().remove("version");
    migrated["plan"].as_object_mut().unwrap().remove("finish");
    migrated["edits"].as_object_mut().unwrap().remove("backs");
    let mut expected = original;
    expected.as_object_mut().unwrap().remove("version");
    assert_eq!(migrated, expected);
}

#[test]
fn a_version_2_project_keeps_its_finishing() {
    let text = include_str!("data/project_v2.gtr");
    let body = parse_project(text).unwrap();
    assert_eq!(body["plan"]["finish"]["bleed"]["mm"], 2);
    assert_eq!(body["plan"]["finish"]["duplex"]["on"], true);
    assert_eq!(body["edits"]["backs"]["g:0:0:1:1"], "g:0:0:2:2");
}

#[test]
fn text_that_is_not_a_project_is_refused() {
    for text in [
        "",
        "not json at all",
        "%PDF-1.7 binary",
        "[1, 2, 3]",
        "[]",
        "42",
        "{}",
        r#"{ "version": 1 }"#,
        r#"{ "format": "something-else", "version": 1 }"#,
        r#"{ "format": 7, "version": 1 }"#,
        // The right signature with a version that cannot be placed.
        r#"{ "format": "gutterberg-project" }"#,
        r#"{ "format": "gutterberg-project", "version": "1" }"#,
        r#"{ "format": "gutterberg-project", "version": 0 }"#,
        r#"{ "format": "gutterberg-project", "version": -3 }"#,
        r#"{ "format": "gutterberg-project", "version": 1.5 }"#,
    ] {
        assert!(
            matches!(parse_project(text), Err(Error::NotAProject)),
            "{text:?}"
        );
    }
}

#[test]
fn a_newer_version_is_never_opened_partially() {
    let text = r#"{ "format": "gutterberg-project", "version": 99, "documents": [] }"#;
    match parse_project(text) {
        Err(Error::ProjectTooNew { found, supported }) => {
            assert_eq!((found, supported), (99, VERSION));
        }
        other => panic!("{other:?}"),
    }
    // A version too large for the field still reads as newer.
    let huge = r#"{ "format": "gutterberg-project", "version": 99999999999999 }"#;
    assert!(matches!(
        parse_project(huge),
        Err(Error::ProjectTooNew { .. })
    ));
}

#[test]
fn the_errors_reach_the_ui_as_codes() {
    let v = serde_json::to_value(Error::NotAProject).unwrap();
    assert_eq!(v["code"], "not_a_project");
    let newer = ErrorInfo::from(Error::ProjectTooNew {
        found: 4,
        supported: 2,
    });
    assert_eq!(newer.code, "project_too_new");
    let v = serde_json::to_value(newer).unwrap();
    assert_eq!(
        (v["found"].as_f64(), v["supported"].as_f64()),
        (Some(4.0), Some(2.0))
    );
}

// A made-up history for the migration machinery: version 2 renamed `cards` to `pieces`,
// version 3 turned the `spacing` section into `output`.
fn v1_to_v2(body: &mut Body) {
    for doc in body["documents"].as_array_mut().unwrap() {
        let cards = doc.as_object_mut().unwrap().remove("cards").unwrap();
        doc["pieces"] = cards;
    }
}

fn v2_to_v3(body: &mut Body) {
    let spacing = body.remove("spacing").unwrap();
    body.insert("output".into(), json!({ "gapXMm": spacing["gap_mm"] }));
}

#[test]
fn an_older_project_is_migrated_step_by_step() {
    let chain: &[Migration] = &[v1_to_v2, v2_to_v3];
    let text = include_str!("data/project_v1_handwritten_old.gtr");
    let body = parse_project_with(text, 3, chain).unwrap();
    assert_eq!(body["version"], 3);
    assert_eq!(body["documents"][0]["pieces"], json!([]));
    assert!(body["documents"][0].get("cards").is_none());
    assert!(body.get("spacing").is_none());
    assert_eq!(body["output"]["gapXMm"], 3);

    // Starting from version 2 only the later step runs.
    let from_two = json!({
        "format": FORMAT, "version": 2,
        "documents": [], "spacing": { "gap_mm": 5 }
    })
    .to_string();
    let body = parse_project_with(&from_two, 3, chain).unwrap();
    assert_eq!(body["output"]["gapXMm"], 5);
    assert_eq!(body["version"], 3);
}

#[test]
fn a_gap_in_the_migration_chain_is_an_error_not_a_guess() {
    let text = include_str!("data/project_v1_handwritten_old.gtr");
    assert!(matches!(
        parse_project_with(text, 3, &[]),
        Err(Error::Malformed(_))
    ));
}

#[test]
fn the_file_starts_with_the_signature_and_survives_a_round_trip() {
    let dir = scratch("roundtrip");
    let path = dir.join("game.gtr");
    let mut body = Body::new();
    body.insert("zeta".into(), json!({ "keep": [1, 2, 3] }));
    body.insert("documents".into(), json!([{ "id": 0, "path": "/a.pdf" }]));
    // Whatever the caller claims, the file says what this build writes.
    body.insert("format".into(), json!("something-else"));
    body.insert("version".into(), json!(7));
    save_project(&path, &body).unwrap();

    let text = std::fs::read_to_string(&path).unwrap();
    assert!(
        text.starts_with("{\n  \"format\": \"gutterberg-project\",\n  \"version\": 2,"),
        "{text}"
    );

    let back = read_project(&path).unwrap();
    assert_eq!(back["zeta"], json!({ "keep": [1, 2, 3] }));
    assert_eq!(back["documents"][0]["path"], "/a.pdf");
    assert_eq!(project_to_string(&back).unwrap(), text);

    // No temporary file is left beside it.
    let leftovers = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
        .count();
    assert_eq!(leftovers, 0);
}

#[test]
fn reading_a_file_that_is_not_a_project() {
    let dir = scratch("not-a-project");
    let pdf = dir.join("cards.pdf");
    std::fs::write(&pdf, b"%PDF-1.7\n\xff\xfe\x00binary").unwrap();
    assert!(matches!(read_project(&pdf), Err(Error::NotAProject)));
    let text = dir.join("notes.gtr");
    std::fs::write(&text, "just some notes").unwrap();
    assert!(matches!(read_project(&text), Err(Error::NotAProject)));
    // A file that is not there is an I/O error, not "not a project".
    assert!(matches!(
        read_project(&dir.join("missing.gtr")),
        Err(Error::Io(_))
    ));
    let newer = dir.join("future.gtr");
    std::fs::write(&newer, r#"{"format":"gutterberg-project","version":3}"#).unwrap();
    assert!(matches!(
        read_project(&newer),
        Err(Error::ProjectTooNew { found: 3, .. })
    ));
}

#[test]
fn the_hash_identifies_a_file_by_its_content() {
    let dir = scratch("hash");
    let (a, b, c) = (dir.join("a.pdf"), dir.join("b.pdf"), dir.join("c.pdf"));
    std::fs::write(&a, b"abc").unwrap();
    std::fs::write(&b, b"abc").unwrap();
    std::fs::write(&c, b"abd").unwrap();
    // SHA-256("abc"), the standard test vector.
    assert_eq!(
        file_hash(&a).unwrap(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(file_hash(&a).unwrap(), file_hash(&b).unwrap());
    assert_ne!(file_hash(&a).unwrap(), file_hash(&c).unwrap());
    // A file larger than the read buffer hashes too.
    let big = dir.join("big.pdf");
    std::fs::write(&big, vec![7u8; 200_000]).unwrap();
    assert_eq!(file_hash(&big).unwrap().len(), 64);
    assert!(file_hash(&dir.join("missing.pdf")).is_err());
}
