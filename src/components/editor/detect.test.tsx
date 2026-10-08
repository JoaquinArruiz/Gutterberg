// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Detection, detectPieces, type Proposal } from "../../lib/detect-api";
import { gridGroupAt } from "../../lib/document-layout";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { DetectSection } from "../sidebar/DetectSection";
import { DetectDraftBar, DetectOverlay } from "./DetectDraft";

vi.mock("../../lib/detect-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/detect-api")>()),
  detectPieces: vi.fn(),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const detect = vi.mocked(detectPieces);
const editor = () => useEditorStore.getState();
const viewport = { zoom: 1, panX: 0, panY: 0 };

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
const rects = (n: number, confidence = 0.8): Proposal => ({
  kind: "rects",
  rects: Array.from({ length: n }, (_, i) => ({
    center: { x: 150 + i * 120, y: 200 },
    width: 100,
    height: 140,
    angle_deg: i * 3,
  })),
  confidence,
  engine: "blobs",
  notes: [],
});

/** Detects with the sidebar button and waits for the answer. */
async function detectWith(d: Detection) {
  detect.mockResolvedValue(d);
  fireEvent.click(screen.getByRole("button", { name: "Detect on this page" }));
  await act(async () => {});
}

const all = () => (
  <>
    <DetectSection />
    <svg role="img" aria-label="page">
      <DetectOverlay viewport={viewport} page={A4} />
    </svg>
    <DetectDraftBar />
  </>
);

beforeEach(() => {
  detect.mockReset();
  usePreferencesStore.getState().resetToDefaults();
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4, A4], hash: "" }], 0);
  useLayoutStore.getState().resetDocument(2);
  editor().setDraft(null);
  editor().setDetectError(null);
  editor().setTool("select");
});
afterEach(cleanup);

describe("Detect pieces section", () => {
  it("says what it does and waits to be asked", () => {
    render(<DetectSection />);
    expect(screen.getByText(/Nothing changes until you apply it/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Detect on this page" }).hasAttribute("disabled")).toBe(false);
    expect(detect).not.toHaveBeenCalled();
  });

  it("is off on a skipped page", () => {
    useLayoutStore.getState().setSkipped(0, true);
    render(<DetectSection />);
    expect(screen.getByRole("button", { name: "Detect on this page" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("This page is skipped.")).toBeTruthy();
  });

  it("shows that it is working", async () => {
    let resolve: (d: Detection) => void = () => {};
    detect.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<DetectSection />);
    fireEvent.click(screen.getByRole("button", { name: "Detect on this page" }));
    expect(screen.getByRole("button", { name: "Detecting…" }).hasAttribute("disabled")).toBe(true);
    await act(async () => resolve({ proposals: [], reasons: [] }));
    expect(screen.getByRole("button", { name: "Detect on this page" })).toBeTruthy();
  });

  it("says when nothing was found, and why", async () => {
    render(<DetectSection />);
    await detectWith({ proposals: [], reasons: ["merged_pieces"] });
    expect(screen.getByTestId("detect-none").textContent).toContain("No pieces found on this page");
    expect(screen.getByTestId("detect-none").textContent).toContain("pieces that touch cannot be told apart");
  });

  it("shows an error from the engine", async () => {
    detect.mockRejectedValue({ code: "page_out_of_range", message: "x", page: 4, count: 2 });
    render(<DetectSection />);
    fireEvent.click(screen.getByRole("button", { name: "Detect on this page" }));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("Page 4 does not exist");
  });
});

describe("the draft on the page", () => {
  it("shows a grid as dashed cells and says what it is, how sure, and how many", async () => {
    render(all());
    await detectWith({ proposals: [grid()], reasons: [] });
    expect(screen.getAllByTestId("detect-piece")).toHaveLength(9);
    expect(screen.getByTestId("detect-size").textContent).toBe("3 × 3 = 9 pieces");
    expect(screen.getByTestId("detect-engine").textContent).toBe("from the PDF's objects");
    expect(screen.getByTestId("detect-confidence").textContent).toBe("Exact");
    expect(screen.queryByText(/Low confidence: check/)).toBeNull();
    // The overlay never takes the pointer.
    expect(screen.getByTestId("detect-overlay").getAttribute("pointer-events")).toBe("none");
  });

  it("shows rectangles tilted, and a low confidence says so", async () => {
    render(all());
    await detectWith({ proposals: [rects(3, 0.5)], reasons: [] });
    const pieces = screen.getAllByTestId("detect-piece");
    expect(pieces).toHaveLength(3);
    expect(pieces[1].getAttribute("transform")).toContain("rotate(3");
    expect(screen.getByTestId("detect-confidence").textContent).toBe("Low confidence");
    expect(screen.getByText(/Low confidence: check the outlines/)).toBeTruthy();
  });

  it("words the notes of a proposal", async () => {
    render(all());
    await detectWith({ proposals: [grid({ notes: ["missing_cells", "crop_marks"] })], reasons: [] });
    expect(screen.getByText(/the last row may not be full/)).toBeTruthy();
    expect(screen.getByText(/Crop marks in the margins line up/)).toBeTruthy();
  });

  it("applies on the button and on Enter, and leaves nothing behind", async () => {
    render(all());
    await detectWith({ proposals: [grid({ rows: 2, columns: 4 })], reasons: [] });
    expect(gridGroupAt(useLayoutStore.getState().groups, 0)?.selection).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(gridGroupAt(useLayoutStore.getState().groups, 0)?.grid).toMatchObject({ rows: 2, columns: 4 });
    expect(screen.queryByTestId("detect-bar")).toBeNull();
    expect(screen.queryByTestId("detect-overlay")?.children.length ?? 0).toBe(0);

    await detectWith({ proposals: [grid({ rows: 1, columns: 2 })], reasons: [] });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(gridGroupAt(useLayoutStore.getState().groups, 0)?.grid).toMatchObject({ rows: 1, columns: 2 });
  });

  it("is discarded on the button and on Esc, changing nothing", async () => {
    render(all());
    await detectWith({ proposals: [grid()], reasons: [] });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByTestId("detect-bar")).toBeNull();
    await detectWith({ proposals: [grid()], reasons: [] });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("detect-bar")).toBeNull();
    expect(gridGroupAt(useLayoutStore.getState().groups, 0)?.selection).toBeNull();
  });

  it("leaves Enter and Esc to a field being typed in", async () => {
    render(
      <>
        {all()}
        <input aria-label="field" />
      </>,
    );
    await detectWith({ proposals: [grid()], reasons: [] });
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "Enter" });
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "Escape" });
    expect(screen.getByTestId("detect-bar")).toBeTruthy();
    expect(gridGroupAt(useLayoutStore.getState().groups, 0)?.selection).toBeNull();
  });

  it("offers the other proposals one after another", async () => {
    render(all());
    await detectWith({ proposals: [grid(), rects(4)], reasons: [] });
    expect(screen.getByTestId("detect-which").textContent).toBe("1 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Next proposal" }));
    expect(screen.getByTestId("detect-which").textContent).toBe("2 of 2");
    expect(screen.getByTestId("detect-size").textContent).toBe("4 pieces");
    expect(screen.getAllByTestId("detect-piece")).toHaveLength(4);
  });

  it("asks to replace the freeform pieces that are already on the page", async () => {
    const layout = useLayoutStore.getState();
    layout.addFreeformCard(0, { center: { x: 0.2, y: 0.2 }, width: 0.1, height: 0.1, angle_deg: 0 });
    layout.addFreeformCard(0, { center: { x: 0.6, y: 0.6 }, width: 0.1, height: 0.1, angle_deg: 0 });
    render(all());
    await detectWith({ proposals: [rects(3)], reasons: [] });
    fireEvent.click(screen.getByRole("button", { name: "Replace 2 pieces" }));
    expect(useLayoutStore.getState().freeform[0]).toHaveLength(3);
  });

  it("moves with the page: the draft is gone on another page", async () => {
    render(all());
    await detectWith({ proposals: [grid()], reasons: [] });
    act(() => useDocumentStore.getState().setCurrentPage(1));
    expect(screen.queryByTestId("detect-bar")).toBeNull();
    expect(screen.queryAllByTestId("detect-piece")).toHaveLength(0);
  });
});
