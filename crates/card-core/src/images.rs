//! Images as pieces: a PNG, JPEG or WebP file becomes one page of a small PDF, so everything after
//! "open a document" (page view, grids, the piece library, the sheets, export) works on it unchanged.
//!
//! The pixels are kept as they came: a JPEG goes in as its own `DCTDecode` stream byte for byte,
//! PNG and WebP are decoded and stored losslessly (`FlateDecode`, with transparency as an `SMask`),
//! and only a matrix scales the image onto the page. The one exception is the opt-in reduction of
//! PNG and WebP images above [`REDUCED_DPI`], which the user asks for.
//!
//! The generated PDF is a cache: it lives under a name made from the images and how they are placed
//! ([`images_cache_key`]), so it can always be built again from the images.

use crate::error::{Error, Result};
use crate::geometry::Rect;
use crate::units::{mm_to_pt, MM_PER_INCH, PT_PER_INCH};
use image::{DynamicImage, ImageDecoder};
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::path::{Path, PathBuf};

/// Largest image accepted, in megapixels.
pub const MAX_MEGAPIXELS: f64 = 100.0;
/// Largest file accepted.
pub const MAX_FILE_BYTES: u64 = 200 * 1024 * 1024;
/// Below this resolution (pixels per inch at the printed size) an image may print a little soft.
pub const SOFT_BELOW_DPI: f64 = 300.0;
/// Below this it will look blurry.
pub const BLURRY_BELOW_DPI: f64 = 150.0;
/// Above this the image is much sharper than any printer needs, and the PDF it adds is large.
pub const VERY_LARGE_ABOVE_DPI: f64 = 1200.0;
/// What "Reduce very large images" shrinks PNG and WebP images to.
pub const REDUCED_DPI: f64 = 600.0;
/// An image whose proportions differ from the piece's by more than this is not stretched to it.
pub const PROPORTION_TOLERANCE: f64 = 0.01;

/// Bumped when the generated PDF changes, so old cached files are not reused.
const BUILD_VERSION: &str = "images-1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    Jpeg,
    Png,
    Webp,
}

/// What is known about an image file without decoding its pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageProbe {
    pub path: String,
    pub name: String,
    pub format: ImageFormat,
    /// Size in pixels as the image is shown (the EXIF orientation applied).
    pub width_px: u32,
    pub height_px: u32,
    /// Resolution saved in the file, when there is one.
    pub dpi: Option<f64>,
    /// The size the file's resolution says it is, in mm (`pixels / dpi`).
    pub native_width_mm: Option<f64>,
    pub native_height_mm: Option<f64>,
    pub bytes: u64,
    /// SHA-256 of the file (hex).
    pub hash: String,
    /// What the image adds to the PDF at full size, estimated: a JPEG is stored as it is, the others
    /// lossless.
    pub stored_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    /// The whole image, centred, with blank margins on two sides.
    Fit,
    /// The image covers the page, centred; what does not fit is cut off.
    Fill,
}

/// How an image sits on its page.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    /// The piece's size. The page is this plus `bleed_mm` on every side.
    pub width_mm: f64,
    pub height_mm: f64,
    pub bleed_mm: f64,
    /// What to do when the image's proportions do not match the page's.
    pub fit: Fit,
    /// Shrink PNG and WebP images above [`REDUCED_DPI`] to it.
    pub reduce_large: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Good,
    /// Under [`SOFT_BELOW_DPI`].
    Soft,
    /// Under [`BLURRY_BELOW_DPI`].
    Blurry,
}

/// What a placement does to one image.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagePlan {
    pub page_width_mm: f64,
    pub page_height_mm: f64,
    /// The piece inside the page, normalized (0..1 of the page, top-left origin).
    pub piece: Rect,
    /// The image's proportions are more than [`PROPORTION_TOLERANCE`] off the page's.
    pub proportions_differ: bool,
    /// Pixels per inch at the printed size.
    pub dpi: f64,
    pub quality: Quality,
    /// Above [`VERY_LARGE_ABOVE_DPI`].
    pub very_large: bool,
    /// The image will be shrunk to this resolution (a PNG or WebP above it, with the switch on).
    pub reduced_to_dpi: Option<f64>,
    /// What the image adds to the exported PDF, estimated.
    pub stored_bytes: u64,
}

/// One page of an images document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSpec {
    pub path: String,
    /// SHA-256 of the file, from [`probe_image`].
    pub hash: String,
    pub placement: Placement,
    /// The image file is gone: the page keeps its size and stays blank, so the rest of the project works.
    #[serde(default)]
    pub missing: bool,
}

// ---------------------------------------------------------------------------------------------
// Reading a file
// ---------------------------------------------------------------------------------------------

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn unreadable(name: &str, detail: impl std::fmt::Display) -> Error {
    Error::ImageUnreadable {
        name: name.into(),
        detail: detail.to_string(),
    }
}

/// The format the file's extension names, if it is one this module reads.
fn format_from_extension(path: &Path) -> Option<ImageFormat> {
    match path
        .extension()?
        .to_string_lossy()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "png" => Some(ImageFormat::Png),
        "webp" => Some(ImageFormat::Webp),
        _ => None,
    }
}

/// Whether the first bytes are those of `format`.
fn has_signature(bytes: &[u8], format: ImageFormat) -> bool {
    match format {
        ImageFormat::Jpeg => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        ImageFormat::Png => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        ImageFormat::Webp => bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
    }
}

/// Everything read from the headers of a file.
struct Meta {
    format: ImageFormat,
    /// Pixels as stored (before the orientation).
    width: u32,
    height: u32,
    /// EXIF orientation, 1..=8.
    orientation: u8,
    dpi: Option<f64>,
    icc: Option<Vec<u8>>,
    // JPEG only
    jpeg_components: u8,
    jpeg_adobe: bool,
    // PNG and WebP only
    raster_bytes: u64,
}

impl Meta {
    /// Size as shown: the orientation may turn the image on its side.
    fn shown(&self) -> (u32, u32) {
        if self.orientation >= 5 {
            (self.height, self.width)
        } else {
            (self.width, self.height)
        }
    }
}

fn be16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*b.get(at)?, *b.get(at + 1)?]))
}

/// Orientation and resolution from an EXIF block (a TIFF structure, with or without the `Exif\0\0`
/// prefix).
fn parse_exif(data: &[u8]) -> (Option<u8>, Option<f64>) {
    let data = data.strip_prefix(b"Exif\0\0").unwrap_or(data);
    let little = match data.get(..2) {
        Some(b"II") => true,
        Some(b"MM") => false,
        _ => return (None, None),
    };
    let u16_at = |at: usize| -> Option<u16> {
        let b = [*data.get(at)?, *data.get(at + 1)?];
        Some(if little {
            u16::from_le_bytes(b)
        } else {
            u16::from_be_bytes(b)
        })
    };
    let u32_at = |at: usize| -> Option<u32> {
        let b = [
            *data.get(at)?,
            *data.get(at + 1)?,
            *data.get(at + 2)?,
            *data.get(at + 3)?,
        ];
        Some(if little {
            u32::from_le_bytes(b)
        } else {
            u32::from_be_bytes(b)
        })
    };
    if u16_at(2) != Some(42) {
        return (None, None);
    }
    let Some(ifd) = u32_at(4).map(|o| o as usize) else {
        return (None, None);
    };
    let count = u16_at(ifd).unwrap_or(0) as usize;
    let (mut orientation, mut x_res, mut unit) = (None, None, 2u16);
    for i in 0..count.min(256) {
        let entry = ifd + 2 + i * 12;
        let (Some(tag), Some(kind)) = (u16_at(entry), u16_at(entry + 2)) else {
            break;
        };
        match tag {
            0x0112 if kind == 3 => orientation = u16_at(entry + 8).filter(|o| (1..=8).contains(o)),
            0x0128 if kind == 3 => unit = u16_at(entry + 8).unwrap_or(2),
            0x011A if kind == 5 => {
                let at = u32_at(entry + 8).unwrap_or(0) as usize;
                if let (Some(n), Some(d)) = (u32_at(at), u32_at(at + 4)) {
                    if d != 0 {
                        x_res = Some(f64::from(n) / f64::from(d));
                    }
                }
            }
            _ => {}
        }
    }
    let dpi = x_res
        .filter(|r| *r > 0.0)
        .map(|r| if unit == 3 { r * MM_PER_INCH / 10.0 } else { r });
    (orientation.map(|o| o as u8), dpi)
}

/// Reads a JPEG's header segments without decoding it.
fn read_jpeg(name: &str, bytes: &[u8]) -> Result<Meta> {
    let mut pos = 2;
    let mut meta = Meta {
        format: ImageFormat::Jpeg,
        width: 0,
        height: 0,
        orientation: 1,
        dpi: None,
        icc: None,
        jpeg_components: 0,
        jpeg_adobe: false,
        raster_bytes: 0,
    };
    let mut jfif_dpi = None;
    let mut exif_dpi = None;
    let mut icc_parts: Vec<(u8, Vec<u8>)> = Vec::new();
    let mut have_frame = false;
    while pos + 4 <= bytes.len() {
        if bytes[pos] != 0xFF {
            return Err(unreadable(name, "damaged JPEG"));
        }
        let marker = bytes[pos + 1];
        if marker == 0xFF {
            pos += 1;
            continue;
        }
        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            pos += 2;
            continue;
        }
        if marker == 0xD9 || marker == 0xDA {
            break;
        }
        let len = be16(bytes, pos + 2).unwrap_or(0) as usize;
        let seg = bytes
            .get(pos + 4..pos + 2 + len)
            .ok_or_else(|| unreadable(name, "damaged JPEG"))?;
        match marker {
            0xC0..=0xC2 => {
                if seg.first() != Some(&8) {
                    return Err(unreadable(name, "only 8-bit JPEG is supported"));
                }
                meta.height = u32::from(be16(seg, 1).unwrap_or(0));
                meta.width = u32::from(be16(seg, 3).unwrap_or(0));
                meta.jpeg_components = *seg.get(5).unwrap_or(&0);
                have_frame = true;
            }
            0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF => {
                return Err(unreadable(name, "this kind of JPEG is not supported"));
            }
            0xE0 if seg.starts_with(b"JFIF\0") && seg.len() >= 12 => {
                let units = seg[7];
                let x = be16(seg, 8).unwrap_or(0);
                jfif_dpi = match units {
                    1 if x > 0 => Some(f64::from(x)),
                    2 if x > 0 => Some(f64::from(x) * MM_PER_INCH / 10.0),
                    _ => None,
                };
            }
            0xE1 if seg.starts_with(b"Exif\0\0") => {
                let (orientation, dpi) = parse_exif(seg);
                if let Some(o) = orientation {
                    meta.orientation = o;
                }
                exif_dpi = dpi;
            }
            0xE2 if seg.starts_with(b"ICC_PROFILE\0") && seg.len() > 14 => {
                icc_parts.push((seg[12], seg[14..].to_vec()));
            }
            0xEE if seg.starts_with(b"Adobe") => meta.jpeg_adobe = true,
            _ => {}
        }
        pos += 2 + len;
    }
    if !have_frame || meta.width == 0 || meta.height == 0 {
        return Err(unreadable(name, "no image found in the file"));
    }
    if !matches!(meta.jpeg_components, 1 | 3 | 4) {
        return Err(unreadable(name, "unsupported colour layout"));
    }
    meta.dpi = jfif_dpi.or(exif_dpi);
    if !icc_parts.is_empty() {
        icc_parts.sort_by_key(|(n, _)| *n);
        meta.icc = Some(icc_parts.into_iter().flat_map(|(_, d)| d).collect());
    }
    Ok(meta)
}

/// The `pHYs` chunk of a PNG as pixels per inch.
fn png_dpi(bytes: &[u8]) -> Option<f64> {
    let mut pos = 8;
    while pos + 8 <= bytes.len() {
        let len = u32::from_be_bytes(bytes[pos..pos + 4].try_into().ok()?) as usize;
        let kind = &bytes[pos + 4..pos + 8];
        if kind == b"pHYs" && len >= 9 {
            let data = bytes.get(pos + 8..pos + 8 + 9)?;
            let per_unit = u32::from_be_bytes(data[..4].try_into().ok()?);
            return (data[8] == 1 && per_unit > 0).then(|| f64::from(per_unit) * 0.0254);
        }
        if kind == b"IDAT" || kind == b"IEND" {
            return None;
        }
        pos += 12 + len;
    }
    None
}

fn raster_bytes_of(color: image::ColorType, w: u32, h: u32) -> u64 {
    u64::from(w) * u64::from(h) * u64::from(color.bytes_per_pixel())
}

/// Reads a PNG's or WebP's header (not its pixels).
fn read_raster(name: &str, bytes: &[u8], format: ImageFormat) -> Result<Meta> {
    let cursor = Cursor::new(bytes);
    let (mut decoder, dpi): (Box<dyn ImageDecoder>, Option<f64>) = match format {
        ImageFormat::Png => (
            Box::new(image::codecs::png::PngDecoder::new(cursor).map_err(|e| unreadable(name, e))?),
            png_dpi(bytes),
        ),
        _ => (
            Box::new(
                image::codecs::webp::WebPDecoder::new(cursor).map_err(|e| unreadable(name, e))?,
            ),
            None,
        ),
    };
    let (width, height) = decoder.dimensions();
    let exif = decoder.exif_metadata().ok().flatten();
    let (orientation, exif_dpi) = exif.as_deref().map(parse_exif).unwrap_or((None, None));
    Ok(Meta {
        format,
        width,
        height,
        orientation: orientation.unwrap_or(1),
        dpi: dpi.or(exif_dpi),
        icc: decoder.icc_profile().ok().flatten(),
        jpeg_components: 0,
        jpeg_adobe: false,
        raster_bytes: raster_bytes_of(decoder.color_type(), width, height),
    })
}

/// A file read into memory and checked: its format, size limits and headers.
struct Loaded {
    name: String,
    bytes: Vec<u8>,
    meta: Meta,
}

fn load(path: &Path) -> Result<Loaded> {
    let name = name_of(path);
    let format = format_from_extension(path)
        .ok_or_else(|| Error::ImageUnsupported { name: name.clone() })?;
    let size = std::fs::metadata(path)?.len();
    if size > MAX_FILE_BYTES {
        return Err(Error::ImageTooLarge {
            name,
            megapixels: 0.0,
            mb: size as f64 / 1_048_576.0,
        });
    }
    let bytes = std::fs::read(path)?;
    if !has_signature(&bytes, format) {
        return Err(Error::ImageUnsupported { name });
    }
    let meta = match format {
        ImageFormat::Jpeg => read_jpeg(&name, &bytes)?,
        _ => read_raster(&name, &bytes, format)?,
    };
    let megapixels = f64::from(meta.width) * f64::from(meta.height) / 1e6;
    if megapixels > MAX_MEGAPIXELS {
        return Err(Error::ImageTooLarge {
            name,
            megapixels,
            mb: size as f64 / 1_048_576.0,
        });
    }
    Ok(Loaded { name, bytes, meta })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// What an image of this format stores in the PDF, estimated from its header: a JPEG as it is, PNG
/// and WebP lossless (about half of the raw pixels for photographs, less for flat art).
fn stored_estimate(meta: &Meta, file_bytes: u64) -> u64 {
    match meta.format {
        ImageFormat::Jpeg => file_bytes,
        _ => meta.raster_bytes / 2,
    }
}

/// Checks the image at `path` (format, size limits) and reads what can be known without decoding it.
pub fn probe_image(path: &Path) -> Result<ImageProbe> {
    let loaded = load(path)?;
    let (width_px, height_px) = loaded.meta.shown();
    let dpi = loaded.meta.dpi;
    let bytes = loaded.bytes.len() as u64;
    Ok(ImageProbe {
        path: path.to_string_lossy().into_owned(),
        name: loaded.name,
        format: loaded.meta.format,
        width_px,
        height_px,
        dpi,
        native_width_mm: dpi.map(|d| f64::from(width_px) / d * MM_PER_INCH),
        native_height_mm: dpi.map(|d| f64::from(height_px) / d * MM_PER_INCH),
        bytes,
        hash: hex(&Sha256::digest(&loaded.bytes)),
        stored_bytes: stored_estimate(&loaded.meta, bytes),
    })
}

// ---------------------------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------------------------

/// Where the image is drawn on its page, in points.
struct Geometry {
    page_w: f64,
    page_h: f64,
    draw_w: f64,
    draw_h: f64,
    x: f64,
    y: f64,
    /// Whether the drawing runs past the page and must be clipped to it.
    clip: bool,
    proportions_differ: bool,
}

fn geometry(width_px: u32, height_px: u32, p: &Placement) -> Geometry {
    let page_w = mm_to_pt(p.width_mm + 2.0 * p.bleed_mm);
    let page_h = mm_to_pt(p.height_mm + 2.0 * p.bleed_mm);
    let (iw, ih) = (f64::from(width_px), f64::from(height_px));
    let off = ((iw / ih) / (page_w / page_h) - 1.0).abs() > PROPORTION_TOLERANCE;
    let (draw_w, draw_h) = if !off {
        (page_w, page_h)
    } else {
        let scale = match p.fit {
            Fit::Fit => (page_w / iw).min(page_h / ih),
            Fit::Fill => (page_w / iw).max(page_h / ih),
        };
        (iw * scale, ih * scale)
    };
    Geometry {
        page_w,
        page_h,
        draw_w,
        draw_h,
        x: (page_w - draw_w) / 2.0,
        y: (page_h - draw_h) / 2.0,
        clip: off && p.fit == Fit::Fill,
        proportions_differ: off,
    }
}

/// What `placement` does to `probe`: the page, the piece in it, the resolution it prints at and
/// what it adds to the exported PDF.
pub fn plan_image(probe: &ImageProbe, placement: &Placement) -> ImagePlan {
    let g = geometry(probe.width_px, probe.height_px, placement);
    let dpi = f64::from(probe.width_px) / (g.draw_w / PT_PER_INCH);
    let quality = if dpi < BLURRY_BELOW_DPI {
        Quality::Blurry
    } else if dpi < SOFT_BELOW_DPI {
        Quality::Soft
    } else {
        Quality::Good
    };
    let reduced = placement.reduce_large && probe.format != ImageFormat::Jpeg && dpi > REDUCED_DPI;
    let stored_bytes = if reduced {
        let k = REDUCED_DPI / dpi;
        (probe.stored_bytes as f64 * k * k) as u64
    } else {
        probe.stored_bytes
    };
    let bleed = mm_to_pt(placement.bleed_mm);
    ImagePlan {
        page_width_mm: placement.width_mm + 2.0 * placement.bleed_mm,
        page_height_mm: placement.height_mm + 2.0 * placement.bleed_mm,
        piece: Rect::new(
            bleed / g.page_w,
            bleed / g.page_h,
            mm_to_pt(placement.width_mm) / g.page_w,
            mm_to_pt(placement.height_mm) / g.page_h,
        ),
        proportions_differ: g.proportions_differ,
        dpi,
        quality,
        very_large: dpi > VERY_LARGE_ABOVE_DPI,
        reduced_to_dpi: reduced.then_some(REDUCED_DPI),
        stored_bytes,
    }
}

/// The matrix `[a b c d e f]` of an EXIF orientation on the unit square, with y up: it takes a point
/// of the stored image to a point of the image as shown.
fn orientation_matrix(orientation: u8) -> [f64; 6] {
    match orientation {
        2 => [-1.0, 0.0, 0.0, 1.0, 1.0, 0.0],
        3 => [-1.0, 0.0, 0.0, -1.0, 1.0, 1.0],
        4 => [1.0, 0.0, 0.0, -1.0, 0.0, 1.0],
        5 => [0.0, -1.0, -1.0, 0.0, 1.0, 1.0],
        6 => [0.0, -1.0, 1.0, 0.0, 0.0, 1.0],
        7 => [0.0, 1.0, 1.0, 0.0, 0.0, 0.0],
        8 => [0.0, 1.0, -1.0, 0.0, 1.0, 0.0],
        _ => [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
    }
}

/// The `cm` matrix that draws the image's unit square, as stored, where the placement wants it.
fn image_matrix(g: &Geometry, orientation: u8) -> [f64; 6] {
    let o = orientation_matrix(orientation);
    [
        g.draw_w * o[0],
        g.draw_h * o[1],
        g.draw_w * o[2],
        g.draw_h * o[3],
        g.draw_w * o[4] + g.x,
        g.draw_h * o[5] + g.y,
    ]
}

// ---------------------------------------------------------------------------------------------
// Writing the PDF
// ---------------------------------------------------------------------------------------------

fn icc_components(profile: &[u8]) -> Option<u8> {
    match profile.get(16..20)? {
        b"RGB " => Some(3),
        b"GRAY" => Some(1),
        b"CMYK" => Some(4),
        _ => None,
    }
}

/// The colour space entry: the embedded profile when it fits the image, else the device space.
fn color_space(doc: &mut Document, icc: Option<&[u8]>, components: u8) -> Object {
    let device = match components {
        1 => "DeviceGray",
        4 => "DeviceCMYK",
        _ => "DeviceRGB",
    };
    if let Some(profile) = icc.filter(|p| icc_components(p) == Some(components)) {
        let mut stream = Stream::new(
            dictionary! { "N" => i64::from(components), "Alternate" => device },
            profile.to_vec(),
        );
        let _ = stream.compress();
        let id = doc.add_object(stream);
        return Object::Array(vec![
            Object::Name(b"ICCBased".to_vec()),
            Object::Reference(id),
        ]);
    }
    Object::Name(device.as_bytes().to_vec())
}

/// A JPEG's own bytes as an image XObject.
fn jpeg_xobject(doc: &mut Document, bytes: &[u8], meta: &Meta) -> ObjectId {
    let space = color_space(doc, meta.icc.as_deref(), meta.jpeg_components);
    let mut dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Image",
        "Width" => i64::from(meta.width),
        "Height" => i64::from(meta.height),
        "ColorSpace" => space,
        "BitsPerComponent" => 8,
        "Filter" => "DCTDecode",
    };
    if meta.jpeg_components == 4 && meta.jpeg_adobe {
        // Adobe writes CMYK JPEGs inverted.
        dict.set(
            "Decode",
            [1, 0, 1, 0, 1, 0, 1, 0]
                .iter()
                .map(|v| Object::Integer(*v))
                .collect::<Vec<_>>(),
        );
    }
    doc.add_object(Stream::new(dict, bytes.to_vec()).with_compression(false))
}

/// Pixels split into colour and (optional) alpha planes, 8 or 16 bits per sample, big-endian.
struct Pixels {
    width: u32,
    height: u32,
    components: u8,
    depth: u8,
    color: Vec<u8>,
    alpha: Option<Vec<u8>>,
}

fn split_planes<T: Copy>(
    raw: &[T],
    channels: usize,
    has_alpha: bool,
    put: impl Fn(&mut Vec<u8>, T),
) -> (Vec<u8>, Option<Vec<u8>>) {
    let colors = if has_alpha { channels - 1 } else { channels };
    let mut color = Vec::with_capacity(raw.len());
    let mut alpha = has_alpha.then(|| Vec::with_capacity(raw.len() / channels));
    for px in raw.chunks_exact(channels) {
        for v in &px[..colors] {
            put(&mut color, *v);
        }
        if let Some(a) = alpha.as_mut() {
            put(a, px[colors]);
        }
    }
    (color, alpha)
}

fn to_pixels(img: &DynamicImage) -> Pixels {
    use DynamicImage::*;
    let (width, height) = (img.width(), img.height());
    let put8 = |v: &mut Vec<u8>, x: u8| v.push(x);
    let put16 = |v: &mut Vec<u8>, x: u16| v.extend_from_slice(&x.to_be_bytes());
    let (components, depth, (color, alpha)) = match img {
        ImageLuma8(b) => (1, 8, split_planes(b.as_raw(), 1, false, put8)),
        ImageLumaA8(b) => (1, 8, split_planes(b.as_raw(), 2, true, put8)),
        ImageRgb8(b) => (3, 8, split_planes(b.as_raw(), 3, false, put8)),
        ImageRgba8(b) => (3, 8, split_planes(b.as_raw(), 4, true, put8)),
        ImageLuma16(b) => (1, 16, split_planes(b.as_raw(), 1, false, put16)),
        ImageLumaA16(b) => (1, 16, split_planes(b.as_raw(), 2, true, put16)),
        ImageRgb16(b) => (3, 16, split_planes(b.as_raw(), 3, false, put16)),
        ImageRgba16(b) => (3, 16, split_planes(b.as_raw(), 4, true, put16)),
        // Not produced by the PNG and WebP decoders; keep it correct anyway.
        other => {
            let rgba = other.to_rgba8();
            (3, 8, split_planes(rgba.as_raw(), 4, true, put8))
        }
    };
    Pixels {
        width,
        height,
        components,
        depth,
        color,
        alpha,
    }
}

/// Decoded pixels as an image XObject, stored losslessly, with an `SMask` for transparency.
fn raster_xobject(doc: &mut Document, px: Pixels, icc: Option<&[u8]>) -> Result<ObjectId> {
    let smask = match px.alpha {
        Some(alpha) => {
            let mut stream = Stream::new(
                dictionary! {
                    "Type" => "XObject",
                    "Subtype" => "Image",
                    "Width" => i64::from(px.width),
                    "Height" => i64::from(px.height),
                    "ColorSpace" => "DeviceGray",
                    "BitsPerComponent" => i64::from(px.depth),
                },
                alpha,
            );
            stream.compress()?;
            Some(doc.add_object(stream))
        }
        None => None,
    };
    let space = color_space(doc, icc, px.components);
    let mut dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Image",
        "Width" => i64::from(px.width),
        "Height" => i64::from(px.height),
        "ColorSpace" => space,
        "BitsPerComponent" => i64::from(px.depth),
    };
    if let Some(id) = smask {
        dict.set("SMask", Object::Reference(id));
    }
    let mut stream = Stream::new(dict, px.color);
    stream.compress()?;
    Ok(doc.add_object(stream))
}

fn num(v: f64) -> String {
    let s = format!("{v:.4}");
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// A page of the right size with nothing on it: where an image that is missing was.
fn add_blank_page(doc: &mut Document, pages_id: ObjectId, p: &Placement) -> ObjectId {
    let (w, h) = (
        mm_to_pt(p.width_mm + 2.0 * p.bleed_mm),
        mm_to_pt(p.height_mm + 2.0 * p.bleed_mm),
    );
    let content_id = doc.add_object(Stream::new(dictionary! {}, Vec::new()));
    doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), w.into(), h.into()],
        "Resources" => dictionary! {},
        "Contents" => content_id,
    })
}

/// Adds the page of one image and returns its id.
fn add_page(doc: &mut Document, pages_id: ObjectId, spec: &ImageSpec) -> Result<ObjectId> {
    if spec.missing {
        return Ok(add_blank_page(doc, pages_id, &spec.placement));
    }
    let path = Path::new(&spec.path);
    let loaded = load(path)?;
    let Loaded { name, bytes, meta } = loaded;
    let (shown_w, shown_h) = meta.shown();
    let g = geometry(shown_w, shown_h, &spec.placement);

    let image_id = match meta.format {
        ImageFormat::Jpeg => jpeg_xobject(doc, &bytes, &meta),
        format => {
            let cursor = Cursor::new(&bytes);
            let mut img = match format {
                ImageFormat::Png => image::DynamicImage::from_decoder(
                    image::codecs::png::PngDecoder::new(cursor)
                        .map_err(|e| unreadable(&name, e))?,
                ),
                _ => image::DynamicImage::from_decoder(
                    image::codecs::webp::WebPDecoder::new(cursor)
                        .map_err(|e| unreadable(&name, e))?,
                ),
            }
            .map_err(|e| unreadable(&name, e))?;
            let dpi = f64::from(shown_w) / (g.draw_w / PT_PER_INCH);
            if spec.placement.reduce_large && dpi > REDUCED_DPI {
                let k = REDUCED_DPI / dpi;
                let nw = ((f64::from(img.width()) * k).round() as u32).max(1);
                let nh = ((f64::from(img.height()) * k).round() as u32).max(1);
                img = img.resize_exact(nw, nh, image::imageops::FilterType::Lanczos3);
            }
            raster_xobject(doc, to_pixels(&img), meta.icc.as_deref())?
        }
    };

    let m = image_matrix(&g, meta.orientation);
    let clip = if g.clip {
        format!("0 0 {} {} re W n ", num(g.page_w), num(g.page_h))
    } else {
        String::new()
    };
    let content = format!(
        "q {clip}{} {} {} {} {} {} cm /Im0 Do Q",
        num(m[0]),
        num(m[1]),
        num(m[2]),
        num(m[3]),
        num(m[4]),
        num(m[5]),
    );
    let content_id = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
    Ok(doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), g.page_w.into(), g.page_h.into()],
        "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => image_id } },
        "Contents" => content_id,
    }))
}

/// Writes a PDF with one page per image to `output`, through a temporary file beside it.
pub fn build_images_pdf(specs: &[ImageSpec], output: &Path) -> Result<()> {
    if specs.is_empty() {
        return Err(Error::Malformed("no images to put in a document".into()));
    }
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let mut kids = Vec::with_capacity(specs.len());
    for spec in specs {
        kids.push(Object::Reference(add_page(&mut doc, pages_id, spec)?));
    }
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Count" => specs.len() as i64,
            "Kids" => kids,
        }),
    );
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);

    let tmp = output.with_extension(format!("{}.tmp", std::process::id()));
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

/// The name a document of these images is cached under: it covers the images and how each is placed,
/// so a different size, bleed, fit or reduction is a different file.
pub fn images_cache_key(specs: &[ImageSpec]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(BUILD_VERSION.as_bytes());
    for s in specs {
        let p = &s.placement;
        hasher.update(
            format!(
                "|{}|{:.4}|{:.4}|{:.4}|{:?}|{}|{}",
                s.hash, p.width_mm, p.height_mm, p.bleed_mm, p.fit, p.reduce_large, s.missing
            )
            .as_bytes(),
        );
    }
    hex(&hasher.finalize())
}

/// The PDF of these images under `cache_dir`, built if it is not there yet. Returns its path.
pub fn images_document(specs: &[ImageSpec], cache_dir: &Path) -> Result<PathBuf> {
    let dir = cache_dir.join("images");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.pdf", images_cache_key(specs)));
    if !path.is_file() {
        build_images_pdf(specs, &path)?;
    }
    Ok(path)
}
