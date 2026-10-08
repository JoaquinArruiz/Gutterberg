import { describe, expect, it } from "vitest";
import fixtureText from "../../crates/card-core/tests/data/detection.json?raw";
import { confidenceBand, gridFromProposal, pieceCount, piecesFromProposal } from "./detect";
import { DetectionSchema, type Proposal } from "./detect-api";

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };

const grid = (over: Partial<Extract<Proposal, { kind: "grid" }>> = {}): Proposal => ({
  kind: "grid",
  bounds: { x: 59.5276, y: 84.189, width: 476.2205, height: 673.5118 },
  rows: 3,
  columns: 3,
  source_gap_x_mm: 0,
  source_gap_y_mm: 0,
  confidence: 0.95,
  engine: "pdf-objects",
  notes: [],
  ...over,
});

describe("what Rust sends", () => {
  // The same file `crates/card-core/tests/detect.rs` reads into the Rust types and writes back.
  const detection = DetectionSchema.parse(JSON.parse(fixtureText));

  it("parses, both kinds of proposal, with their notes", () => {
    expect(detection.proposals.map((p) => p.kind)).toEqual(["grid", "rects"]);
    expect(detection.proposals[0].notes).toEqual(["crop_marks"]);
    expect(detection.proposals[1]).toMatchObject({ engine: "blobs", confidence: 0.62 });
    expect(detection.reasons).toEqual([]);
  });

  it("refuses a proposal of a kind it does not know, or a note it cannot word", () => {
    expect(() => DetectionSchema.parse({ proposals: [{ kind: "circles", confidence: 1, engine: "x" }] })).toThrow();
    const bad = JSON.parse(fixtureText);
    bad.proposals[0].notes = ["mystery"];
    expect(() => DetectionSchema.parse(bad)).toThrow();
  });

  it("allows the reasons when nothing was found", () => {
    const none = DetectionSchema.parse({ proposals: [], reasons: ["merged_pieces"] });
    expect(none.reasons).toEqual(["merged_pieces"]);
  });
});

describe("confidenceBand", () => {
  it("is exact only for the PDF's own objects, then good from 0.7, else low", () => {
    expect(confidenceBand({ engine: "pdf-objects", confidence: 0.95 })).toBe("exact");
    expect(confidenceBand({ engine: "pdf-objects", confidence: 0.7 })).toBe("good");
    expect(confidenceBand({ engine: "edges", confidence: 0.9 })).toBe("good");
    expect(confidenceBand({ engine: "blobs", confidence: 0.69 })).toBe("low");
    expect(confidenceBand({ engine: "pdf-objects", confidence: 0.45 })).toBe("low");
  });
});

describe("a grid proposal", () => {
  it("becomes a region normalized to the page, with the grid fields", () => {
    const g = gridFromProposal(grid({ source_gap_x_mm: 2, source_gap_y_mm: 2.02 }), A4);
    expect(g).not.toBeNull();
    expect(g?.selection.x).toBeCloseTo(0.1, 4);
    expect(g?.selection.y).toBeCloseTo(0.1, 4);
    expect(g?.selection.width).toBeCloseTo(0.8, 4);
    expect(g?.selection.height).toBeCloseTo(0.8, 4);
    expect(g).toMatchObject({ rows: 3, columns: 3, sourceGapXMm: 2, sourceGapYMm: 2.02, sourceGapLinked: true });
  });

  it("keeps the gaps apart when they differ", () => {
    const g = gridFromProposal(grid({ source_gap_x_mm: 2, source_gap_y_mm: 5 }), A4);
    expect(g?.sourceGapLinked).toBe(false);
  });

  it("is pulled inside the page and never has a negative gap", () => {
    const g = gridFromProposal(
      grid({ bounds: { x: -3, y: -2, width: A4.width_pt + 10, height: A4.height_pt + 5 }, source_gap_x_mm: -0.02 }),
      A4,
    );
    expect(g?.selection).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(g?.sourceGapXMm).toBe(0);
  });

  it("is not made from rectangles", () => {
    const rects: Proposal = { kind: "rects", rects: [], confidence: 0.8, engine: "blobs", notes: [] };
    expect(gridFromProposal(rects, A4)).toBeNull();
    expect(piecesFromProposal(grid(), A4)).toBeNull();
  });
});

describe("a rectangles proposal", () => {
  const rects: Proposal = {
    kind: "rects",
    rects: [{ center: { x: 297.6378, y: 420.9449 }, width: 119.0551, height: 168.3779, angle_deg: -12 }],
    confidence: 0.8,
    engine: "blobs",
    notes: [],
  };

  it("becomes freeform pieces normalized to the page, tilt kept", () => {
    const pieces = piecesFromProposal(rects, A4);
    expect(pieces).toHaveLength(1);
    expect(pieces?.[0].center.x).toBeCloseTo(0.5, 4);
    expect(pieces?.[0].center.y).toBeCloseTo(0.5, 4);
    expect(pieces?.[0].width).toBeCloseTo(0.2, 4);
    expect(pieces?.[0].height).toBeCloseTo(0.2, 4);
    expect(pieces?.[0].angle_deg).toBe(-12);
  });

  it("counts pieces for both kinds", () => {
    expect(pieceCount(rects)).toBe(1);
    expect(pieceCount(grid({ rows: 2, columns: 4 }))).toBe(8);
  });
});
