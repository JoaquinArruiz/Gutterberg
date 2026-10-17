//! The print request built from a project in Rust is the one the UI built before it moved here.
//!
//! Each `tests/data/print-requests/<name>.gtr` is a project; `<name>.expected.json` holds the page sizes it was
//! planned with and the request `src/lib/print-request.ts` built for it (generated once, when the step moved into
//! `card-core`). Together they cover the plan modes, the sheet sizes, several grids, freeform pieces, piece edits,
//! backs and gutterfold, an images document, a migrated older project and a hand-edited one. The two `contract`
//! requests are also `print_request.json` and `print_request_freeform.json`, which `sheets.rs` plans from.

use card_core::card::DocumentId;
use card_core::geometry::PageSize;
use card_core::print_request::{print_project, print_request, PrintRequest};
use card_core::project::read_project;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

#[derive(Deserialize)]
struct Expected {
    pages: HashMap<DocumentId, Vec<PageSize>>,
    request: PrintRequest,
}

/// The request as JSON, with the backs in a fixed order (the planner looks them up by piece).
fn normalized(request: &PrintRequest) -> Value {
    let mut r = request.clone();
    r.finishing.backs.sort_by_key(|p| (p.card, p.back));
    serde_json::to_value(r).unwrap()
}

/// `a` and `b` are the same JSON, numbers within a rounding error.
fn same(a: &Value, b: &Value, at: &str) -> Result<(), String> {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            ((x - y).abs() <= 1e-9 * x.abs().max(1.0))
                .then_some(())
                .ok_or(format!("{at}: {x} != {y}"))
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Err(format!("{at}: {} items != {}", x.len(), y.len()));
            }
            x.iter()
                .zip(y)
                .enumerate()
                .try_for_each(|(i, (x, y))| same(x, y, &format!("{at}[{i}]")))
        }
        (Value::Object(x), Value::Object(y)) => {
            let keys = |m: &serde_json::Map<String, Value>| {
                let mut k: Vec<_> = m.keys().cloned().collect();
                k.sort();
                k
            };
            if keys(x) != keys(y) {
                return Err(format!("{at}: keys {:?} != {:?}", keys(x), keys(y)));
            }
            x.iter()
                .try_for_each(|(k, v)| same(v, &y[k], &format!("{at}.{k}")))
        }
        _ => (a == b).then_some(()).ok_or(format!("{at}: {a} != {b}")),
    }
}

#[test]
fn every_project_gives_the_request_the_ui_built() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/print-requests");
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| {
            let name = e.unwrap().file_name().to_string_lossy().into_owned();
            name.strip_suffix(".gtr").map(str::to_owned)
        })
        .collect();
    names.sort();
    assert!(names.len() >= 7, "fixtures missing: {names:?}");
    for name in names {
        let body = read_project(&dir.join(format!("{name}.gtr"))).unwrap();
        let expected: Expected = serde_json::from_str(
            &std::fs::read_to_string(dir.join(format!("{name}.expected.json"))).unwrap(),
        )
        .unwrap();
        let project = print_project(&body).unwrap();
        let built = print_request(&project, &expected.pages).unwrap();
        if let Err(e) = same(&normalized(&built), &normalized(&expected.request), &name) {
            panic!("{e}");
        }
    }
}

fn simple_grid() -> (
    card_core::print_request::PrintProject,
    HashMap<DocumentId, Vec<PageSize>>,
) {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/print-requests");
    let body = read_project(&dir.join("simple-grid.gtr")).unwrap();
    let expected: Expected = serde_json::from_str(
        &std::fs::read_to_string(dir.join("simple-grid.expected.json")).unwrap(),
    )
    .unwrap();
    (print_project(&body).unwrap(), expected.pages)
}

#[test]
fn a_grid_group_with_no_region_drawn_is_left_out() {
    let (mut project, pages) = simple_grid();
    for g in &mut project.documents[0].groups {
        if let card_core::print_request::ProjectGroup::Grid { grids, .. } = g {
            grids[0].selection = None;
        }
    }
    let req = print_request(&project, &pages).unwrap();
    assert!(req.documents[0].groups.is_empty());
}

#[test]
fn backs_on_the_other_side_keep_same_as_source_and_gutterfold_does_not() {
    use card_core::finish::BackLayout;
    use card_core::sheet::PrintLayout;
    let (mut project, pages) = simple_grid();
    project.plan.finish.duplex.on = true;
    let req = print_request(&project, &pages).unwrap();
    assert_eq!(req.layout, PrintLayout::SameAsSource);
    project.plan.finish.duplex.layout = BackLayout::Gutterfold;
    let req = print_request(&project, &pages).unwrap();
    assert!(matches!(req.layout, PrintLayout::Grid { .. }));
}
