//! Where the colour of a piece's edge is looked for, and which colour wins.
use card_core::card::OrientedRect;
use card_core::edge::{band_points, dominant_color};
use card_core::geometry::Point;

fn rect(angle_deg: f64) -> OrientedRect {
    OrientedRect {
        center: Point { x: 100.0, y: 200.0 },
        width: 60.0,
        height: 90.0,
        angle_deg,
    }
}

#[test]
fn the_band_is_just_inside_the_edge_and_clear_of_the_corners() {
    let r = rect(0.0);
    let points = band_points(&r);
    assert!(!points.is_empty());
    for p in &points {
        let (dx, dy) = ((p.x - 100.0).abs(), (p.y - 200.0).abs());
        assert!(dx <= 30.0 && dy <= 45.0, "inside the piece: {p:?}");
        // Within 7% of the shorter side (4.2 pt) of one edge.
        let from_edge = (30.0 - dx).min(45.0 - dy);
        assert!(from_edge <= 4.2 + 1e-9, "in the band: {p:?}");
        // Never in a corner square.
        assert!(!(dx > 30.0 - 6.0 && dy > 45.0 - 6.0), "not a corner: {p:?}");
    }
}

#[test]
fn a_tilted_piece_has_its_band_turned_with_it() {
    let straight = band_points(&rect(0.0));
    let turned = band_points(&rect(90.0));
    // A quarter turn about the centre maps (dx, dy) to (-dy, dx).
    for (a, b) in straight.iter().zip(&turned) {
        let (dx, dy) = (a.x - 100.0, a.y - 200.0);
        assert!((b.x - (100.0 - dy)).abs() < 1e-9 && (b.y - (200.0 + dx)).abs() < 1e-9);
    }
}

#[test]
fn the_most_common_colour_wins_as_the_average_of_its_shades() {
    let mut samples = vec![[250, 250, 250]; 10];
    samples.extend([[10, 20, 20], [12, 22, 18], [14, 18, 20], [12, 20, 22]].repeat(4));
    assert_eq!(dominant_color(&samples), [12, 20, 20]);
    assert_eq!(dominant_color(&[]), [255, 255, 255]);
    // A tie goes to the darker colour, every time.
    assert_eq!(dominant_color(&[[255, 255, 255], [0, 0, 0]]), [0, 0, 0]);
    assert_eq!(dominant_color(&[[0, 0, 0], [255, 255, 255]]), [0, 0, 0]);
}
