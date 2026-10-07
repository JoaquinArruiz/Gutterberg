//! Card identity and source geometry.
//!
//! A card is identified by [`CardId`] and cut from the source PDF along an
//! [`OrientedRect`]. Both are defined here so the sheet engine (M12) and the
//! freeform card tool (M18) build on the same types as grid groups do today.

use crate::geometry::{Point, Rect};
use serde::{Deserialize, Serialize};

/// Which open PDF a card comes from. Only one document is open for now, but sheets
/// will mix cards from several PDFs, so every id carries its document.
pub type DocumentId = u32;

/// The document id used while only one PDF can be open.
pub const DEFAULT_DOCUMENT_ID: DocumentId = 0;

/// Stable identity of a card within a project.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CardId {
    /// A card cut from a grid group.
    Grid {
        document_id: DocumentId,
        page_index: usize,
        row: usize,
        column: usize,
    },
    /// A card drawn one by one (M18); `index` is its position in the page's freeform group.
    Freeform {
        document_id: DocumentId,
        page_index: usize,
        index: usize,
    },
}

impl CardId {
    pub fn document_id(&self) -> DocumentId {
        match *self {
            CardId::Grid { document_id, .. } | CardId::Freeform { document_id, .. } => document_id,
        }
    }

    pub fn page_index(&self) -> usize {
        match *self {
            CardId::Grid { page_index, .. } | CardId::Freeform { page_index, .. } => page_index,
        }
    }
}

/// The area of the source page a card is cut from: a rectangle of `width` x `height`
/// points centred on `center`, rotated `angle_deg` clockwise (top-left origin, so
/// clockwise on screen). Grid cards always have an angle of 0; freeform cards can be
/// rotated to match a crooked scan.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct OrientedRect {
    pub center: Point,
    pub width: f64,
    pub height: f64,
    pub angle_deg: f64,
}

impl OrientedRect {
    /// An unrotated rectangle covering `rect`.
    pub fn from_rect(rect: Rect) -> Self {
        Self {
            center: Point {
                x: rect.x + rect.width / 2.0,
                y: rect.y + rect.height / 2.0,
            },
            width: rect.width,
            height: rect.height,
            angle_deg: 0.0,
        }
    }

    /// The axis-aligned rectangle when the angle is a whole turn of 0 or 180 degrees,
    /// `None` otherwise.
    pub fn as_rect(&self) -> Option<Rect> {
        let turns = self.angle_deg.rem_euclid(180.0);
        if turns > 1e-9 && 180.0 - turns > 1e-9 {
            return None;
        }
        Some(Rect::new(
            self.center.x - self.width / 2.0,
            self.center.y - self.height / 2.0,
            self.width,
            self.height,
        ))
    }

    /// Corners in order top-left, top-right, bottom-right, bottom-left of the
    /// unrotated rectangle, after rotating them about the centre.
    pub fn corners(&self) -> [Point; 4] {
        let (sin, cos) = self.angle_deg.to_radians().sin_cos();
        let (hw, hh) = (self.width / 2.0, self.height / 2.0);
        [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)].map(|(dx, dy)| Point {
            x: self.center.x + dx * cos - dy * sin,
            y: self.center.y + dx * sin + dy * cos,
        })
    }
}

/// Inclusive range of 0-based page indexes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageRange {
    pub first: usize,
    pub last: usize,
}

impl PageRange {
    pub fn contains(&self, page_index: usize) -> bool {
        (self.first..=self.last).contains(&page_index)
    }
}

/// What a group of pages holds. `Grid` and `Skip` exist in the UI today; `Freeform`
/// is reserved for the card tool (M18) and nothing creates it yet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PageGroupKind {
    Grid { grid: crate::layout::GridLayout },
    Skip,
    Freeform { cards: Vec<OrientedRect> },
}

/// A run of pages that share one treatment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PageGroup {
    pub pages: PageRange,
    #[serde(flatten)]
    pub kind: PageGroupKind,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "{a} != {b}");
    }

    #[test]
    fn card_id_serialises_with_a_kind_tag() {
        let grid = CardId::Grid {
            document_id: 0,
            page_index: 2,
            row: 1,
            column: 0,
        };
        let json = serde_json::to_value(grid).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"kind": "grid", "document_id": 0, "page_index": 2, "row": 1, "column": 0})
        );
        assert_eq!(serde_json::from_value::<CardId>(json).unwrap(), grid);

        let free = CardId::Freeform {
            document_id: 3,
            page_index: 0,
            index: 7,
        };
        let json = serde_json::to_value(free).unwrap();
        assert_eq!(json["kind"], "freeform");
        assert_eq!(serde_json::from_value::<CardId>(json).unwrap(), free);
        assert_eq!((free.document_id(), free.page_index()), (3, 0));
    }

    #[test]
    fn cards_from_different_documents_differ() {
        let id = |document_id| CardId::Grid {
            document_id,
            page_index: 0,
            row: 0,
            column: 0,
        };
        assert_ne!(id(0), id(1));
    }

    #[test]
    fn unrotated_rect_round_trips() {
        let r = Rect::new(10.0, 20.0, 30.0, 40.0);
        let o = OrientedRect::from_rect(r);
        assert_eq!(o.angle_deg, 0.0);
        close(o.center.x, 25.0);
        close(o.center.y, 40.0);
        assert_eq!(o.as_rect(), Some(r));
        let c = o.corners();
        close(c[0].x, 10.0);
        close(c[0].y, 20.0);
        close(c[2].x, 40.0);
        close(c[2].y, 60.0);
    }

    #[test]
    fn rotated_rect_has_no_axis_aligned_form() {
        let mut o = OrientedRect::from_rect(Rect::new(0.0, 0.0, 10.0, 20.0));
        o.angle_deg = 7.0;
        assert_eq!(o.as_rect(), None);
        o.angle_deg = 180.0;
        assert!(o.as_rect().is_some());
    }

    #[test]
    fn corners_rotate_clockwise_about_the_centre() {
        // 90 degrees clockwise (top-left origin): the top-left corner moves to the top-right.
        let o = OrientedRect {
            center: Point { x: 0.0, y: 0.0 },
            width: 4.0,
            height: 2.0,
            angle_deg: 90.0,
        };
        let c = o.corners();
        close(c[0].x, 1.0);
        close(c[0].y, -2.0);
        close(c[2].x, -1.0);
        close(c[2].y, 2.0);
    }

    #[test]
    fn page_group_kinds_serialise_flat() {
        let skip = PageGroup {
            pages: PageRange { first: 0, last: 0 },
            kind: PageGroupKind::Skip,
        };
        let json = serde_json::to_value(&skip).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"pages": {"first": 0, "last": 0}, "kind": "skip"})
        );
        assert_eq!(serde_json::from_value::<PageGroup>(json).unwrap(), skip);

        let free = PageGroup {
            pages: PageRange { first: 3, last: 3 },
            kind: PageGroupKind::Freeform {
                cards: vec![OrientedRect::from_rect(Rect::new(0.0, 0.0, 5.0, 5.0))],
            },
        };
        let json = serde_json::to_value(&free).unwrap();
        assert_eq!(serde_json::from_value::<PageGroup>(json).unwrap(), free);
        assert!(free.pages.contains(3) && !free.pages.contains(4));
    }
}
