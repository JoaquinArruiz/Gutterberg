//! Unit conversions. 1 inch = 25.4 mm = 72 PDF points.

pub const MM_PER_INCH: f64 = 25.4;
pub const PT_PER_INCH: f64 = 72.0;

pub fn mm_to_pt(mm: f64) -> f64 {
    mm * PT_PER_INCH / MM_PER_INCH
}

pub fn pt_to_mm(pt: f64) -> f64 {
    pt * MM_PER_INCH / PT_PER_INCH
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a4_width() {
        assert!((mm_to_pt(210.0) - 595.2756).abs() < 1e-3);
        assert!((pt_to_mm(mm_to_pt(63.5)) - 63.5).abs() < 1e-12);
    }
}
