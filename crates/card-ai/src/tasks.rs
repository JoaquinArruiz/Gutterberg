//! "Detect pieces" with an AI engine: the fixed prompt, the schema of the reply, and the check that turns the
//! reply into the same `Proposal` the local engines make. The model is never trusted: anything that cannot
//! be a set of pieces on this page is an error, and confidence never goes above [`MAX_CONFIDENCE`].

use crate::error::{AiError, Result};
use crate::provider::{AiRequest, Image};
use card_core::card::OrientedRect;
use card_core::detect::{
    Detection, ObjectKind, PageObject, Proposal, ProposalKind, MIN_CONFIDENCE, MIN_PIECE_MM,
};
use card_core::geometry::{PageSize, Point, Rect};
use card_core::units::{mm_to_pt, pt_to_mm};
use serde_json::{json, Value};

/// An AI proposal never reads as better than "good".
pub const MAX_CONFIDENCE: f64 = 0.8;
/// Most pieces one page can have.
pub const MAX_PIECES: usize = 200;
/// Most rows or columns of a grid.
pub const MAX_GRID: i64 = 30;
/// Most objects described to the model when no picture is sent.
const MAX_OBJECTS: usize = 300;
const OUTPUT_TOKENS: u32 = 4096;
/// A shape may run this far past the page (a fraction) before it is called outside.
const SLACK: f64 = 0.01;

fn number(label: &str) -> Value {
    json!({ "type": label })
}

/// The schema of the reply. Flat on purpose: no unions and no nulls, which not every provider accepts.
pub fn detect_schema() -> Value {
    let n = || number("number");
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "kind": { "type": "string", "enum": ["grid", "rects", "none"] },
            "confidence": n(),
            "grid_x": n(), "grid_y": n(), "grid_width": n(), "grid_height": n(),
            "grid_rows": number("integer"), "grid_columns": number("integer"),
            "gap_x_mm": n(), "gap_y_mm": n(),
            "rects": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": { "cx": n(), "cy": n(), "width": n(), "height": n(), "angle_deg": n() },
                    "required": ["cx", "cy", "width", "height", "angle_deg"],
                },
            },
        },
        "required": [
            "kind", "confidence", "grid_x", "grid_y", "grid_width", "grid_height", "grid_rows",
            "grid_columns", "gap_x_mm", "gap_y_mm", "rects",
        ],
    })
}

const ANSWER_RULES: &str = "Find the individual pieces (cards, tokens, tiles) that would be cut out of the page, \
not the page border, margins, titles or art around them. All positions are fractions of the page width and \
height, from 0 to 1, with the origin at the top-left. If the pieces form a regular grid of equal pieces, answer \
kind \"grid\" with grid_x, grid_y, grid_width and grid_height for the box around all the pieces (gaps \
included), grid_rows, grid_columns, and gap_x_mm and gap_y_mm for the space between neighbouring pieces in \
millimetres (0 when they touch). Otherwise answer kind \"rects\" with one entry per piece: its centre cx, cy, its \
width and height along its own sides, and angle_deg, how far it is tilted clockwise (0 when upright). If there \
are no pieces, answer kind \"none\". Give confidence from 0 to 1. Fill the fields you do not use with 0, and \
rects with an empty list.";

fn boxes(page: PageSize, objects: &[PageObject]) -> Value {
    let round = |v: f64| (v * 10_000.0).round() / 10_000.0;
    let mut list: Vec<&PageObject> = objects.iter().collect();
    list.sort_by(|a, b| (b.rect.width * b.rect.height).total_cmp(&(a.rect.width * a.rect.height)));
    Value::Array(
        list.into_iter()
            .take(MAX_OBJECTS)
            .map(|o| {
                let kind = match o.kind {
                    ObjectKind::Image => "image",
                    ObjectKind::Rect => "rectangle",
                    ObjectKind::Line => "line",
                };
                json!({
                    "kind": kind,
                    "x": round(o.rect.x / page.width_pt),
                    "y": round(o.rect.y / page.height_pt),
                    "width": round(o.rect.width / page.width_pt),
                    "height": round(o.rect.height / page.height_pt),
                })
            })
            .collect(),
    )
}

/// The request for one page. With an `image` the model looks at the page; without one it is given the boxes
/// of the page's objects as text, and a page with no objects cannot be described that way.
pub fn detect_request(
    page: PageSize,
    image: Option<Image>,
    objects: &[PageObject],
) -> Result<AiRequest> {
    let (w, h) = (
        pt_to_mm(page.width_pt).round(),
        pt_to_mm(page.height_pt).round(),
    );
    let intro = match &image {
        Some(_) => format!(
            "The picture is one page of a print-and-play PDF, {w} mm wide and {h} mm tall. "
        ),
        None => {
            if objects.is_empty() {
                return Err(AiError::TextOnlyNeedsObjects);
            }
            format!(
                "You are given no picture. This is one page of a print-and-play PDF, {w} mm wide and {h} mm \
                 tall. These are the boxes of the images, rectangles and lines drawn on it, as fractions of the \
                 page: {}. ",
                boxes(page, objects)
            )
        }
    };
    Ok(AiRequest {
        instruction: format!("{intro}{ANSWER_RULES}"),
        images: image.into_iter().collect(),
        schema: detect_schema(),
        max_output_tokens: OUTPUT_TOKENS,
    })
}

fn field(v: &Value, name: &str) -> Result<f64> {
    v.get(name)
        .and_then(Value::as_f64)
        .filter(|x| x.is_finite())
        .ok_or_else(|| AiError::InvalidReply(format!("`{name}` is missing or not a number")))
}

fn invalid(detail: impl Into<String>) -> AiError {
    AiError::InvalidProposal(detail.into())
}

fn in_unit(name: &str, v: f64) -> Result<f64> {
    if (-SLACK..=1.0 + SLACK).contains(&v) {
        Ok(v.clamp(0.0, 1.0))
    } else {
        Err(invalid(format!("{name} is {v}, outside the page")))
    }
}

fn whole(name: &str, v: f64, max: i64) -> Result<usize> {
    if v.fract() == 0.0 && (1.0..=max as f64).contains(&v) {
        Ok(v as usize)
    } else {
        Err(invalid(format!(
            "{name} must be a whole number from 1 to {max}, not {v}"
        )))
    }
}

/// The reply as a detection of at most one proposal, or an error if it cannot be right for `page`.
pub fn parse_detect(reply: &Value, page: PageSize) -> Result<Detection> {
    let kind = reply
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| AiError::InvalidReply("`kind` is missing".into()))?;
    let said = field(reply, "confidence")?;
    let confidence = said.clamp(MIN_CONFIDENCE, MAX_CONFIDENCE);
    let min_pt = mm_to_pt(MIN_PIECE_MM);
    let kind = match kind {
        "none" => return Ok(Detection::default()),
        "grid" => {
            let x = in_unit("grid_x", field(reply, "grid_x")?)?;
            let y = in_unit("grid_y", field(reply, "grid_y")?)?;
            let w = field(reply, "grid_width")?;
            let h = field(reply, "grid_height")?;
            if !(w > 0.0 && h > 0.0) {
                return Err(invalid("the grid has no size"));
            }
            in_unit("the right edge of the grid", x + w)?;
            in_unit("the bottom edge of the grid", y + h)?;
            let rows = whole("grid_rows", field(reply, "grid_rows")?, MAX_GRID)?;
            let columns = whole("grid_columns", field(reply, "grid_columns")?, MAX_GRID)?;
            let (gx, gy) = (field(reply, "gap_x_mm")?, field(reply, "gap_y_mm")?);
            if !(0.0..=50.0).contains(&gx) || !(0.0..=50.0).contains(&gy) {
                return Err(invalid("a gap is not between 0 and 50 mm"));
            }
            let (bw, bh) = ((x + w).min(1.0) - x, (y + h).min(1.0) - y);
            let bounds = Rect::new(
                x * page.width_pt,
                y * page.height_pt,
                bw * page.width_pt,
                bh * page.height_pt,
            );
            let cell_w = (bounds.width - mm_to_pt(gx) * (columns - 1) as f64) / columns as f64;
            let cell_h = (bounds.height - mm_to_pt(gy) * (rows - 1) as f64) / rows as f64;
            if cell_w < min_pt || cell_h < min_pt {
                return Err(invalid(format!(
                    "the pieces would be under {MIN_PIECE_MM} mm"
                )));
            }
            ProposalKind::Grid {
                bounds,
                rows,
                columns,
                source_gap_x_mm: gx,
                source_gap_y_mm: gy,
            }
        }
        "rects" => {
            let list = reply
                .get("rects")
                .and_then(Value::as_array)
                .ok_or_else(|| AiError::InvalidReply("`rects` is missing".into()))?;
            if list.is_empty() || list.len() > MAX_PIECES {
                return Err(invalid(format!(
                    "{} pieces: expected 1 to {MAX_PIECES}",
                    list.len()
                )));
            }
            let mut rects = Vec::with_capacity(list.len());
            for r in list {
                let (cx, cy) = (
                    in_unit("cx", field(r, "cx")?)?,
                    in_unit("cy", field(r, "cy")?)?,
                );
                let (mut w, mut h) = (
                    field(r, "width")? * page.width_pt,
                    field(r, "height")? * page.height_pt,
                );
                // The tilt is kept within 45 degrees of upright; a quarter turn swaps the sides.
                let raw = field(r, "angle_deg")?;
                let quarters = ((raw + 45.0) / 90.0).floor();
                let angle = raw - 90.0 * quarters;
                if (quarters as i64).rem_euclid(2) == 1 {
                    std::mem::swap(&mut w, &mut h);
                }
                if !(w >= min_pt && h >= min_pt) {
                    return Err(invalid(format!("a piece is under {MIN_PIECE_MM} mm")));
                }
                let rect = OrientedRect {
                    center: Point {
                        x: cx * page.width_pt,
                        y: cy * page.height_pt,
                    },
                    width: w,
                    height: h,
                    angle_deg: angle,
                };
                let (slack_x, slack_y) = (SLACK * page.width_pt, SLACK * page.height_pt);
                if rect.corners().iter().any(|c| {
                    c.x < -slack_x
                        || c.y < -slack_y
                        || c.x > page.width_pt + slack_x
                        || c.y > page.height_pt + slack_y
                }) {
                    return Err(invalid("a piece reaches outside the page"));
                }
                rects.push(rect);
            }
            ProposalKind::Rects { rects }
        }
        other => return Err(AiError::InvalidReply(format!("unknown kind `{other}`"))),
    };
    Ok(Detection {
        proposals: vec![Proposal {
            kind,
            confidence,
            engine: "ai".into(),
            notes: Vec::new(),
        }],
        reasons: Vec::new(),
    })
}
