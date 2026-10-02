// 1 inch = 25.4 mm = 72 PDF points. Screen pixels are NOT convertible here:
// they depend on zoom and live in lib/coordinates.ts (added with the editor).
export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

export const mmToPt = (mm: number) => (mm * PT_PER_INCH) / MM_PER_INCH;
export const ptToMm = (pt: number) => (pt * MM_PER_INCH) / PT_PER_INCH;
