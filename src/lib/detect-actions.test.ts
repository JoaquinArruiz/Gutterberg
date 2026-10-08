import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "../stores/document-store";
import { useEditorStore } from "../stores/editor-store";
import { undo, useLayoutStore } from "../stores/layout-store";
import { usePrintStore } from "../stores/print-store";
import { gridCardId } from "./card";
import { applyDraft, discardDraft, runDetect } from "./detect-actions";
import { type Detection, detectPieces, type Proposal } from "./detect-api";
import { defaultGroups, gridGroupAt } from "./document-layout";

vi.mock("./detect-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./detect-api")>()),
  detectPieces: vi.fn(),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const detect = vi.mocked(detectPieces);
const editor = () => useEditorStore.getState();
const layout = () => useLayoutStore.getState();

const gridProposal: Proposal = {
  kind: "grid",
  bounds: { x: 59.5276, y: 84.189, width: 476.2205, height: 673.5118 },
  rows: 3,
  columns: 2,
  source_gap_x_mm: 3,
  source_gap_y_mm: 3,
  confidence: 0.95,
  engine: "pdf-objects",
  notes: [],
};
const rectsProposal: Proposal = {
  kind: "rects",
  rects: [
    { center: { x: 150, y: 200 }, width: 120, height: 170, angle_deg: -8 },
    { center: { x: 400, y: 210 }, width: 120, height: 170, angle_deg: 5 },
  ],
  confidence: 0.8,
  engine: "blobs",
  notes: [],
};
const answer = (...proposals: Proposal[]): Detection => ({ proposals, reasons: [] });

beforeEach(() => {
  detect.mockReset();
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4, A4, A4], hash: "" }], 0);
  layout().resetDocument(3);
  usePrintStore.getState().reset();
  editor().setDraft(null);
  editor().setDetectError(null);
  editor().setDetecting(false);
  editor().setTool("select");
});

describe("detecting", () => {
  it("asks for the page in front of the user and shows the answer as a draft, changing nothing", async () => {
    useDocumentStore.getState().setCurrentPage(1);
    detect.mockResolvedValue(answer(gridProposal, rectsProposal));
    const groupsBefore = layout().groups;
    const p = runDetect();
    expect(editor().detecting).toBe(true);
    await p;
    expect(detect).toHaveBeenCalledWith(0, 1);
    expect(editor().detecting).toBe(false);
    expect(editor().draft).toMatchObject({ documentId: 0, page: 1, index: 0 });
    expect(editor().draft?.detection.proposals).toHaveLength(2);
    // Nothing was applied.
    expect(layout().groups).toBe(groupsBefore);
    expect(layout().freeform).toEqual({});
  });

  it("keeps an error instead of a draft", async () => {
    detect.mockRejectedValue({ code: "pdfium", message: "boom", detail: "x" });
    await runDetect();
    expect(editor().draft).toBeNull();
    expect(editor().detectError?.code).toBe("pdfium");
    expect(editor().detecting).toBe(false);
  });

  it("ignores an answer for a page the user has left", async () => {
    let resolve: (d: Detection) => void = () => {};
    detect.mockReturnValue(new Promise((r) => (resolve = r)));
    const p = runDetect();
    useDocumentStore.getState().setCurrentPage(2);
    resolve(answer(gridProposal));
    await p;
    expect(editor().draft).toBeNull();
    expect(editor().detecting).toBe(false);
  });

  it("drops the draft when the page, the PDF or the tool changes", async () => {
    detect.mockResolvedValue(answer(gridProposal));
    for (const move of [
      () => useDocumentStore.getState().setCurrentPage(2),
      () => useEditorStore.getState().setTool("card"),
    ]) {
      useDocumentStore.getState().setCurrentPage(0);
      useEditorStore.getState().setTool("select");
      await runDetect();
      expect(editor().draft).not.toBeNull();
      move();
      expect(editor().draft).toBeNull();
    }
    await runDetect();
    useDocumentStore.getState().setDocuments(
      [
        { id: 0, path: "/x.pdf", pages: [A4, A4, A4], hash: "" },
        { id: 1, path: "/y.pdf", pages: [A4], hash: "" },
      ],
      0,
    );
    expect(editor().draft).not.toBeNull();
    useDocumentStore.getState().setActive(1);
    expect(editor().draft).toBeNull();
  });

  it("cycles through the proposals and wraps round", async () => {
    detect.mockResolvedValue(answer(gridProposal, rectsProposal));
    await runDetect();
    editor().nextProposal();
    expect(editor().draft?.index).toBe(1);
    editor().nextProposal();
    expect(editor().draft?.index).toBe(0);
  });

  it("discarding leaves the layout alone", async () => {
    detect.mockResolvedValue(answer(gridProposal));
    await runDetect();
    const groups = layout().groups;
    discardDraft();
    expect(editor().draft).toBeNull();
    expect(layout().groups).toBe(groups);
  });
});

describe("applying a grid", () => {
  it("sets the region and the grid of the page's group, and is one undo step", async () => {
    detect.mockResolvedValue(answer(gridProposal));
    await runDetect();
    applyDraft();
    const group = gridGroupAt(layout().groups, 0);
    expect(group?.selection?.x).toBeCloseTo(0.1, 4);
    expect(group?.selection?.width).toBeCloseTo(0.8, 4);
    expect(group?.grid).toMatchObject({ rows: 3, columns: 2, sourceGapXMm: 3, sourceGapYMm: 3, sourceGapLinked: true });
    expect(editor().draft).toBeNull();

    undo();
    expect(gridGroupAt(layout().groups, 0)?.selection).toBeNull();
    expect(layout().groups).toEqual(defaultGroups(3));
  });

  it("does nothing once the user is on another page", async () => {
    detect.mockResolvedValue(answer(gridProposal));
    await runDetect();
    // The draft is dropped by moving, so a stray apply finds nothing to apply.
    useDocumentStore.getState().setCurrentPage(1);
    applyDraft();
    expect(gridGroupAt(layout().groups, 1)?.selection).toBeNull();
  });
});

describe("applying rectangles", () => {
  it("makes freeform pieces on the page, normalized, in one undo step", async () => {
    detect.mockResolvedValue(answer(rectsProposal));
    await runDetect();
    applyDraft();
    const cards = layout().freeform[0];
    expect(cards).toHaveLength(2);
    expect(cards[0].center.x).toBeCloseTo(150 / A4.width_pt, 5);
    expect(cards[0].angle_deg).toBe(-8);
    undo();
    expect(layout().freeform).toEqual({});
  });

  it("replaces the page's freeform pieces, and their edits and copies go with them", async () => {
    layout().addFreeformCard(0, { center: { x: 0.2, y: 0.2 }, width: 0.1, height: 0.1, angle_deg: 0 });
    layout().addFreeformCard(0, { center: { x: 0.6, y: 0.6 }, width: 0.1, height: 0.1, angle_deg: 0 });
    layout().setCardEdits({
      turns: { "f:0:0:1": 90 },
      scales: {},
      order: ["f:0:0:1", "f:0:0:0"],
      backs: { "f:0:0:0": "f:0:0:1" },
    });
    usePrintStore.getState().setQuantity(["f:0:0:1", "g:0:1:0:0"], 3);
    detect.mockResolvedValue(answer(rectsProposal));
    await runDetect();
    applyDraft();
    expect(layout().freeform[0]).toHaveLength(2);
    expect(layout().freeform[0][0].angle_deg).toBe(-8);
    expect(layout().cardEdits).toEqual({ turns: {}, scales: {}, order: [], backs: {} });
    expect(usePrintStore.getState().quantities).toEqual({ "g:0:1:0:0": 3 });
    // Other pages' pieces are not touched.
    expect(gridCardId(0, 1, 0, 0).kind).toBe("grid");
  });
});
