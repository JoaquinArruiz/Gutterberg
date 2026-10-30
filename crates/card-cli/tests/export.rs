//! `gutterberg-cli` writes the PDF the app's Export writes for the same project, and stops where the app would ask.
//!
//! The app builds the request from the page sizes pdfium shows, the command line from the sizes in the files
//! (`lopdf`); with pdfium available (`PDFIUM_LIB_PATH`), the export from the app's sizes is compared too.

use card_core::card::DocumentId;
use card_core::geometry::PageSize;
use card_core::print_request::{export_files, print_project, print_request};
use card_core::project::{file_hash, parse_project};
use card_core::render::{bind_pdfium, document_info};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

fn examples() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples")
}

/// A fresh folder for one test.
fn dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("gutterberg-cli-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn cli(args: &[&str]) -> (bool, String, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_gutterberg-cli"))
        .args(args)
        .output()
        .unwrap();
    (
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn pdf(id: DocumentId, file: &str, pages: usize, groups: Value, freeform: Value) -> Value {
    let path = examples().join(file);
    json!({
        "kind": "pdf", "id": id, "path": path.to_string_lossy(), "hash": file_hash(&path).unwrap(),
        "pageCount": pages, "groups": groups, "freeform": freeform, "viewedPage": 0
    })
}

fn grid(first: usize, last: usize, rows: usize, columns: usize) -> Value {
    json!({
        "kind": "grid", "pages": { "first": first, "last": last },
        "grids": [{
            "grid": { "rows": rows, "columns": columns, "sourceGapXMm": 0, "sourceGapYMm": 0, "sourceGapLinked": true },
            "selection": { "x": 0.05, "y": 0.05, "width": 0.9, "height": 0.9 }
        }]
    })
}

fn no_region(first: usize, last: usize) -> Value {
    let mut g = grid(first, last, 1, 1);
    g["grids"][0]["selection"] = Value::Null;
    g
}

fn finish(duplex: Value) -> Value {
    let mut d = json!({
        "on": false, "layout": "duplex", "fold": "vertical", "foldGapMm": 0, "cutApart": false,
        "backUpsideDown": null, "flip": "long", "offsetXMm": 0, "offsetYMm": 0, "commonBack": null
    });
    d.as_object_mut()
        .unwrap()
        .extend(duplex.as_object().unwrap().clone());
    json!({
        "marks": { "style": "ticks", "widthMm": 0.25, "color": "#000000", "lengthMm": 3, "offsetMm": 1 },
        "bleed": { "mm": 1, "source": "mirror" },
        "duplex": d
    })
}

fn project(documents: Vec<Value>, edits: Value, plan: Value) -> Value {
    let mut p = json!({
        "format": "gutterberg-project", "version": 7, "documents": documents, "activeDocument": 0,
        "output": {
            "gapXMm": 3, "gapYMm": 3, "gapLinked": true, "pageMode": "a4", "orientation": "portrait",
            "customWidthMm": 210, "customHeightMm": 297, "margins": { "top": 5, "right": 5, "bottom": 5, "left": 5 }
        },
        "edits": edits,
        "plan": {
            "mode": "all", "quantities": {}, "autoFill": false, "order": "grouped", "groupBySize": true,
            "sheetGrid": "auto", "rows": 3, "columns": 3, "finish": finish(json!({}))
        }
    });
    p["plan"]
        .as_object_mut()
        .unwrap()
        .extend(plan.as_object().unwrap().clone());
    p
}

fn no_edits() -> Value {
    json!({ "turns": {}, "scales": {}, "order": [], "backs": {} })
}

fn save(dir: &Path, name: &str, p: &Value) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, serde_json::to_string_pretty(p).unwrap()).unwrap();
    path
}

/// The project's export straight from `card-core`, with the page sizes `sizes` gives each PDF.
fn direct_export(
    p: &Value,
    files: &[(DocumentId, PathBuf)],
    sizes: impl Fn(&Path) -> Vec<PageSize>,
    output: &Path,
) {
    let body = parse_project(&p.to_string()).unwrap();
    let pages: HashMap<DocumentId, Vec<PageSize>> =
        files.iter().map(|(id, f)| (*id, sizes(f))).collect();
    let req = print_request(&print_project(&body).unwrap(), &pages).unwrap();
    let inputs: Vec<(DocumentId, &Path)> = files.iter().map(|(id, f)| (*id, f.as_path())).collect();
    export_files(&req, &inputs, output).unwrap();
}

fn file_sizes(f: &Path) -> Vec<PageSize> {
    let doc = lopdf::Document::load(f).unwrap();
    card_core::export::page_sizes(&doc)
        .into_iter()
        .map(Result::unwrap)
        .collect()
}

/// Exports `p` with the command line and straight from `card-core`, with the files' page sizes and (when pdfium is
/// there) the ones the app shows, and checks the three PDFs are the same bytes.
fn same_as_the_app(name: &str, p: &Value, files: &[(DocumentId, PathBuf)]) {
    let d = dir(name);
    let gtr = save(&d, "project.gtr", p);
    let out = d.join("cli.pdf");
    let (ok, stdout, stderr) = cli(&["export", gtr.to_str().unwrap(), "-o", out.to_str().unwrap()]);
    assert!(ok, "{name}: {stderr}");
    assert!(stdout.starts_with("wrote "), "{stdout}");
    let cli_bytes = std::fs::read(&out).unwrap();

    let from_files = d.join("direct.pdf");
    direct_export(p, files, file_sizes, &from_files);
    assert!(
        cli_bytes == std::fs::read(&from_files).unwrap(),
        "{name}: differs from card-core"
    );

    match bind_pdfium(&[]) {
        Ok(pdfium) => {
            let from_app = d.join("app.pdf");
            let shown = |f: &Path| document_info(&pdfium, f).unwrap().pages;
            for (_, f) in files {
                assert_eq!(
                    shown(f),
                    file_sizes(f),
                    "{name}: pdfium and lopdf see different pages in {f:?}"
                );
            }
            direct_export(p, files, shown, &from_app);
            assert!(
                cli_bytes == std::fs::read(&from_app).unwrap(),
                "{name}: differs from the app's sizes"
            );
        }
        Err(_) => {
            eprintln!("SKIPPED the app's page sizes: pdfium not available (set PDFIUM_LIB_PATH)")
        }
    }
}

#[test]
fn a_grid_project_exports_as_the_app_does() {
    let p = project(
        vec![pdf(
            0,
            "01-default-3x3-a4.pdf",
            1,
            json!([grid(0, 0, 3, 3)]),
            json!({}),
        )],
        json!({ "turns": { "g:0:0:0:0": 90 }, "scales": { "g:0:0:1:1": 0.9 }, "order": [], "backs": {} }),
        json!({ "mode": "custom", "quantities": { "g:0:0:0:0": 2, "g:0:0:1:1": 3, "g:0:0:2:2": 1 } }),
    );
    same_as_the_app("grid", &p, &[(0, examples().join("01-default-3x3-a4.pdf"))]);
}

#[test]
fn dotted_cut_marks_export_as_the_app_does() {
    let mut p = project(
        vec![pdf(
            0,
            "01-default-3x3-a4.pdf",
            1,
            json!([grid(0, 0, 3, 3)]),
            json!({}),
        )],
        no_edits(),
        json!({}),
    );
    p["plan"]["finish"]["marks"]["line"] = json!("dotted");
    same_as_the_app(
        "dotted",
        &p,
        &[(0, examples().join("01-default-3x3-a4.pdf"))],
    );
    // `dir` would empty the folder `same_as_the_app` wrote to.
    let out = std::env::temp_dir().join(format!(
        "gutterberg-cli-test-{}-dotted/cli.pdf",
        std::process::id()
    ));
    let doc = lopdf::Document::load(out).unwrap();
    let id = *doc.get_pages().values().next().unwrap();
    assert!(
        card_core::export::drawn_content(&doc, id).contains("1 J"),
        "round dots"
    );
}

#[test]
fn fronts_and_backs_of_two_pdfs_and_freeform_pieces_export_as_the_app_does() {
    let tilted = json!({ "0": [{ "center": { "x": 0.5, "y": 0.5 }, "width": 0.3, "height": 0.2, "angle_deg": 4 }] });
    let p = project(
        vec![
            pdf(0, "10-fronts.pdf", 1, json!([grid(0, 0, 3, 3)]), json!({})),
            pdf(1, "11-backs.pdf", 1, json!([grid(0, 0, 3, 3)]), json!({})),
            // A page with no grid drawn, and one tilted piece drawn by hand.
            pdf(
                2,
                "05-rotated-page-90.pdf",
                1,
                json!([no_region(0, 0)]),
                tilted,
            ),
        ],
        json!({
            "turns": {}, "scales": {}, "order": [],
            "backs": { "g:0:0:0:0": "g:1:0:0:2", "g:0:0:0:1": "g:1:0:0:1", "g:0:0:0:2": "g:1:0:0:0" }
        }),
        json!({
            "mode": "custom",
            "quantities": { "g:0:0:0:0": 1, "g:0:0:0:1": 1, "g:0:0:0:2": 1, "f:2:0:0": 2 },
            "finish": finish(json!({ "on": true, "layout": "gutterfold", "fold": "vertical", "foldGapMm": 1 }))
        }),
    );
    same_as_the_app(
        "backs",
        &p,
        &[
            (0, examples().join("10-fronts.pdf")),
            (1, examples().join("11-backs.pdf")),
            (2, examples().join("05-rotated-page-90.pdf")),
        ],
    );
}

/// The colour spaces of the pictures in the PDF at `path`, once each.
fn image_spaces(path: &Path) -> Vec<String> {
    let doc = lopdf::Document::load(path).unwrap();
    let mut spaces: Vec<String> = doc
        .objects
        .values()
        .filter_map(|o| o.as_stream().ok())
        .filter(|s| s.dict.get(b"Subtype").and_then(|t| t.as_name()).ok() == Some(b"Image"))
        .filter_map(|s| s.dict.get(b"ColorSpace").and_then(|c| c.as_name()).ok())
        .map(|n| String::from_utf8_lossy(n).into_owned())
        .collect();
    spaces.sort();
    spaces.dedup();
    spaces
}

#[test]
fn a_project_of_images_exports_without_pdfium() {
    let d = dir("images");
    let png = d.join("card.png");
    image::RgbImage::from_fn(63, 88, |x, y| image::Rgb([x as u8 * 4, y as u8 * 2, 128]))
        .save(&png)
        .unwrap();
    let placement =
        json!({ "widthMm": 63, "heightMm": 88, "bleedMm": 0, "fit": "fit", "reduceLarge": true });
    let image = json!({ "path": png.to_string_lossy(), "hash": file_hash(&png).unwrap(), "placement": placement });
    let p = project(
        vec![json!({
            "kind": "images", "id": 0, "name": "Proxies", "images": [image.clone(), image], "pageCount": 2,
            "groups": [{
                "kind": "grid", "pages": { "first": 0, "last": 1 },
                "grids": [{
                    "grid": { "rows": 1, "columns": 1, "sourceGapXMm": 0, "sourceGapYMm": 0, "sourceGapLinked": true },
                    "selection": { "x": 0, "y": 0, "width": 1, "height": 1 }
                }]
            }],
            "freeform": {}, "viewedPage": 0
        })],
        no_edits(),
        json!({}),
    );
    let gtr = save(&d, "images.gtr", &p);
    let out = d.join("sheets.pdf");
    let (ok, stdout, stderr) = cli(&["export", gtr.to_str().unwrap(), "-o", out.to_str().unwrap()]);
    assert!(ok, "{stderr}");
    assert_eq!(stdout.trim(), format!("wrote 1 sheet to {}", out.display()));
    assert_eq!(lopdf::Document::load(&out).unwrap().get_pages().len(), 1);
    assert_eq!(image_spaces(&out), ["DeviceRGB"]);

    // A CMYK export turns the images' pictures CMYK, and the marks too.
    let mut cmyk = p.clone();
    cmyk["plan"]["finish"]["colors"] = json!("cmyk");
    let gtr_cmyk = save(&d, "images-cmyk.gtr", &cmyk);
    let (ok, _, stderr) = cli(&[
        "export",
        gtr_cmyk.to_str().unwrap(),
        "-o",
        out.to_str().unwrap(),
    ]);
    assert!(ok, "{stderr}");
    assert_eq!(image_spaces(&out), ["DeviceCMYK"]);
    let written = lopdf::Document::load(&out).unwrap();
    let page = *written.get_pages().get(&1).unwrap();
    assert!(String::from_utf8_lossy(&written.get_page_content(page)).contains("0 0 0 1 K"));

    // A missing image leaves its page blank, as in the app, and says so.
    std::fs::remove_file(&png).unwrap();
    let (ok, _, stderr) = cli(&["export", gtr.to_str().unwrap(), "-o", out.to_str().unwrap()]);
    assert!(ok, "{stderr}");
    assert!(
        stderr.contains("warning: the image card.png is not at"),
        "{stderr}"
    );
}

#[test]
fn a_changed_pdf_stops_the_export_unless_forced() {
    let d = dir("changed");
    let copy = d.join("game.pdf");
    std::fs::copy(examples().join("01-default-3x3-a4.pdf"), &copy).unwrap();
    let mut doc = pdf(
        0,
        "01-default-3x3-a4.pdf",
        1,
        json!([grid(0, 0, 3, 3)]),
        json!({}),
    );
    doc["path"] = json!(copy.to_string_lossy());
    doc["hash"] = json!("0".repeat(64));
    let gtr = save(&d, "game.gtr", &project(vec![doc], no_edits(), json!({})));
    let out = d.join("sheets.pdf");
    let args = ["export", gtr.to_str().unwrap(), "-o", out.to_str().unwrap()];

    let (ok, _, stderr) = cli(&args);
    assert!(!ok);
    assert!(
        stderr.contains("game.pdf is not the file the project was saved with"),
        "{stderr}"
    );
    assert!(stderr.contains("(pdf_changed)"), "{stderr}");
    assert!(!out.exists());

    let (ok, _, stderr) = cli(&[&args[..], &["--force"]].concat());
    assert!(ok, "{stderr}");
    assert!(stderr.starts_with("warning: the PDF game.pdf"), "{stderr}");
    assert!(out.exists());

    // The output may not be one of the PDFs it is made from.
    let (ok, _, stderr) = cli(&[
        "export",
        gtr.to_str().unwrap(),
        "-o",
        copy.to_str().unwrap(),
        "--force",
    ]);
    assert!(!ok && stderr.contains("(same_file)"), "{stderr}");
}

#[test]
fn check_says_what_an_export_writes_or_what_stops_it_and_writes_nothing() {
    let d = dir("check");
    let ok_project = project(
        vec![pdf(
            0,
            "01-default-3x3-a4.pdf",
            1,
            json!([grid(0, 0, 3, 3)]),
            json!({}),
        )],
        no_edits(),
        json!({}),
    );
    let gtr = save(&d, "fine.gtr", &ok_project);
    let (ok, stdout, _) = cli(&["check", gtr.to_str().unwrap()]);
    assert!(ok);
    assert_eq!(stdout.trim(), "ok: an export writes 1 sheet");
    assert_eq!(std::fs::read_dir(&d).unwrap().count(), 1);

    // A PDF that is gone.
    let mut gone = ok_project.clone();
    gone["documents"][0]["path"] = json!(d.join("nowhere.pdf").to_string_lossy());
    let gtr = save(&d, "gone.gtr", &gone);
    let (ok, _, stderr) = cli(&["check", gtr.to_str().unwrap()]);
    assert!(!ok && stderr.contains("(pdf_missing)"), "{stderr}");

    // The same PDF beside the project, under another name: a shared project finds it.
    std::fs::copy(
        examples().join("01-default-3x3-a4.pdf"),
        d.join("cards.pdf"),
    )
    .unwrap();
    let (ok, stdout, stderr) = cli(&["check", gtr.to_str().unwrap()]);
    assert!(ok, "{stderr}");
    assert_eq!(stdout.trim(), "ok: an export writes 1 sheet");
    std::fs::remove_file(d.join("cards.pdf")).unwrap();

    // Not a project, and a project from a newer Gutterberg: the app's own codes.
    std::fs::write(d.join("notes.gtr"), "hello").unwrap();
    let (ok, _, stderr) = cli(&["check", d.join("notes.gtr").to_str().unwrap()]);
    assert!(!ok && stderr.contains("(not_a_project)"), "{stderr}");
    let mut newer = ok_project;
    newer["version"] = json!(999);
    let gtr = save(&d, "newer.gtr", &newer);
    let (ok, _, stderr) = cli(&["check", gtr.to_str().unwrap()]);
    assert!(!ok && stderr.contains("(project_too_new)"), "{stderr}");
}

#[test]
fn usage_mistakes_exit_with_2() {
    let out = Command::new(env!("CARGO_BIN_EXE_gutterberg-cli"))
        .args(["export", "game.gtr"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("-o <file.pdf>"));
    let (ok, stdout, _) = cli(&["--version"]);
    assert!(ok && stdout.starts_with("gutterberg-cli "));
}
