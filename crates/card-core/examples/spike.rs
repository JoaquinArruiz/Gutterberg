//! Milestone 1 spike.
//!   spike sample <out.pdf>                         write a synthetic 3x3 PnP page
//!   spike export <in.pdf> <out.pdf> <x> <y> <w> <h> <rows> <cols> <gap_mm> [page]
//! x/y/w/h are normalized (0..1, top-left origin).
use card_core::export::{export_pdf, page_size, ExportJob, PageJob};
use card_core::geometry::Rect;
use card_core::layout::GridLayout;
use card_core::sample;
use std::path::Path;

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    match a.first().map(String::as_str) {
        Some("sample") => {
            sample::sample_pdf().save(&a[1]).unwrap();
            println!("wrote {}", a[1]);
        }
        Some("export") if a.len() >= 10 => {
            let f = |i: usize| a[i].parse::<f64>().expect("number");
            let page = a.get(10).map(|s| s.parse::<usize>().unwrap()).unwrap_or(1) - 1;
            let doc = lopdf::Document::load(&a[1]).unwrap();
            let size = page_size(&doc, page).unwrap();
            let grid = GridLayout {
                bounds: Rect::new(f(3), f(4), f(5), f(6)),
                rows: a[7].parse().unwrap(),
                columns: a[8].parse().unwrap(),
                gap_mm: f(9),
            };
            let l = card_core::layout::calculate_layout(size, &grid, None).unwrap();
            println!(
                "source page {:.1} x {:.1} pt, card {:.2} x {:.2} mm, {} cards",
                size.width_pt, size.height_pt, l.card_width_mm, l.card_height_mm, l.placements.len()
            );
            export_pdf(
                Path::new(&a[1]),
                Path::new(&a[2]),
                &ExportJob { pages: vec![PageJob { page_index: page, grid }] },
            )
            .unwrap();
            println!("wrote {}", a[2]);
        }
        _ => eprintln!("usage: see header of examples/spike.rs"),
    }
}
