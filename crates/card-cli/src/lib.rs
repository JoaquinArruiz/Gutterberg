//! Gutterberg's command line: export a saved project, or check it, without opening the app.
//!
//! ```text
//! gutterberg-cli export my-game.gtr -o my-game-sheets.pdf
//! gutterberg-cli check my-game.gtr
//! ```
//!
//! It reads the project as the app opens it (`card_core::project`), finds its PDFs and images, builds the print
//! request in `card_core::print_request` and exports with the app's own planner, so the file it writes is the one the
//! app's Export writes. It needs no pdfium and no window: page sizes come from the PDFs themselves (`lopdf`).

use card_core::card::DocumentId;
use card_core::export::{page_sizes, same_file, same_file_error};
use card_core::geometry::PageSize;
use card_core::images::{images_document, ImageSpec, Placement};
use card_core::print_request::{
    export_files, plan_files, print_project, print_request, PrintRequest,
};
use card_core::project::{file_hash, read_project};
use card_core::{ErrorInfo, ErrorParam};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const USAGE: &str = "\
Usage:
  gutterberg-cli export <project.gtr> -o <sheets.pdf> [--force]
  gutterberg-cli check <project.gtr> [--force]

Commands:
  export     Write the project's sheets to a PDF, as the app's Export does
  check      Say what an export would refuse, without writing anything

Options:
  -o, --output <file>  The PDF to write (export only)
  --force              Go on when a PDF or image is not the file the project was saved with
  -h, --help           Show this help
  -V, --version        Show the version

Settings (sheet size, gaps, copies...) are the ones saved in the project: open it in Gutterberg to change them.";

/// What the command line was asked to do.
#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    Export {
        project: PathBuf,
        output: PathBuf,
        force: bool,
    },
    Check {
        project: PathBuf,
        force: bool,
    },
    Help,
    Version,
}

/// Reads the arguments (without the program name). An error is a usage message.
pub fn parse_args<I: IntoIterator<Item = String>>(args: I) -> Result<Command, String> {
    let mut args = args.into_iter();
    let Some(first) = args.next() else {
        return Ok(Command::Help);
    };
    match first.as_str() {
        "-h" | "--help" | "help" => return Ok(Command::Help),
        "-V" | "--version" => return Ok(Command::Version),
        "export" | "check" => {}
        other => return Err(format!("unknown command '{other}'")),
    }
    let (mut project, mut output, mut force) = (None, None, false);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--force" => force = true,
            "-o" | "--output" if first == "export" => {
                output = Some(PathBuf::from(
                    args.next().ok_or("-o needs the PDF to write")?,
                ));
            }
            a if a.starts_with('-') => return Err(format!("unknown option '{a}'")),
            a if project.is_none() => project = Some(PathBuf::from(a)),
            a => return Err(format!("unexpected argument '{a}'")),
        }
    }
    let project = project.ok_or("say which project (a .gtr file)")?;
    if first == "check" {
        return Ok(Command::Check { project, force });
    }
    let output = output.ok_or("say where to write the sheets with -o <file.pdf>")?;
    Ok(Command::Export {
        project,
        output,
        force,
    })
}

/// Where the files of a document are, as the project saved them.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum DocumentFiles {
    Pdf {
        id: DocumentId,
        path: String,
        hash: String,
    },
    Images {
        id: DocumentId,
        name: String,
        images: Vec<SavedImage>,
    },
}

#[derive(Debug, Deserialize)]
struct SavedImage {
    path: String,
    hash: String,
    placement: Placement,
}

#[derive(Debug, Deserialize)]
struct ProjectFiles {
    documents: Vec<DocumentFiles>,
}

/// A project read from disk with its files found: ready to plan or export.
pub struct Loaded {
    pub request: PrintRequest,
    /// The PDF of each document of the request, in its order.
    pub files: Vec<(DocumentId, PathBuf)>,
    /// What the user should know but does not stop the export (a changed file with `--force`, a missing image).
    pub warnings: Vec<String>,
    /// The display name of each document, for messages.
    pub names: HashMap<DocumentId, String>,
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map_or_else(|| path.to_string(), |n| n.to_string_lossy().into_owned())
}

fn failure(code: &str, message: String) -> ErrorInfo {
    ErrorInfo::new(code, &message)
}

/// Reads the project at `path` and finds its files. A PDF that is gone stops it; a PDF or image that is not the file
/// the project was saved with stops it unless `force`. A missing image leaves its page blank, as in the app.
/// `cache` is where the PDF of an images document is built.
pub fn load(path: &Path, force: bool, cache: &Path) -> Result<Loaded, ErrorInfo> {
    let body = read_project(path)?;
    let project = print_project(&body)?;
    let files: ProjectFiles =
        serde_json::from_value(serde_json::Value::Object(body)).map_err(|e| {
            failure(
                "not_a_project",
                format!("the project's files cannot be read: {e}"),
            )
        })?;
    let mut warnings = Vec::new();
    let mut paths: HashMap<DocumentId, PathBuf> = HashMap::new();
    let mut names = HashMap::new();
    let changed = |what: &str, name: &str| {
        format!("{what} {name} is not the file the project was saved with, so the pieces may not be where they were")
    };
    for d in &files.documents {
        match d {
            DocumentFiles::Pdf { id, path, hash } => {
                let name = file_name(path);
                let file = PathBuf::from(path);
                if !file.is_file() {
                    let mut e = failure(
                        "pdf_missing",
                        format!(
                            "{name} is not at {path}: open the project in Gutterberg to find it"
                        ),
                    );
                    e.params.insert("name".into(), ErrorParam::Text(name));
                    return Err(e);
                }
                if file_hash(&file)? != *hash {
                    let message = changed("the PDF", &name);
                    if !force {
                        let mut e = failure(
                            "pdf_changed",
                            format!("{message}; add --force to export anyway"),
                        );
                        e.params
                            .insert("name".into(), ErrorParam::Text(name.clone()));
                        return Err(e);
                    }
                    warnings.push(message);
                }
                names.insert(*id, name);
                paths.insert(*id, file);
            }
            DocumentFiles::Images { id, name, images } => {
                let mut specs = Vec::with_capacity(images.len());
                for image in images {
                    let image_name = file_name(&image.path);
                    let file = Path::new(&image.path);
                    let missing = !file.is_file();
                    if missing {
                        warnings.push(format!(
                            "the image {image_name} is not at {}: its page is left blank",
                            image.path
                        ));
                    } else if file_hash(file)? != image.hash {
                        let message = changed("the image", &image_name);
                        if !force {
                            let mut e = failure(
                                "image_changed",
                                format!("{message}; add --force to export anyway"),
                            );
                            e.params.insert("name".into(), ErrorParam::Text(image_name));
                            return Err(e);
                        }
                        warnings.push(message);
                    }
                    specs.push(ImageSpec {
                        path: image.path.clone(),
                        hash: image.hash.clone(),
                        placement: image.placement,
                        missing,
                    });
                }
                names.insert(*id, name.clone());
                paths.insert(*id, images_document(&specs, cache)?);
            }
        }
    }
    let mut pages: HashMap<DocumentId, Vec<PageSize>> = HashMap::new();
    for (id, file) in &paths {
        let doc = lopdf::Document::load(file).map_err(card_core::Error::from)?;
        // A page that cannot be read is reported by the check, as in the app.
        let sizes = page_sizes(&doc)
            .into_iter()
            .map(|s| {
                s.unwrap_or(PageSize {
                    width_pt: 0.0,
                    height_pt: 0.0,
                })
            })
            .collect();
        pages.insert(*id, sizes);
    }
    let request = print_request(&project, &pages)?;
    let files = request
        .documents
        .iter()
        .map(|d| {
            paths
                .get(&d.document_id)
                .map(|p| (d.document_id, p.clone()))
                .ok_or_else(|| {
                    failure(
                        "not_a_project",
                        format!("document {} has no file", d.document_id),
                    )
                })
        })
        .collect::<Result<_, _>>()?;
    Ok(Loaded {
        request,
        files,
        warnings,
        names,
    })
}

fn borrowed(files: &[(DocumentId, PathBuf)]) -> Vec<(DocumentId, &Path)> {
    files.iter().map(|(id, p)| (*id, p.as_path())).collect()
}

/// What `check` found: how many sheets an export writes, or the pages that stop it.
pub struct Checked {
    pub sheets: usize,
    pub problems: Vec<String>,
}

/// Plans the sheets as the export does and lists what would stop it. An error is a plan that does not work at all
/// (pieces that do not fit the sheet, ...).
pub fn check(loaded: &Loaded) -> Result<Checked, ErrorInfo> {
    let (sheets, issues) = plan_files(&loaded.request, &borrowed(&loaded.files))?;
    let problems = issues
        .iter()
        .map(|i| {
            let name = loaded
                .names
                .get(&i.document_id)
                .map_or_else(String::new, |n| format!(" of {n}"));
            format!(
                "page {}{name}: {} ({})",
                i.page_index + 1,
                i.message,
                i.code
            )
        })
        .collect::<Vec<_>>();
    if problems.is_empty() && sheets.is_empty() {
        return Err(ErrorInfo::new(
            "nothing_to_print",
            "there is nothing to print",
        ));
    }
    Ok(Checked {
        sheets: sheets.len(),
        problems,
    })
}

/// Exports the sheets to `output`. Returns the number of sheets written.
pub fn export(loaded: &Loaded, output: &Path) -> Result<usize, ErrorInfo> {
    if loaded
        .files
        .iter()
        .any(|(_, input)| same_file(input, output))
    {
        return Err(same_file_error());
    }
    export_files(&loaded.request, &borrowed(&loaded.files), output)
}

/// An error as the command line prints it: the message, then its code (the same one the app uses).
pub fn describe(e: &ErrorInfo) -> String {
    format!("{} ({})", e.message, e.code)
}
