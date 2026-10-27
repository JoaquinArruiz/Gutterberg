//! Fill with AI, the picture side: what is sent for a piece, what is kept of the answer, and how the export
//! lays it under the piece.
use card_core::fill::{
    copy_fills, fill_canvas, fill_name, fills_dir, keep_band, save_fill, with_band, MAGENTA,
};
use image::{ImageFormat, Rgba, RgbaImage};
use std::io::Cursor;

fn png(img: &RgbaImage) -> Vec<u8> {
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .unwrap();
    out
}

fn decode(bytes: &[u8]) -> RgbaImage {
    image::load_from_memory(bytes).unwrap().to_rgba8()
}

const RED: Rgba<u8> = Rgba([200, 0, 0, 255]);
const BLUE: Rgba<u8> = Rgba([0, 0, 200, 255]);

/// What a model that does its job sends back: the magenta painted blue, the rest untouched.
fn painted(picture: &[u8]) -> RgbaImage {
    let mut img = decode(picture);
    for p in img.pixels_mut() {
        if p.0 == MAGENTA {
            *p = BLUE;
        }
    }
    img
}

#[test]
fn the_piece_is_sent_in_a_magenta_band_with_a_mask_over_the_piece() {
    let piece = png(&RgbaImage::from_pixel(10, 20, RED));
    let sent = fill_canvas(&piece, 3, None).unwrap();
    let picture = decode(&sent.picture);
    let mask = decode(&sent.mask);
    assert_eq!((picture.width(), picture.height()), (16, 26));
    assert_eq!(picture.get_pixel(0, 0).0, MAGENTA);
    assert_eq!(picture.get_pixel(2, 13).0, MAGENTA);
    assert_eq!(*picture.get_pixel(3, 3), RED);
    assert_eq!(mask.get_pixel(0, 0).0[3], 0, "the band may be painted");
    assert_eq!(mask.get_pixel(8, 13).0[3], 255, "the piece may not");
    assert_eq!(sent.hash.len(), 12);
    assert_eq!(fill_canvas(&piece, 3, None).unwrap().hash, sent.hash);
}

#[test]
fn for_a_fixed_size_the_band_is_scaled_into_it_and_padded() {
    let piece = png(&RgbaImage::from_pixel(100, 200, RED));
    let sent = fill_canvas(&piece, 10, Some((1024, 1536))).unwrap();
    let f = sent.frame;
    assert_eq!((f.width, f.height), (1024, 1536));
    assert_eq!((f.drawn_width, f.drawn_height), (120, 220));
    assert_eq!(f.canvas_height, 1536);
    assert_eq!(f.canvas_x, (1024 - f.canvas_width) / 2);
    let picture = decode(&sent.picture);
    assert_eq!(
        picture.get_pixel(5, 768).0,
        MAGENTA,
        "padding is painted too"
    );
    assert_eq!(*picture.get_pixel(512, 768), RED);
}

#[test]
fn only_the_band_of_the_answer_is_kept_at_the_size_it_was_drawn() {
    let piece = png(&RgbaImage::from_pixel(100, 200, RED));
    for size in [None, Some((1024, 1536))] {
        let sent = fill_canvas(&piece, 10, size).unwrap();
        let band = decode(&keep_band(&png(&painted(&sent.picture)), &sent.frame).unwrap());
        assert_eq!((band.width(), band.height()), (120, 220));
        assert_eq!(*band.get_pixel(2, 110), BLUE);
        assert_eq!(
            band.get_pixel(60, 110).0[3],
            0,
            "the piece's area is left clear"
        );
        // An answer at another resolution but the same shape is fine.
        let half = image::imageops::resize(
            &painted(&sent.picture),
            sent.frame.width / 2,
            sent.frame.height / 2,
            image::imageops::FilterType::Nearest,
        );
        assert!(keep_band(&png(&half), &sent.frame).is_ok());
    }
    // The review shows the piece over its band.
    let sent = fill_canvas(&piece, 10, None).unwrap();
    let band = keep_band(&png(&painted(&sent.picture)), &sent.frame).unwrap();
    let after = decode(&with_band(&piece, &band, 10).unwrap());
    assert_eq!(*after.get_pixel(60, 110), RED);
    assert_eq!(*after.get_pixel(2, 110), BLUE);
}

#[test]
fn an_answer_of_another_shape_or_not_a_picture_is_refused() {
    let piece = png(&RgbaImage::from_pixel(100, 200, RED));
    let sent = fill_canvas(&piece, 10, None).unwrap();
    let square = png(&RgbaImage::from_pixel(200, 200, BLUE));
    let e = keep_band(&square, &sent.frame).unwrap_err();
    assert_eq!(card_core::ErrorInfo::from(&e).code, "fill_reply");
    assert!(keep_band(b"not a picture", &sent.frame).is_err());
}

#[test]
fn fills_are_saved_beside_the_project_and_copied_on_save_as() {
    let dir = std::env::temp_dir().join(format!("card-core-fills-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let project = dir.join("my game.gtr");
    assert_eq!(fills_dir(&project), dir.join("my game.gtr-fills"));
    assert_eq!(fill_name("g:0:3:1:2", "ab12"), "g-0-3-1-2-ab12.png");

    let band = png(&RgbaImage::from_pixel(4, 4, BLUE));
    let name = save_fill(&project, "g:0:3:1:2", &band, "ab12").unwrap();
    assert_eq!(
        std::fs::read(fills_dir(&project).join(&name)).unwrap(),
        band
    );
    // Not a picture: refused, nothing written.
    assert!(save_fill(&project, "g:0:0:0:0", b"nope", "00").is_err());

    let other = dir.join("copy.gtr");
    let names = [name.clone(), "../escape.png".into(), "gone.png".into()];
    assert_eq!(copy_fills(&project, &other, &names).unwrap(), 1);
    assert!(fills_dir(&other).join(&name).is_file());
    assert_eq!(copy_fills(&project, &project, &names).unwrap(), 0);
    std::fs::remove_dir_all(&dir).unwrap();
}
