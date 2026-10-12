// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardIdKey, gridCardId } from "../../lib/card";
import type { OutputSheet } from "../../lib/sheet-api";
import { useDocumentStore } from "../../stores/document-store";
import { usePrintStore } from "../../stores/print-store";
import { SheetReferences } from "./SheetReferences";

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const place = (document: number, row: number, column: number, x: number, w = 180, h = 250) => ({
  card_id: gridCardId(document, 0, row, column),
  source: { center: { x: 100, y: 100 }, width: w, height: h, angle_deg: 0 },
  destination: { x, y: 40, width: w, height: h },
  turn: 0 as const,
  scale: 1,
});
const sheet = (placements: ReturnType<typeof place>[], side?: "back"): OutputSheet =>
  ({ page: A4, placements, warnings: [], ...(side ? { side } : {}) }) as unknown as OutputSheet;

const texts = () => screen.queryAllByTestId("piece-reference").map((e) => e.textContent);

beforeEach(() => {
  usePrintStore.getState().reset();
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/a.pdf", pages: [A4], hash: "" }], 0);
});
afterEach(cleanup);

describe("SheetReferences", () => {
  it("writes each piece's reference on it, in the library's words, with no letter for one PDF", () => {
    render(<SheetReferences sheet={sheet([place(0, 0, 0, 20), place(0, 0, 1, 220)])} k={1} />);
    expect(texts()).toEqual(["p1 · r1 c1", "p1 · r1 c2"]);
  });

  it("keeps the letters of the documents when there are several", () => {
    useDocumentStore.getState().setDocuments(
      [
        { id: 0, path: "/a.pdf", pages: [A4], hash: "" },
        { id: 1, path: "/b.pdf", pages: [A4], hash: "" },
      ],
      0,
    );
    render(<SheetReferences sheet={sheet([place(0, 0, 0, 20), place(1, 0, 0, 220)])} k={1} />);
    expect(texts()).toEqual(["A · p1 · r1 c1", "B · p1 · r1 c1"]);
  });

  it("uses the short form on a small piece, and nothing on a tiny one", () => {
    // 60 × 90 px: room for "r1c1" but not for "p1 · r1 c1"; 14 × 14 px: room for nothing.
    render(<SheetReferences sheet={sheet([place(0, 0, 0, 20, 60, 90), place(0, 0, 1, 120, 14, 14)])} k={1} />);
    expect(texts()).toEqual(["r1c1"]);
  });

  it("marks the common back on a back sheet, and not on a front", () => {
    const common = gridCardId(0, 0, 0, 0);
    // The common back has to be a piece of the library, or the finishing forgets it.
    usePrintStore.getState().setCards([{ id: common, source: place(0, 0, 0, 0).source, scale: 1, turn: 0 }], null);
    usePrintStore.getState().setDuplex({ on: true, commonBack: cardIdKey(common) });
    const { unmount } = render(<SheetReferences sheet={sheet([place(0, 0, 0, 20, 300)], "back")} k={1} />);
    expect(texts()).toEqual(["p1 · r1 c1 · Common back"]);
    unmount();
    render(<SheetReferences sheet={sheet([place(0, 0, 0, 20)])} k={1} />);
    expect(texts()).toEqual(["p1 · r1 c1"]);
  });

  it("does not take the pointer", () => {
    render(<SheetReferences sheet={sheet([place(0, 0, 0, 20)])} k={1} />);
    expect(screen.getByTestId("sheet-references").className).toContain("pointer-events-none");
  });
});
