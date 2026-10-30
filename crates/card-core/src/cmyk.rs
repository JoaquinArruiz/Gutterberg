//! CMYK export, for print shops: what Gutterberg puts on a sheet itself is written in CMYK instead of RGB.
//!
//! ```text
//! cut marks, fold lines, sheet and piece colours, Edge bleed  --solid-->   DeviceCMYK operators (k, K)
//! pictures of an images document, pictures of Fill with AI   --picture--> DeviceCMYK image XObjects
//! pages of a source PDF                                       (untouched: they keep their own colours)
//! ```
//!
//! The conversion goes through one printing profile built into the app, FOGRA39L coated (ISO 12647-2 offset on
//! coated paper, the usual default in European print shops; colord's version, CC0). A picture's own ICC profile is
//! its source when it has one, else sRGB. Greys, black included, go on the black ink only, so a cut mark is one
//! clean line instead of four inks laid over each other. No output intent is written: the file says CMYK, not
//! which press it was made for, and a shop that wants another profile converts it anyway.

use crate::error::{Error, Result};
use lcms2::{Flags, Intent, PixelFormat, Profile, Transform};
use lopdf::{Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

/// The printing profile CMYK colours are made for.
const PROFILE: &[u8] = include_bytes!("../profiles/FOGRA39L_coated.icc");

/// How a re-encoded JPEG picture is compressed: high, as it is already a second generation.
const JPEG_QUALITY: u8 = 95;

/// The colours of the exported file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ColorMode {
    /// As on screen: what the app draws is RGB, the sources keep their own colours.
    #[default]
    Rgb,
    /// For print shops: what the app draws and the pictures it put in the file are CMYK.
    Cmyk,
}

impl ColorMode {
    pub fn is_rgb(&self) -> bool {
        *self == ColorMode::Rgb
    }
}

fn lcms(e: lcms2::Error) -> Error {
    Error::Malformed(format!("the CMYK conversion failed: {e}"))
}

/// PDF stores 16-bit samples big-endian.
fn rgb16() -> PixelFormat {
    if cfg!(target_endian = "little") {
        PixelFormat::RGB_16_SE
    } else {
        PixelFormat::RGB_16
    }
}

fn cmyk16() -> PixelFormat {
    if cfg!(target_endian = "little") {
        PixelFormat::CMYK_16_SE
    } else {
        PixelFormat::CMYK_16
    }
}

/// Turns RGB into CMYK for one export: the printing profile is read once.
pub(crate) struct Converter {
    cmyk: Profile,
    /// Plain colours keep their look as closely as the paper allows (relative colorimetric, with black point
    /// compensation).
    solid: Transform<u8, u8>,
}

impl Converter {
    pub(crate) fn new() -> Result<Self> {
        let cmyk = Profile::new_icc(PROFILE).map_err(lcms)?;
        let solid = Transform::new_flags(
            &Profile::new_srgb(),
            PixelFormat::RGB_8,
            &cmyk,
            PixelFormat::CMYK_8,
            Intent::RelativeColorimetric,
            Flags::BLACKPOINT_COMPENSATION,
        )
        .map_err(lcms)?;
        Ok(Self { cmyk, solid })
    }

    /// One colour as `c m y k`, each 0..1. A grey is black ink only.
    pub(crate) fn solid(&self, [r, g, b]: [u8; 3]) -> [f64; 4] {
        if r == g && g == b {
            return [0.0, 0.0, 0.0, 1.0 - f64::from(r) / 255.0];
        }
        let mut out = [0u8; 4];
        self.solid.transform_pixels(&[r, g, b], &mut out);
        out.map(|v| f64::from(v) / 255.0)
    }

    /// RGB samples (8 or 16 bits, interleaved, as PDF stores them) as CMYK samples of the same depth. Pictures
    /// are mapped as a whole (perceptual), from their own profile when it is an RGB one.
    fn picture(&self, samples: &[u8], depth: u8, icc: Option<&[u8]>) -> Result<Vec<u8>> {
        let source = icc
            .and_then(|p| Profile::new_icc(p).ok())
            .filter(|p| p.color_space() == lcms2::ColorSpaceSignature::RgbData)
            .unwrap_or_else(Profile::new_srgb);
        let (input, output) = if depth == 16 {
            (rgb16(), cmyk16())
        } else {
            (PixelFormat::RGB_8, PixelFormat::CMYK_8)
        };
        let t: Transform<u8, u8> =
            Transform::new(&source, input, &self.cmyk, output, Intent::Perceptual).map_err(lcms)?;
        let bytes = usize::from(depth / 8);
        let pixels = samples.len() / (3 * bytes);
        let mut out = vec![0u8; pixels * 4 * bytes];
        t.transform_pixels(&samples[..pixels * 3 * bytes], &mut out);
        Ok(out)
    }

    /// Turns the RGB image XObject `id` into a CMYK one, in place. A JPEG stays a JPEG and a lossless picture stays
    /// lossless; its transparency (`SMask`) is kept as it is. Anything else (grey or CMYK already, an encoding the
    /// app does not write) is left alone.
    pub(crate) fn convert_image(&self, doc: &mut Document, id: ObjectId) -> Result<()> {
        let Ok(Object::Stream(stream)) = doc.get_object(id) else {
            return Ok(());
        };
        let dict = &stream.dict;
        if dict.get(b"Subtype").and_then(|s| s.as_name()).ok() != Some(b"Image") {
            return Ok(());
        }
        let icc = match dict.get(b"ColorSpace") {
            Ok(Object::Name(n)) if n == b"DeviceRGB" => None,
            Ok(Object::Array(a))
                if a.first().and_then(|n| n.as_name().ok()) == Some(b"ICCBased") =>
            {
                let Some(Ok(profile)) = a
                    .get(1)
                    .and_then(|r| r.as_reference().ok())
                    .map(|r| doc.get_object(r).and_then(|o| o.as_stream()))
                else {
                    return Ok(());
                };
                if profile.dict.get(b"N").and_then(|n| n.as_i64()).ok() != Some(3) {
                    return Ok(());
                }
                Some(
                    profile
                        .decompressed_content()
                        .unwrap_or_else(|_| profile.content.clone()),
                )
            }
            _ => return Ok(()),
        };
        let depth = dict
            .get(b"BitsPerComponent")
            .and_then(|b| b.as_i64())
            .unwrap_or(8);
        let (width, height) = (
            dict.get(b"Width").and_then(|w| w.as_i64()).unwrap_or(0),
            dict.get(b"Height").and_then(|h| h.as_i64()).unwrap_or(0),
        );
        let filter = dict.get(b"Filter").and_then(|f| f.as_name()).ok();
        let mut new_dict = dict.clone();
        new_dict.set("ColorSpace", "DeviceCMYK");
        new_dict.remove(b"Decode");
        let converted = match filter {
            Some(b"DCTDecode") => {
                let rgb =
                    image::load_from_memory_with_format(&stream.content, image::ImageFormat::Jpeg)
                        .map_err(|e| Error::Malformed(format!("a picture cannot be read: {e}")))?;
                let image::DynamicImage::ImageRgb8(rgb) = rgb else {
                    return Ok(());
                };
                let cmyk = self.picture(rgb.as_raw(), 8, icc.as_deref())?;
                match jpeg(&cmyk, rgb.width(), rgb.height()) {
                    Some(bytes) => {
                        // The encoder writes CMYK inverted, as Adobe does.
                        new_dict.set(
                            "Decode",
                            [1, 0, 1, 0, 1, 0, 1, 0]
                                .iter()
                                .map(|v| Object::Integer(*v))
                                .collect::<Vec<_>>(),
                        );
                        Stream::new(new_dict, bytes).with_compression(false)
                    }
                    // Wider or taller than a JPEG can be: stored losslessly instead.
                    None => {
                        new_dict.remove(b"Filter");
                        new_dict.remove(b"DecodeParms");
                        let mut s = Stream::new(new_dict, cmyk);
                        s.compress()?;
                        s
                    }
                }
            }
            Some(b"FlateDecode") | None if depth == 8 || depth == 16 => {
                let samples = stream
                    .decompressed_content()
                    .unwrap_or_else(|_| stream.content.clone());
                let expected = (width * height * 3 * (depth / 8)) as usize;
                if width <= 0 || height <= 0 || samples.len() < expected {
                    return Ok(());
                }
                let cmyk = self.picture(&samples[..expected], depth as u8, icc.as_deref())?;
                new_dict.remove(b"Filter");
                new_dict.remove(b"DecodeParms");
                let mut s = Stream::new(new_dict, cmyk);
                s.compress()?;
                s
            }
            _ => return Ok(()),
        };
        doc.objects.insert(id, Object::Stream(converted));
        Ok(())
    }
}

/// CMYK samples as a JPEG, or `None` when the picture is larger than a JPEG can hold.
fn jpeg(cmyk: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let (w, h) = (u16::try_from(width).ok()?, u16::try_from(height).ok()?);
    let mut out = Cursor::new(Vec::new());
    let mut encoder = jpeg_encoder::Encoder::new(&mut out, JPEG_QUALITY);
    encoder.set_sampling_factor(jpeg_encoder::SamplingFactor::F_1_1);
    encoder
        .encode(cmyk, w, h, jpeg_encoder::ColorType::Cmyk)
        .ok()?;
    Some(out.into_inner())
}
