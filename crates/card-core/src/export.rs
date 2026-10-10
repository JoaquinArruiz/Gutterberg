//! Vector-preserving export.
//!
//! Each used source page is wrapped (unmodified) as a Form XObject. Every card
//! is then painted on a new output page through a small form of its own, whose
//! `/BBox` is the card's area on the page:
//!
//! ```text
//! q  1 0 0 1 dx dy cm                  % pure translation: no scaling, no rasterising
//!    /C12 Do                           % the card's form: BBox = the card rect, and inside it
//!                                      %   <card rect in source space> re W n   (clip, after cm)
//!                                      %   /Src Do
//! Q
//! ```
//!
//! so text, vector art and embedded images keep their original encoding. The page is still
//! stored once; the card form adds a few bytes and is shared by every copy of that card. Its
//! tight box lets a viewer draw only the card's area instead of the whole page for each card,
//! which is faster and avoids the whole page flashing up before the clip applies.

use crate::access;
use crate::card::{DocumentId, PageGroup, PageGroupKind, DEFAULT_DOCUMENT_ID};
use crate::error::{Error, ErrorInfo, ErrorParam, Result};
use crate::finish::{bleed_regions, finish_sheets, Finishing, SheetMarks};
use crate::geometry::{PageSize, Rect};
use crate::layout::{calculate_fitting_layout, GridLayout, LayoutResult};
use crate::sheet::{
    card_transform, plan_print_in, sheet_from_layout, Affine, CardSetting, DocumentSource,
    OutputSheet, PaginateOptions, PrintLayout, SheetPlacement,
};
use crate::units::{mm_to_pt, pt_to_mm};
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

/// One output page, built from one source page with its own grid. Keeping the
/// grid per page leaves room for mixed layouts later.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageJob {
    /// 0-based source page index.
    pub page_index: usize,
    pub grid: GridLayout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportJob {
    pub pages: Vec<PageJob>,
}

/// Cap on decompressed page content, so a small hostile stream can't exhaust memory.
const MAX_CONTENT_BYTES: usize = 256 * 1024 * 1024;

/// A box attribute (`MediaBox`, `CropBox`) of the page, inherited through `/Parent`.
fn inherited_box(
    doc: &Document,
    page_id: ObjectId,
    page_index: usize,
    key: &[u8],
) -> Result<Option<[f64; 4]>> {
    let mut current = page_id;
    for _ in 0..32 {
        let dict = doc.get_dictionary(current)?;
        if let Ok(obj) = dict.get(key) {
            let name = String::from_utf8_lossy(key);
            let bad = || Error::Malformed(format!("page {}: invalid /{name}", page_index + 1));
            let arr = doc.dereference(obj)?.1.as_array().map_err(|_| bad())?;
            if arr.len() != 4 {
                return Err(bad());
            }
            let mut v = [0.0; 4];
            for (i, o) in arr.iter().enumerate() {
                v[i] = doc.dereference(o)?.1.as_float().map_err(|_| bad())? as f64;
            }
            return Ok(Some([
                v[0].min(v[2]),
                v[1].min(v[3]),
                v[0].max(v[2]),
                v[1].max(v[3]),
            ]));
        }
        match dict.get(b"Parent").and_then(|p| p.as_reference()) {
            Ok(parent) => current = parent,
            Err(_) => break,
        }
    }
    Ok(None)
}

/// The visible page box `[x0, y0, x1, y1]`: CropBox intersected with MediaBox (as pdfium
/// does), each resolved separately with inheritance.
fn page_box(doc: &Document, page_id: ObjectId, page_index: usize) -> Result<[f64; 4]> {
    let media = inherited_box(doc, page_id, page_index, b"MediaBox")?
        .ok_or_else(|| Error::Malformed(format!("page {} has no MediaBox", page_index + 1)))?;
    let b = match inherited_box(doc, page_id, page_index, b"CropBox")? {
        Some(c) => [
            c[0].max(media[0]),
            c[1].max(media[1]),
            c[2].min(media[2]),
            c[3].min(media[3]),
        ],
        None => media,
    };
    if b[2] - b[0] <= 0.0 || b[3] - b[1] <= 0.0 {
        return Err(Error::Malformed(format!(
            "page {} has an empty page box (CropBox and MediaBox do not overlap)",
            page_index + 1
        )));
    }
    Ok(b)
}

fn inherited_rotate(doc: &Document, page_id: ObjectId) -> i64 {
    let mut current = page_id;
    for _ in 0..32 {
        let Ok(dict) = doc.get_dictionary(current) else {
            return 0;
        };
        if let Ok(r) = dict.get(b"Rotate") {
            if let Ok((_, o)) = doc.dereference(r) {
                if let Ok(v) = o.as_i64() {
                    return v.rem_euclid(360);
                }
            }
        }
        match dict.get(b"Parent").and_then(|p| p.as_reference()) {
            Ok(p) => current = p,
            Err(_) => return 0,
        }
    }
    0
}

/// How a source page is shown: its box in page space and its clockwise `/Rotate`.
/// Everything the UI and the layout see (sizes, selection bounds) is in the displayed,
/// rotated frame.
#[derive(Debug, Clone, Copy)]
struct PageFrame {
    raw: [f64; 4],
    rotate: i64,
}

impl PageFrame {
    fn read(doc: &Document, page_id: ObjectId, page_index: usize) -> Result<Self> {
        let rotate = inherited_rotate(doc, page_id);
        if rotate % 90 != 0 {
            return Err(Error::UnsupportedRotation(page_index, rotate));
        }
        if let Ok(u) = doc.get_dictionary(page_id)?.get(b"UserUnit") {
            let unit = doc.dereference(u)?.1.as_float().unwrap_or(1.0);
            if (unit - 1.0).abs() > 1e-6 {
                return Err(Error::UnsupportedUserUnit(page_index, unit as f64));
            }
        }
        Ok(Self {
            raw: page_box(doc, page_id, page_index)?,
            rotate,
        })
    }

    fn size(&self) -> PageSize {
        let (w, h) = (self.raw[2] - self.raw[0], self.raw[3] - self.raw[1]);
        if self.rotate % 180 == 0 {
            PageSize {
                width_pt: w,
                height_pt: h,
            }
        } else {
            PageSize {
                width_pt: h,
                height_pt: w,
            }
        }
    }

    /// The frame cards are laid out in: the raw box when unrotated, else the displayed page
    /// with its origin at (0, 0).
    fn display_box(&self) -> [f64; 4] {
        if self.rotate == 0 {
            self.raw
        } else {
            let s = self.size();
            [0.0, 0.0, s.width_pt, s.height_pt]
        }
    }

    /// Form `/Matrix` that turns the raw box upright (clockwise `rotate`), landing it on
    /// `display_box`. None when unrotated.
    fn matrix(&self) -> Option<[f64; 6]> {
        let [x0, y0, x1, y1] = self.raw;
        match self.rotate {
            90 => Some([0.0, -1.0, 1.0, 0.0, -y0, x1]),
            180 => Some([-1.0, 0.0, 0.0, -1.0, x1, y1]),
            270 => Some([0.0, 1.0, -1.0, 0.0, y1, -x0]),
            _ => None,
        }
    }
}

/// Displayed source page size in points (what the UI normalises against).
pub fn page_size(doc: &Document, page_index: usize) -> Result<PageSize> {
    let pages = doc.get_pages();
    let id = *pages
        .get(&(page_index as u32 + 1))
        .ok_or(Error::PageOutOfRange(page_index, pages.len()))?;
    Ok(PageFrame::read(doc, id, page_index)?.size())
}

/// Decompress the page's content streams. A stream that can't be decoded is an error
/// (not copied raw), and the total is capped.
fn page_content(doc: &Document, page_id: ObjectId, page_index: usize) -> Result<Vec<u8>> {
    let fail = |e: lopdf::Error| {
        Error::Malformed(format!(
            "page {}: cannot decode its content ({e})",
            page_index + 1
        ))
    };
    let mut content = Vec::new();
    for id in doc.get_page_contents(page_id) {
        let stream = doc
            .get_object(id)
            .and_then(Object::as_stream)
            .map_err(fail)?;
        let remaining = MAX_CONTENT_BYTES.saturating_sub(content.len());
        let data = stream
            .decompressed_content_with_limit(remaining)
            .map_err(fail)?;
        content.extend_from_slice(&data);
        content.push(b'\n');
    }
    Ok(content)
}

/// Build the Form XObject that stands in for a whole source page.
fn page_to_form(
    doc: &mut Document,
    page_id: ObjectId,
    page_index: usize,
    frame: &PageFrame,
) -> Result<ObjectId> {
    let content = page_content(doc, page_id, page_index)?;

    // Merge inherited resources: nearest definition of each category wins.
    let (own, inherited_ids) = doc.get_page_resources(page_id)?;
    let mut resources = Dictionary::new();
    let mut layers: Vec<Dictionary> = Vec::new();
    if let Some(d) = own {
        layers.push(d.clone());
    }
    for id in inherited_ids {
        layers.push(doc.get_dictionary(id)?.clone());
    }
    for layer in layers {
        for (k, v) in layer.iter() {
            if !resources.has(k) {
                resources.set(k.clone(), v.clone());
            }
        }
    }

    let reals = |v: &[f64]| {
        v.iter()
            .map(|x| Object::Real(*x as f32))
            .collect::<Vec<_>>()
    };
    let mut dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Form",
        "FormType" => 1,
        "BBox" => reals(&frame.raw),
        "Resources" => Object::Dictionary(resources),
    };
    if let Some(m) = frame.matrix() {
        dict.set("Matrix", reals(&m));
    }
    // Keep transparency blending (colour space, isolated/knockout) as the page had it.
    if let Ok(group) = doc.get_dictionary(page_id)?.get(b"Group") {
        dict.set("Group", group.clone());
    }
    let mut stream = Stream::new(dict, content);
    let _ = stream.compress();
    Ok(doc.add_object(stream))
}

fn fmt(v: f64) -> String {
    let s = format!("{v:.4}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" {
        "0".into()
    } else {
        s.to_string()
    }
}

/// Write `doc` beside `output`, then rename, so a failed export never leaves a truncated file.
fn save_atomically(doc: &mut Document, output: &Path) -> Result<()> {
    let name = output
        .file_name()
        .ok_or_else(|| Error::Malformed("output path has no file name".into()))?
        .to_string_lossy();
    let tmp = output.with_file_name(format!(".{name}.{}.tmp", std::process::id()));
    let result = doc
        .save(&tmp)
        .map(|_| ())
        .map_err(Error::from)
        .and_then(|()| std::fs::rename(&tmp, output).map_err(Error::from));
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Export `input` according to `job`, writing `output`.
pub fn export_pdf(input: &Path, output: &Path, job: &ExportJob) -> Result<()> {
    let mut doc = Document::load(input)?;
    let sources = [(DEFAULT_DOCUMENT_ID, &doc)];
    access::check_sources(&sources)?;
    let permissions = access::output_permissions(&sources);
    export_document(&mut doc, job)?;
    if let Some(p) = permissions {
        access::apply_permissions(&mut doc, p, DEFAULT_DOCUMENT_ID)?;
    }
    save_atomically(&mut doc, output)
}

/// Export `sheets` built from the single document at `input` (document id 0), writing `output`.
pub fn export_sheets_file(input: &Path, output: &Path, sheets: &[OutputSheet]) -> Result<()> {
    export_sheets_files(&[(DEFAULT_DOCUMENT_ID, input)], output, sheets)
}

/// Export `sheets` built from several PDFs, each at its `document_id`, writing `output`. The
/// first file is the base: its metadata is kept.
pub fn export_sheets_files(
    inputs: &[(DocumentId, &Path)],
    output: &Path,
    sheets: &[OutputSheet],
) -> Result<()> {
    let sources = inputs
        .iter()
        .map(|(id, path)| Ok((*id, Document::load(path)?)))
        .collect::<Result<Vec<_>>>()?;
    let loaded: Vec<(DocumentId, &Document)> = sources.iter().map(|(id, d)| (*id, d)).collect();
    access::check_sources(&loaded)?;
    let permissions = access::output_permissions(&loaded);
    let base = sources.first().map_or(DEFAULT_DOCUMENT_ID, |(id, _)| *id);
    let mut doc = export_sheets(sources, sheets)?;
    if let Some(p) = permissions {
        access::apply_permissions(&mut doc, p, base)?;
    }
    save_atomically(&mut doc, output)
}

/// The displayed size of every page of `doc`: what the layout and export work from. A page that
/// cannot be exported (unsupported rotation, unreadable boxes) is an `Err` for that page only.
pub fn page_sizes(doc: &Document) -> Vec<Result<PageSize>> {
    (0..doc.get_pages().len())
        .map(|page_index| page_size(doc, page_index))
        .collect()
}

/// The layout of one page, or the reason it cannot be exported. Cards that do not fit
/// the output page are an error, never shrunk.
fn fitting_layout(frame: &PageFrame, grid: &GridLayout) -> Result<LayoutResult> {
    calculate_fitting_layout(frame.size(), grid)
}

/// A page that would make the export fail, found before anything is written.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PageIssue {
    /// Which open PDF the page is in.
    #[serde(default)]
    pub document_id: DocumentId,
    /// 0-based source page index.
    pub page_index: usize,
    pub message: String,
    /// What went wrong as a stable code with its values (see [`ErrorInfo`]), so the UI can word it in
    /// its own language; `message` is the English fallback.
    #[serde(default)]
    pub code: String,
    #[serde(default, flatten)]
    pub params: std::collections::BTreeMap<String, ErrorParam>,
}

impl PageIssue {
    pub fn new(page_index: usize, error: &Error) -> Self {
        let info = ErrorInfo::from(error);
        Self {
            document_id: DEFAULT_DOCUMENT_ID,
            page_index,
            message: info.message,
            code: info.code,
            params: info.params,
        }
    }

    /// The same issue, in the PDF open as `document_id`.
    pub fn in_document(mut self, document_id: DocumentId) -> Self {
        self.document_id = document_id;
        self
    }
}

/// Checks every job the way [`export_document`] will, and returns one issue per page
/// that would fail (a missing page, an unsupported page, an invalid grid or cards that
/// do not fit). An empty list means the export will not fail on layout.
pub fn validate_export(doc: &Document, jobs: &[PageJob]) -> Vec<PageIssue> {
    let source_pages = doc.get_pages();
    let mut issues: Vec<PageIssue> = Vec::new();
    for pj in jobs {
        // One issue per page, even when several jobs list it.
        if issues.iter().any(|i| i.page_index == pj.page_index) {
            continue;
        }
        let checked = source_pages
            .get(&(pj.page_index as u32 + 1))
            .ok_or(Error::PageOutOfRange(pj.page_index, source_pages.len()))
            .and_then(|&id| PageFrame::read(doc, id, pj.page_index))
            .and_then(|frame| fitting_layout(&frame, &pj.grid));
        if let Err(e) = checked {
            issues.push(PageIssue::new(pj.page_index, &e));
        }
    }
    issues
}

/// Checks that every source page the sheets draw from can be wrapped, as [`export_sheets`]
/// will: one issue per page that cannot (missing, rotated by something other than a quarter
/// turn, unreadable boxes, from a document that was not provided).
pub fn validate_sheets(doc: &Document, sheets: &[OutputSheet]) -> Vec<PageIssue> {
    validate_sheets_in(&[(DEFAULT_DOCUMENT_ID, doc)], sheets)
}

/// [`validate_sheets`] for sheets that draw from several documents.
pub fn validate_sheets_in(
    docs: &[(DocumentId, &Document)],
    sheets: &[OutputSheet],
) -> Vec<PageIssue> {
    let mut issues: Vec<PageIssue> = Vec::new();
    let mut seen: std::collections::HashSet<(DocumentId, usize)> = Default::default();
    for p in sheets.iter().flat_map(|s| &s.placements) {
        let key = (p.card_id.document_id(), p.card_id.page_index());
        if !seen.insert(key) {
            continue;
        }
        let checked = match docs.iter().find(|(id, _)| *id == key.0) {
            None => Err(Error::Malformed(format!(
                "document {} was not provided",
                key.0
            ))),
            Some((_, doc)) => {
                let source_pages = doc.get_pages();
                source_pages
                    .get(&(key.1 as u32 + 1))
                    .ok_or(Error::PageOutOfRange(key.1, source_pages.len()))
                    .and_then(|&id| PageFrame::read(doc, id, key.1))
                    .map(|_| ())
            }
        };
        if let Err(e) = checked {
            issues.push(PageIssue::new(key.1, &e).in_document(key.0));
        }
    }
    issues.sort_by_key(|i| (i.document_id, i.page_index));
    issues
}

/// Plans the print sheets from the PDF at `input` itself, the way the export will: page sizes
/// come from the file, and a page the groups use that the exporter cannot read is returned as an
/// issue (with no sheets) instead of failing the whole plan. Issues also cover sheets that draw
/// from unreadable pages, so an empty list means the export will not fail on the pages.
pub fn plan_print_file(
    input: &Path,
    groups: &[PageGroup],
    settings: &[CardSetting],
    layout: &PrintLayout,
    options: &PaginateOptions,
    finishing: &Finishing,
) -> Result<(Vec<OutputSheet>, Vec<PageIssue>)> {
    let file = SourceFile {
        document_id: DEFAULT_DOCUMENT_ID,
        path: input,
        groups,
    };
    plan_print_files(&[file], settings, layout, options, finishing)
}

/// One PDF of a project and the page groups that say where its cards are.
pub struct SourceFile<'a> {
    pub document_id: DocumentId,
    pub path: &'a Path,
    pub groups: &'a [PageGroup],
}

/// [`plan_print_file`] for a project with several PDFs: their cards share the sheets.
pub fn plan_print_files(
    files: &[SourceFile],
    settings: &[CardSetting],
    layout: &PrintLayout,
    options: &PaginateOptions,
    finishing: &Finishing,
) -> Result<(Vec<OutputSheet>, Vec<PageIssue>)> {
    let docs = files
        .iter()
        .map(|f| Document::load(f.path))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let locked: Vec<(DocumentId, &Document)> =
        files.iter().map(|f| f.document_id).zip(&docs).collect();
    access::check_sources(&locked)?;
    let mut issues = Vec::new();
    let mut sources = Vec::with_capacity(files.len());
    for (file, doc) in files.iter().zip(&docs) {
        let sizes = page_sizes(doc);
        for g in file.groups.iter().filter(|g| g.kind != PageGroupKind::Skip) {
            if g.pages.last >= sizes.len() {
                return Err(Error::PageOutOfRange(g.pages.last, sizes.len()));
            }
            for (page_index, size) in (g.pages.first..).zip(&sizes[g.pages.first..=g.pages.last]) {
                if let Err(e) = size {
                    issues.push(PageIssue::new(page_index, e).in_document(file.document_id));
                }
            }
        }
        // Pages nothing draws from may be unreadable; they never reach the planner.
        let pages: Vec<PageSize> = sizes
            .into_iter()
            .map(|s| {
                s.unwrap_or(PageSize {
                    width_pt: 0.0,
                    height_pt: 0.0,
                })
            })
            .collect();
        sources.push(DocumentSource {
            document_id: file.document_id,
            pages,
            groups: file.groups.to_vec(),
        });
    }
    if !issues.is_empty() {
        return Ok((Vec::new(), issues));
    }
    let planned = plan_print_in(&sources, settings, layout, options)?;
    let (sheets, mut issues) = finish_sheets(planned, &sources, finishing)?;
    let loaded: Vec<(DocumentId, &Document)> =
        files.iter().map(|f| f.document_id).zip(&docs).collect();
    issues.extend(validate_sheets_in(&loaded, &sheets));
    Ok((sheets, issues))
}

/// [`validate_export`] for the PDF at `input`.
pub fn validate_export_file(input: &Path, jobs: &[PageJob]) -> Result<Vec<PageIssue>> {
    let doc = Document::load(input)?;
    access::check_sources(&[(DEFAULT_DOCUMENT_ID, &doc)])?;
    Ok(validate_export(&doc, jobs))
}

/// The PDF `cm` matrix that places a card: `card` maps source to sheet in top-left page
/// coordinates (see [`card_transform`]); this carries that over to PDF space, where the form
/// is drawn in the source page's display frame `display_box` (bottom-left origin) and the
/// sheet is `out_height` points tall.
pub fn pdf_matrix(card: &Affine, display_box: [f64; 4], out_height: f64) -> [f64; 6] {
    let (left, top) = (display_box[0], display_box[3]);
    [
        card.m11,
        -card.m21,
        -card.m12,
        card.m22,
        -card.m11 * left + card.m12 * top + card.tx,
        out_height + card.m21 * left - card.m22 * top - card.ty,
    ]
}

/// The clip of one card in the page form's own space, and its bounding box there (the card
/// form's `/BBox`). The clip follows `cm`, so it moves with the card.
fn card_clip(p: &SheetPlacement, display_box: [f64; 4]) -> (String, [f64; 4]) {
    let (left, top) = (display_box[0], display_box[3]);
    match p.source.as_rect() {
        Some(r) => {
            let (x0, y0) = (left + r.x, top - (r.y + r.height));
            (
                format!(
                    "{} {} {} {} re W n",
                    fmt(x0),
                    fmt(y0),
                    fmt(r.width),
                    fmt(r.height)
                ),
                [x0, y0, x0 + r.width, y0 + r.height],
            )
        }
        None => {
            let pts = p.source.corners().map(|c| (left + c.x, top - c.y));
            let at = |i: usize| format!("{} {}", fmt(pts[i].0), fmt(pts[i].1));
            let xs = pts.map(|q| q.0);
            let ys = pts.map(|q| q.1);
            let lo = |v: [f64; 4]| v.into_iter().fold(f64::INFINITY, f64::min);
            let hi = |v: [f64; 4]| v.into_iter().fold(f64::NEG_INFINITY, f64::max);
            (
                format!("{} m {} l {} l {} l h W n", at(0), at(1), at(2), at(3)),
                [lo(xs), lo(ys), hi(xs), hi(ys)],
            )
        }
    }
}

/// The form that draws one card: the page form seen through the card's clip, with a `/BBox` no
/// larger than the card.
fn card_form(
    doc: &mut Document,
    page_name: &str,
    page_form: ObjectId,
    clip: &str,
    bbox: [f64; 4],
) -> ObjectId {
    let dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Form",
        "FormType" => 1,
        "BBox" => bbox.iter().map(|v| Object::Real(*v as f32)).collect::<Vec<_>>(),
        "Resources" => dictionary! {
            "XObject" => dictionary! { page_name.as_bytes().to_vec() => page_form },
        },
    };
    let mut stream = Stream::new(dict, format!("{clip}\n/{page_name} Do\n").into_bytes());
    let _ = stream.compress();
    doc.add_object(stream)
}

/// The content-stream operators that paint one card: move, then draw its card form.
fn placement_ops(card: &str, p: &SheetPlacement, display_box: [f64; 4], out_height: f64) -> String {
    let m = pdf_matrix(
        &card_transform(&p.source, p.scale, p.turn, &p.destination),
        display_box,
        out_height,
    );
    format!("q\n{} cm\n/{card} Do\nQ\n", m.map(fmt).join(" "))
}

/// Resource name of a card form.
fn card_form_name(id: ObjectId) -> String {
    format!("C{}", id.0)
}

/// The content of an exported page with every card form written out in place, as the page draws
/// it: `q <cm> <clip> /S0_0 Do Q` for each card. For tests and for looking into an exported file.
pub fn drawn_content(doc: &Document, page_id: ObjectId) -> String {
    let mut content = String::from_utf8_lossy(&doc.get_page_content(page_id)).into_owned();
    let Ok(xobjects) = doc
        .get_dictionary(page_id)
        .and_then(|p| p.get(b"Resources"))
        .and_then(|r| r.as_dict())
        .and_then(|r| r.get(b"XObject"))
        .and_then(|x| x.as_dict())
    else {
        return content;
    };
    for (name, value) in xobjects.iter() {
        if !name.starts_with(b"C") {
            continue;
        }
        let Some(Object::Stream(form)) = value
            .as_reference()
            .ok()
            .and_then(|id| doc.get_object(id).ok())
        else {
            continue;
        };
        let body = form
            .decompressed_content()
            .unwrap_or_else(|_| form.content.clone());
        let body = String::from_utf8_lossy(&body).trim_end().to_owned();
        content = content.replace(&format!("/{} Do", String::from_utf8_lossy(name)), &body);
    }
    content
}

/// The operators that paint the bleed around one piece: the page form again, once per region,
/// reflected over the piece's edge and seen only through the strip outside it.
fn bleed_ops(name: &str, p: &SheetPlacement, sheet: &OutputSheet, display_box: [f64; 4]) -> String {
    let m = pdf_matrix(
        &card_transform(&p.source, p.scale, p.turn, &p.destination),
        display_box,
        sheet.page.height_pt,
    );
    let (left, top) = (display_box[0], display_box[3]);
    // Source page coordinates are top-left; the page form's own space is PDF's (y up).
    let to_pdf = Affine {
        m11: 1.0,
        m12: 0.0,
        m21: 0.0,
        m22: -1.0,
        tx: left,
        ty: top,
    };
    let from_pdf = Affine {
        tx: -left,
        ty: top,
        ..to_pdf
    };
    let mut ops = String::new();
    for region in bleed_regions(&p.source, mm_to_pt(sheet.bleed.mm), sheet.bleed.source) {
        let at = |i: usize| {
            format!(
                "{} {}",
                fmt(left + region.quad[i].x),
                fmt(top - region.quad[i].y)
            )
        };
        ops.push_str(&format!(
            "q\n{} cm\n{} m {} l {} l {} l h W n\n",
            m.map(fmt).join(" "),
            at(0),
            at(1),
            at(2),
            at(3),
        ));
        if region.reflect != Affine::IDENTITY {
            let r = to_pdf.after(&region.reflect).after(&from_pdf);
            let operands = [r.m11, r.m21, r.m12, r.m22, r.tx, r.ty];
            ops.push_str(&format!("{} cm\n", operands.map(fmt).join(" ")));
        }
        ops.push_str(&format!("/{name} Do\nQ\n"));
    }
    ops
}

/// The operators that stroke the cut marks of a sheet `out_height` points tall.
fn marks_ops(marks: &SheetMarks, out_height: f64) -> String {
    let [r, g, b] = marks.color.map(|c| fmt(f64::from(c) / 255.0));
    let mut ops = format!("q\n{r} {g} {b} RG\n{} w\n", fmt(marks.width_pt));
    for l in &marks.lines {
        ops.push_str(&format!(
            "{} {} m {} {} l S\n",
            fmt(l[0]),
            fmt(out_height - l[1]),
            fmt(l[2]),
            fmt(out_height - l[3]),
        ));
    }
    ops.push_str("Q\n");
    ops
}

/// Resource name of the form that stands in for page `page_index` of `document_id`.
fn form_name(document_id: DocumentId, page_index: usize) -> String {
    format!("S{document_id}_{page_index}")
}

/// Build the output document in `doc`, whose pages become `sheets`. `doc` is source document
/// `base_id`; `others` are further sources, imported once into `doc` (their objects are
/// renumbered past `doc`'s) so every page form can live in one file.
fn export_sheets_into(
    doc: &mut Document,
    base_id: DocumentId,
    others: Vec<(DocumentId, Document)>,
    sheets: &[OutputSheet],
) -> Result<()> {
    let pages_root = doc
        .catalog()?
        .get(b"Pages")
        .and_then(|p| p.as_reference())
        .map_err(|_| Error::Malformed("catalog has no /Pages".into()))?;

    let mut page_tables: HashMap<DocumentId, BTreeMap<u32, ObjectId>> = HashMap::new();
    page_tables.insert(base_id, doc.get_pages());
    for (id, mut other) in others {
        if page_tables.contains_key(&id) {
            return Err(Error::Malformed(format!("document {id} was given twice")));
        }
        other.renumber_objects_with(doc.max_id + 1);
        page_tables.insert(id, other.get_pages());
        doc.max_id = doc.max_id.max(other.max_id);
        doc.objects.extend(other.objects);
    }

    let mut new_page_ids: Vec<Object> = Vec::new();
    // A source page used on several sheets (or several times on one) is wrapped only once.
    let mut forms: HashMap<(DocumentId, usize), (ObjectId, PageFrame)> = HashMap::new();
    // A card (the same page and clip) printed several times draws through one card form.
    let mut card_forms: HashMap<(DocumentId, usize, String), ObjectId> = HashMap::new();

    for sheet in sheets {
        let out = sheet.page;
        let mut xobjects = Dictionary::new();
        let mut prepared: Vec<(String, PageFrame, String)> =
            Vec::with_capacity(sheet.placements.len());
        for p in &sheet.placements {
            let key = (p.card_id.document_id(), p.card_id.page_index());
            let (form_id, frame) = match forms.get(&key) {
                Some(v) => *v,
                None => {
                    let table = page_tables.get(&key.0).ok_or_else(|| {
                        Error::Malformed(format!("document {} was not provided", key.0))
                    })?;
                    let src_id = *table
                        .get(&(key.1 as u32 + 1))
                        .ok_or(Error::PageOutOfRange(key.1, table.len()))?;
                    let frame = PageFrame::read(doc, src_id, key.1)?;
                    let id = page_to_form(doc, src_id, key.1, &frame)?;
                    forms.insert(key, (id, frame));
                    (id, frame)
                }
            };
            let name = form_name(key.0, key.1);
            xobjects.set(name.as_bytes().to_vec(), form_id);
            let (clip, bbox) = card_clip(p, frame.display_box());
            let card_id = *card_forms
                .entry((key.0, key.1, clip.clone()))
                .or_insert_with(|| card_form(doc, &name, form_id, &clip, bbox));
            let card = card_form_name(card_id);
            xobjects.set(card.as_bytes().to_vec(), card_id);
            prepared.push((name, frame, card));
        }
        // Bleed first, so a neighbour's bleed never paints over a piece; then the pieces; then
        // the marks.
        let mut ops = String::new();
        if sheet.bleed.mm > 0.0 {
            for (p, (name, frame, _)) in sheet.placements.iter().zip(&prepared) {
                ops.push_str(&bleed_ops(name, p, sheet, frame.display_box()));
            }
        }
        for (p, (_, frame, card)) in sheet.placements.iter().zip(&prepared) {
            ops.push_str(&placement_ops(card, p, frame.display_box(), out.height_pt));
        }
        if let Some(marks) = &sheet.marks {
            ops.push_str(&marks_ops(marks, out.height_pt));
        }
        let mut cs = Stream::new(Dictionary::new(), ops.into_bytes());
        let _ = cs.compress();
        let content_id = doc.add_object(cs);

        let page = dictionary! {
            "Type" => "Page",
            "Parent" => pages_root,
            "MediaBox" => vec![0.into(), 0.into(), Object::Real(out.width_pt as f32), Object::Real(out.height_pt as f32)],
            "Resources" => dictionary! { "XObject" => xobjects },
            "Contents" => content_id,
        };
        new_page_ids.push(Object::Reference(doc.add_object(page)));
    }

    // Drop what pointed into the old pages (outlines, destinations, form fields, ...) so
    // pruning removes the old pages and their content streams.
    let catalog_id = doc.trailer.get(b"Root").and_then(|r| r.as_reference())?;
    let names = doc
        .catalog()?
        .get(b"Names")
        .ok()
        .and_then(|n| n.as_reference().ok());
    let catalog = doc.get_dictionary_mut(catalog_id)?;
    for key in [
        &b"Outlines"[..],
        b"StructTreeRoot",
        b"AcroForm",
        b"OpenAction",
        b"Dests",
        b"PageLabels",
    ] {
        catalog.remove(key);
    }
    if let Ok(Object::Dictionary(n)) = catalog.get_mut(b"Names") {
        n.remove(b"Dests");
    }
    if let Some(id) = names {
        if let Ok(n) = doc.get_dictionary_mut(id) {
            n.remove(b"Dests");
        }
    }

    let root = doc.get_dictionary_mut(pages_root)?;
    // New pages define their own boxes; don't let the old root's inheritable attributes
    // rotate or crop them.
    for key in [&b"Rotate"[..], b"CropBox", b"MediaBox"] {
        root.remove(key);
    }
    root.set("Kids", Object::Array(new_page_ids.clone()));
    root.set("Count", new_page_ids.len() as i64);
    // Old page nodes are now unreachable; drop them (keeps shared fonts/images
    // that the forms still reference).
    doc.prune_objects();
    Ok(())
}

/// Build a PDF whose pages are `sheets`, from one or more source documents (keyed by the
/// `document_id` their cards carry). The first source is the base: its metadata is kept and
/// the others are imported into it. Page content is wrapped as forms, never rasterised.
pub fn export_sheets(
    sources: Vec<(DocumentId, Document)>,
    sheets: &[OutputSheet],
) -> Result<Document> {
    let mut sources = sources.into_iter();
    let (base_id, mut base) = sources
        .next()
        .ok_or_else(|| Error::Malformed("no source document was given".into()))?;
    export_sheets_into(&mut base, base_id, sources.collect(), sheets)?;
    Ok(base)
}

/// Re-space the pages of one document: each job becomes one sheet whose placements are
/// `calculate_layout`'s (all cards in order, sheet grid = source grid).
pub fn export_document(doc: &mut Document, job: &ExportJob) -> Result<()> {
    let source_pages = doc.get_pages();
    let mut sheets = Vec::with_capacity(job.pages.len());
    for pj in &job.pages {
        let src_id = *source_pages
            .get(&(pj.page_index as u32 + 1))
            .ok_or(Error::PageOutOfRange(pj.page_index, source_pages.len()))?;
        let frame = PageFrame::read(doc, src_id, pj.page_index)?;
        let layout = fitting_layout(&frame, &pj.grid)?;
        sheets.push(sheet_from_layout(
            DEFAULT_DOCUMENT_ID,
            pj.page_index,
            pj.grid.columns,
            &layout,
        ));
    }
    export_sheets_into(doc, DEFAULT_DOCUMENT_ID, Vec::new(), &sheets)
}

/// Convenience for diagnostics: card size in mm of a rect in points.
pub fn rect_mm(r: &Rect) -> (f64, f64) {
    (pt_to_mm(r.width), pt_to_mm(r.height))
}
