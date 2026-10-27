//! Fill with AI, the picture side: what is sent for one piece, and what is kept of the answer.
//!
//! ```text
//! piece (rendered) --frame--> [magenta band | piece] (+ mask) --model--> picture --keep_band--> band only
//! ```
//!
//! The piece is drawn at print resolution and set in a frame larger by the bleed on every side, the band
//! painted flat magenta; for a server that only draws at fixed sizes the frame is padded (also magenta) to
//! that shape. The mask is opaque over the piece and clear where the model may paint. Of the answer only
//! the band is kept, at the size it was sent, with the piece's own area left clear: the model can never
//! change the piece, and the export draws the piece's original vector content over it anyway.

use crate::error::{Error, Result};
use image::{imageops, DynamicImage, ImageFormat, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::path::{Path, PathBuf};

/// The colour of the band the model is asked to paint over.
pub const MAGENTA: [u8; 4] = [255, 0, 255, 255];

/// Largest picture accepted back (pixels per side).
const MAX_REPLY_SIDE: u32 = 8192;

/// Where the piece sits in what is sent, all in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Frame {
    /// The picture sent.
    pub width: u32,
    pub height: u32,
    /// The piece with its band (the canvas), inside the picture, scaled by `scale`.
    pub canvas_x: u32,
    pub canvas_y: u32,
    pub canvas_width: u32,
    pub canvas_height: u32,
    /// The canvas at the size it was drawn: the piece plus `inset` on every side.
    pub drawn_width: u32,
    pub drawn_height: u32,
    pub inset: u32,
}

/// What is sent for one piece.
#[derive(Debug, Clone, PartialEq)]
pub struct FillCanvas {
    /// The framed piece, PNG.
    pub picture: Vec<u8>,
    /// Opaque over the piece, clear elsewhere, PNG; the same size as `picture`.
    pub mask: Vec<u8>,
    pub frame: Frame,
    /// Names what was sent, so a fill is never used for a piece that has changed since.
    pub hash: String,
}

fn decode(bytes: &[u8]) -> Result<DynamicImage> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| Error::FillReply(e.to_string()))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_REPLY_SIDE);
    limits.max_image_height = Some(MAX_REPLY_SIDE);
    reader.limits(limits);
    reader.decode().map_err(|e| Error::FillReply(e.to_string()))
}

fn encode(img: &RgbaImage) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .map_err(|e| Error::Malformed(e.to_string()))?;
    Ok(out)
}

/// Frames `piece` (a PNG of the piece alone) for the model, with a band `inset` pixels wide. `size` is the
/// fixed size the server draws at (the canvas is scaled to fit it and centred), or `None` to send the canvas
/// as it is.
pub fn fill_canvas(piece: &[u8], inset: u32, size: Option<(u32, u32)>) -> Result<FillCanvas> {
    let piece = decode(piece)?.to_rgba8();
    let (drawn_width, drawn_height) = (piece.width() + 2 * inset, piece.height() + 2 * inset);
    // A piece with clear corners shows magenta there, to be painted too; its own pixels stay.
    let mut canvas = RgbaImage::from_pixel(drawn_width, drawn_height, Rgba(MAGENTA));
    imageops::overlay(&mut canvas, &piece, i64::from(inset), i64::from(inset));
    let (width, height) = size.unwrap_or((drawn_width, drawn_height));
    let scale = (f64::from(width) / f64::from(drawn_width))
        .min(f64::from(height) / f64::from(drawn_height));
    let (canvas_width, canvas_height) = if size.is_some() {
        (
            ((f64::from(drawn_width) * scale).round() as u32).clamp(1, width),
            ((f64::from(drawn_height) * scale).round() as u32).clamp(1, height),
        )
    } else {
        (drawn_width, drawn_height)
    };
    let frame = Frame {
        width,
        height,
        canvas_x: (width - canvas_width) / 2,
        canvas_y: (height - canvas_height) / 2,
        canvas_width,
        canvas_height,
        drawn_width,
        drawn_height,
        inset,
    };
    let scaled = if (canvas_width, canvas_height) == (drawn_width, drawn_height) {
        canvas
    } else {
        imageops::resize(
            &canvas,
            canvas_width,
            canvas_height,
            imageops::FilterType::Lanczos3,
        )
    };
    let mut picture = RgbaImage::from_pixel(width, height, Rgba(MAGENTA));
    imageops::replace(
        &mut picture,
        &scaled,
        i64::from(frame.canvas_x),
        i64::from(frame.canvas_y),
    );
    let mut mask = RgbaImage::from_pixel(width, height, Rgba([0, 0, 0, 0]));
    let (x0, y0, x1, y1) = piece_box(&frame);
    for y in y0..y1 {
        for x in x0..x1 {
            mask.put_pixel(x, y, Rgba([0, 0, 0, 255]));
        }
    }
    let picture = encode(&picture)?;
    let hash: String = Sha256::digest(&picture)
        .iter()
        .take(6)
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok(FillCanvas {
        mask: encode(&mask)?,
        picture,
        frame,
        hash,
    })
}

/// The piece's own pixels in the picture sent: `[x0, y0, x1, y1)`.
fn piece_box(f: &Frame) -> (u32, u32, u32, u32) {
    let sx = f64::from(f.canvas_width) / f64::from(f.drawn_width);
    let sy = f64::from(f.canvas_height) / f64::from(f.drawn_height);
    let x0 = f.canvas_x + (f64::from(f.inset) * sx).round() as u32;
    let y0 = f.canvas_y + (f64::from(f.inset) * sy).round() as u32;
    let x1 = f.canvas_x + (f64::from(f.drawn_width - f.inset) * sx).round() as u32;
    let y1 = f.canvas_y + (f64::from(f.drawn_height - f.inset) * sy).round() as u32;
    (x0, y0, x1.max(x0), y1.max(y0))
}

/// Of the picture that came back, the band only: the canvas at the size it was drawn, with the piece's own
/// area clear. Refused when it is not a picture, or not the shape that was sent.
pub fn keep_band(reply: &[u8], frame: &Frame) -> Result<Vec<u8>> {
    let img = decode(reply)?.to_rgba8();
    let sent = f64::from(frame.width) / f64::from(frame.height);
    let got = f64::from(img.width()) / f64::from(img.height().max(1));
    if (got / sent - 1.0).abs() > 0.02 {
        return Err(Error::FillReply(format!(
            "it is {}×{} px, another shape than the {}×{} px sent",
            img.width(),
            img.height(),
            frame.width,
            frame.height
        )));
    }
    let img = if (img.width(), img.height()) == (frame.width, frame.height) {
        img
    } else {
        imageops::resize(
            &img,
            frame.width,
            frame.height,
            imageops::FilterType::Lanczos3,
        )
    };
    let canvas = imageops::crop_imm(
        &img,
        frame.canvas_x,
        frame.canvas_y,
        frame.canvas_width,
        frame.canvas_height,
    )
    .to_image();
    let mut band = if (canvas.width(), canvas.height()) == (frame.drawn_width, frame.drawn_height) {
        canvas
    } else {
        imageops::resize(
            &canvas,
            frame.drawn_width,
            frame.drawn_height,
            imageops::FilterType::Lanczos3,
        )
    };
    let i = frame.inset;
    for y in i..frame.drawn_height - i {
        for x in i..frame.drawn_width - i {
            band.put_pixel(x, y, Rgba([0, 0, 0, 0]));
        }
    }
    for p in band.pixels_mut() {
        if p.0[3] != 0 {
            p.0[3] = 255;
        }
    }
    encode(&band)
}

/// The piece (a PNG) over its band (a PNG from [`keep_band`]): how the fill looks, for the review.
pub fn with_band(piece: &[u8], band: &[u8], inset: u32) -> Result<Vec<u8>> {
    let mut out = decode(band)?.to_rgba8();
    let piece = decode(piece)?.to_rgba8();
    imageops::overlay(&mut out, &piece, i64::from(inset), i64::from(inset));
    encode(&out)
}

/// The width and height of a fill's picture, and whether it is a picture at all (the export's check).
pub fn fill_size(png: &[u8]) -> Result<(u32, u32)> {
    let img = decode(png)?;
    Ok((img.width(), img.height()))
}

/// The folder of a project's fills: beside its file, named after it (`my-game.gtr-fills`).
pub fn fills_dir(project: &Path) -> PathBuf {
    let mut name = project.file_name().unwrap_or_default().to_os_string();
    name.push("-fills");
    project.with_file_name(name)
}

/// The file name of the fill of the piece `key` (`g:0:3:1:2`), from the hash of what was sent.
pub fn fill_name(key: &str, hash: &str) -> String {
    let clean = |s: &str| -> String {
        s.chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect()
    };
    format!("{}-{}.png", clean(key), clean(hash))
}

/// Writes the fill (a PNG from [`keep_band`]) of the piece `key` into the fills folder of `project`, and
/// returns its file name.
pub fn save_fill(project: &Path, key: &str, png: &[u8], hash: &str) -> Result<String> {
    fill_size(png)?;
    let dir = fills_dir(project);
    std::fs::create_dir_all(&dir)?;
    let name = fill_name(key, hash);
    std::fs::write(dir.join(&name), png)?;
    Ok(name)
}

/// Copies the fills `names` of the project `from` beside the project `to` (Save As). A name that is not
/// plain, or a file that is not there, is skipped; returns how many were copied.
pub fn copy_fills(from: &Path, to: &Path, names: &[String]) -> Result<usize> {
    let (source, target) = (fills_dir(from), fills_dir(to));
    if source == target {
        return Ok(0);
    }
    let mut copied = 0;
    for name in names {
        let plain = Path::new(name)
            .file_name()
            .is_some_and(|n| n.to_string_lossy() == *name);
        let file = source.join(name);
        if !plain || !file.is_file() {
            continue;
        }
        std::fs::create_dir_all(&target)?;
        std::fs::copy(&file, target.join(name))?;
        copied += 1;
    }
    Ok(copied)
}
