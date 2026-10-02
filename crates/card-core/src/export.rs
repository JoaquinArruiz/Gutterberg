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

/// Page box used as the coordinate frame (CropBox if present, else MediaBox),
/// as `[x0, y0, x1, y1]`.
fn page_box(doc: &Document, page_id: ObjectId) -> Result<[f64; 4]> {
    let mut current = page_id;
    // Walk up /Parent for inherited attributes.
    for _ in 0..32 {
        let dict = doc.get_dictionary(current)?;
        for key in [&b"CropBox"[..], &b"MediaBox"[..]] {
            if let Ok(obj) = dict.get(key) {
                let arr = doc.dereference(obj)?.1.as_array()?;
                if arr.len() == 4 {
                    let mut v = [0.0; 4];
                    for (i, o) in arr.iter().enumerate() {
                        v[i] = doc.dereference(o)?.1.as_float()? as f64;
                    }
                    return Ok([v[0].min(v[2]), v[1].min(v[3]), v[0].max(v[2]), v[1].max(v[3])]);
                }
            }
        }
        match dict.get(b"Parent").and_then(|p| p.as_reference()) {
            Ok(parent) => current = parent,
            Err(_) => break,
        }
    }
    Err(Error::Malformed("page has no MediaBox".into()))
}

fn inherited_rotate(doc: &Document, page_id: ObjectId) -> i64 {
    let mut current = page_id;
    for _ in 0..32 {
        let Ok(dict) = doc.get_dictionary(current) else { return 0 };
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

/// Source page size in points (what the UI normalises against).
pub fn page_size(doc: &Document, page_index: usize) -> Result<PageSize> {
    let pages = doc.get_pages();
    let id = *pages
        .get(&(page_index as u32 + 1))
        .ok_or(Error::PageOutOfRange(page_index, pages.len()))?;
    let b = page_box(doc, id)?;
    Ok(PageSize { width_pt: b[2] - b[0], height_pt: b[3] - b[1] })
}

/// Build the Form XObject that stands in for a whole source page.
fn page_to_form(doc: &mut Document, page_id: ObjectId, bbox: [f64; 4]) -> Result<ObjectId> {
    let content = doc.get_page_content(page_id);

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

    let dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Form",
        "FormType" => 1,
        "BBox" => bbox.iter().map(|v| Object::Real(*v as f32)).collect::<Vec<_>>(),
        "Resources" => Object::Dictionary(resources),
    };
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
    doc.save(output)?;
    Ok(())
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
    let mut forms: std::collections::HashMap<usize, (ObjectId, [f64; 4])> = Default::default();

    for pj in &job.pages {
        let src_id = *source_pages
            .get(&(pj.page_index as u32 + 1))
            .ok_or(Error::PageOutOfRange(pj.page_index, source_pages.len()))?;
        let rot = inherited_rotate(doc, src_id);
        if rot != 0 {
            return Err(Error::UnsupportedRotation(pj.page_index, rot));
        }
        let (form_id, bx) = match forms.get(&pj.page_index) {
            Some(v) => *v,
            None => {
                let bx = page_box(doc, src_id)?;
                let id = page_to_form(doc, src_id, bx)?;
                forms.insert(pj.page_index, (id, bx));
                (id, bx)
            }
        };
        let src_size = PageSize { width_pt: bx[2] - bx[0], height_pt: bx[3] - bx[1] };
        let layout = calculate_layout(src_size, &pj.grid, None)?;
        let out = layout.output_page;

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

    let root = doc.get_dictionary_mut(pages_root)?;
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
