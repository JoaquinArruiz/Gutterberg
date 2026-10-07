//! Vector-preserving export.
//!
//! Each used source page is wrapped (unmodified) as a Form XObject. Every card
//! is then painted on a new output page as:
//!
//! ```text
//! q  1 0 0 1 dx dy cm                  % pure translation: no scaling, no rasterising
//!    <card rect in source space> re W n   % clip, *after* cm so it moves too
//!    /Src Do
//! Q
//! ```
//!
//! so text, vector art and embedded images keep their original encoding.

use crate::error::{Error, Result};
use crate::geometry::{PageSize, Rect};
use crate::layout::{calculate_layout, GridLayout};
use crate::units::pt_to_mm;
use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};
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
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Export `input` according to `job`, writing `output`.
pub fn export_pdf(input: &Path, output: &Path, job: &ExportJob) -> Result<()> {
    let mut doc = Document::load(input)?;
    export_document(&mut doc, job)?;
    // Write beside the target, then rename, so a failed export never leaves a truncated file.
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

pub fn export_document(doc: &mut Document, job: &ExportJob) -> Result<()> {
    let source_pages = doc.get_pages();
    let pages_root = doc
        .catalog()?
        .get(b"Pages")
        .and_then(|p| p.as_reference())
        .map_err(|_| Error::Malformed("catalog has no /Pages".into()))?;

    let mut new_page_ids: Vec<Object> = Vec::new();
    // Cache so a source page used twice is wrapped only once.
    let mut forms: std::collections::HashMap<usize, (ObjectId, PageFrame)> = Default::default();

    for pj in &job.pages {
        let src_id = *source_pages
            .get(&(pj.page_index as u32 + 1))
            .ok_or(Error::PageOutOfRange(pj.page_index, source_pages.len()))?;
        let (form_id, frame) = match forms.get(&pj.page_index) {
            Some(v) => *v,
            None => {
                let frame = PageFrame::read(doc, src_id, pj.page_index)?;
                let id = page_to_form(doc, src_id, pj.page_index, &frame)?;
                forms.insert(pj.page_index, (id, frame));
                (id, frame)
            }
        };
        let bx = frame.display_box();
        let src_size = frame.size();
        let layout = calculate_layout(src_size, &pj.grid, None)?;
        let out = layout.output_page;
        if let Some(o) = layout.overflow {
            return Err(Error::DoesNotFit {
                needed_w_mm: pt_to_mm(out.width_pt) + o.width_mm,
                needed_h_mm: pt_to_mm(out.height_pt) + o.height_mm,
                page_w_mm: pt_to_mm(out.width_pt),
                page_h_mm: pt_to_mm(out.height_pt),
            });
        }

        let mut ops = String::new();
        for p in &layout.placements {
            // Layout is top-left origin; PDF is bottom-left.
            let src_left = bx[0] + p.source.x;
            let src_bottom = bx[3] - (p.source.y + p.source.height);
            let dst_left = p.destination.x;
            let dst_bottom = out.height_pt - (p.destination.y + p.destination.height);
            ops.push_str(&format!(
                "q\n1 0 0 1 {} {} cm\n{} {} {} {} re W n\n/Src Do\nQ\n",
                fmt(dst_left - src_left),
                fmt(dst_bottom - src_bottom),
                fmt(src_left),
                fmt(src_bottom),
                fmt(p.source.width),
                fmt(p.source.height),
            ));
        }
        let mut cs = Stream::new(Dictionary::new(), ops.into_bytes());
        let _ = cs.compress();
        let content_id = doc.add_object(cs);

        let page = dictionary! {
            "Type" => "Page",
            "Parent" => pages_root,
            "MediaBox" => vec![0.into(), 0.into(), Object::Real(out.width_pt as f32), Object::Real(out.height_pt as f32)],
            "Resources" => dictionary! { "XObject" => dictionary! { "Src" => form_id } },
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

/// Convenience for diagnostics: card size in mm of a rect in points.
pub fn rect_mm(r: &Rect) -> (f64, f64) {
    (pt_to_mm(r.width), pt_to_mm(r.height))
}
