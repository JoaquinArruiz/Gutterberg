use card_core::calibration::{
    back_point, calibration_pdf, crosshair_points, write_calibration_pdf, CalibrationLabels,
};
use card_core::finish::Flip;
use card_core::geometry::PageSize;
use card_core::units::mm_to_pt;
use lopdf::Document;

fn labels() -> CalibrationLabels {
    CalibrationLabels {
        title: "Calibración (prueba)".into(),
        front: "FRONT".into(),
        back: "BACK".into(),
        actual_size: "100 mm".into(),
    }
}

fn a4() -> PageSize {
    PageSize {
        width_pt: mm_to_pt(210.0),
        height_pt: mm_to_pt(297.0),
    }
}

fn content(doc: &Document, n: u32) -> String {
    let id = *doc.get_pages().get(&n).unwrap();
    String::from_utf8_lossy(&doc.get_page_content(id)).into_owned()
}

fn ticks(c: &str) -> usize {
    c.lines().filter(|l| l.ends_with(" l S")).count()
}

#[test]
fn two_pages_front_then_back() {
    let doc = calibration_pdf(&a4(), Flip::Long, &labels()).unwrap();
    assert_eq!(doc.get_pages().len(), 2);
    let (front, back) = (content(&doc, 1), content(&doc, 2));
    assert!(front.contains("(FRONT)") && !front.contains("(BACK)"));
    assert!(back.contains("(BACK)") && !back.contains("(FRONT)"));
    // Five crosshairs of two lines, and the 100 mm line with its two end ticks.
    assert_eq!(ticks(&front), 5 * 2 + 3);
    assert!(front.contains("(100 mm)"));
    // Five places, two rulers each: a baseline and 21 ticks (-5 to +5 mm every half millimetre).
    assert_eq!(ticks(&back), 5 * 2 * 22);
    assert!(back.contains("(+4)") && back.contains("(-4)"));
}

#[test]
fn text_is_escaped_and_latin1() {
    let mut l = labels();
    l.title = "a (b) \\ ñ 日".into();
    let doc = calibration_pdf(&a4(), Flip::Long, &l).unwrap();
    let id = *doc.get_pages().get(&1).unwrap();
    let raw = doc.get_page_content(id);
    let want = b"(a \\(b\\) \\\\ \xf1 ?)";
    assert!(raw.windows(want.len()).any(|w| w == want));
}

#[test]
fn small_page_has_no_scale_line_and_tiny_page_is_refused() {
    let a6 = PageSize {
        width_pt: mm_to_pt(105.0),
        height_pt: mm_to_pt(148.0),
    };
    let doc = calibration_pdf(&a6, Flip::Long, &labels()).unwrap();
    let front = content(&doc, 1);
    assert!(!front.contains("(100 mm)"));
    assert_eq!(ticks(&front), 5 * 2);
    let tiny = PageSize {
        width_pt: mm_to_pt(60.0),
        height_pt: mm_to_pt(60.0),
    };
    assert!(calibration_pdf(&tiny, Flip::Long, &labels()).is_err());
}

#[test]
fn back_marks_follow_the_flip_for_both_orientations() {
    let portrait = a4();
    let landscape = PageSize {
        width_pt: portrait.height_pt,
        height_pt: portrait.width_pt,
    };
    for (page, flip, mirrored_x) in [
        (portrait, Flip::Long, true),
        (portrait, Flip::Short, false),
        (landscape, Flip::Long, false),
        (landscape, Flip::Short, true),
    ] {
        let corner = crosshair_points(&page)[0];
        let b = back_point(&page, flip, corner);
        if mirrored_x {
            assert_eq!((b.x, b.y), (page.width_pt - corner.x, corner.y));
        } else {
            assert_eq!((b.x, b.y), (corner.x, page.height_pt - corner.y));
        }
        let centre = crosshair_points(&page)[4];
        let c = back_point(&page, flip, centre);
        assert!((c.x - centre.x).abs() < 1e-9 && (c.y - centre.y).abs() < 1e-9);
    }
}

#[test]
fn writes_a_file_that_reads_back() {
    let dir = std::env::temp_dir().join(format!("gtr-cal-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let out = dir.join("cal.pdf");
    write_calibration_pdf(&out, &a4(), Flip::Short, &labels()).unwrap();
    assert_eq!(Document::load(&out).unwrap().get_pages().len(), 2);
    std::fs::remove_dir_all(&dir).unwrap();
}
