import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "../stores/document-store";
import { useEditorStore } from "../stores/editor-store";
import { undo, useLayoutStore } from "../stores/layout-store";
import { usePreferencesStore } from "../stores/preferences-store";
import type { OrientedRect } from "./card";
import {
  DUPLICATE_OFFSET_MM,
  deletePicked,
  duplicatePicked,
  NUDGE_BURST_MS,
  nudgePicked,
  pickAllPieces,
} from "./editor-actions";
import { mmToPt } from "./units";

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const layout = () => useLayoutStore.getState();
const editor = () => useEditorStore.getState();
const pieces = () => layout().freeform[0] ?? [];
const piece = (x: number, y: number): OrientedRect => ({ center: { x, y }, width: 0.1, height: 0.1, angle_deg: 0 });
const mmX = (mm: number) => mmToPt(mm) / A4.width_pt;
const mmY = (mm: number) => mmToPt(mm) / A4.height_pt;

beforeEach(() => {
  vi.useFakeTimers();
  usePreferencesStore.getState().resetToDefaults();
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4, A4], hash: "" }], 0);
  layout().resetDocument(2);
  useEditorStore.setState({ tool: "card", selectedCard: null, pickedCards: [], pickedRegion: null });
  layout().addFreeformCard(0, piece(0.3, 0.3));
  layout().addFreeformCard(0, piece(0.6, 0.6));
  layout().addFreeformCard(0, piece(0.5, 0.2));
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("the arrow keys", () => {
  it("move the picked pieces 1 mm, 10 mm with Shift, together", () => {
    editor().pickCards(0, [0, 1]);
    expect(nudgePicked(1, 0, false)).toBe(true);
    expect(pieces()[0].center.x).toBeCloseTo(0.3 + mmX(1), 9);
    expect(pieces()[1].center.x).toBeCloseTo(0.6 + mmX(1), 9);
    expect(nudgePicked(0, 1, true)).toBe(true);
    expect(pieces()[0].center.y).toBeCloseTo(0.3 + mmY(10), 9);
    // The piece that is not picked stays.
    expect(pieces()[2]).toEqual(piece(0.5, 0.2));
  });

  it("move by 0.05 in when the unit is inches", () => {
    usePreferencesStore.getState().setUnit("in");
    editor().pickCards(0, [0]);
    nudgePicked(-1, 0, false);
    expect(pieces()[0].center.x).toBeCloseTo(0.3 - mmX(1.27), 9);
  });

  it("make a burst of presses one undo step", () => {
    editor().pickCards(0, [0]);
    nudgePicked(1, 0, false);
    nudgePicked(1, 0, false);
    vi.advanceTimersByTime(NUDGE_BURST_MS / 2);
    nudgePicked(1, 0, false);
    vi.advanceTimersByTime(NUDGE_BURST_MS + 1);
    expect(pieces()[0].center.x).toBeCloseTo(0.3 + mmX(3), 9);
    undo();
    expect(pieces()[0]).toEqual(piece(0.3, 0.3));
  });

  it("keep a group's shape at the edge of the page", () => {
    layout().updateFreeformCard(0, 0, piece(0.999, 0.3));
    editor().pickCards(0, [0, 1]);
    nudgePicked(1, 0, true);
    expect(pieces()[0].center.x).toBeCloseTo(1, 9);
    expect(pieces()[1].center.x).toBeCloseTo(0.601, 9);
  });

  it("move the grid region once it is picked, and change page otherwise", () => {
    useEditorStore.setState({ tool: "grid" });
    layout().setSelection(0, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    expect(nudgePicked(1, 0, false)).toBe(false);
    editor().setPickedRegion(0);
    expect(nudgePicked(1, 0, false)).toBe(true);
    const group = layout().groups[0];
    const region = group.kind === "grid" ? group.grids[0].selection : null;
    expect(region?.x).toBeCloseTo(0.1 + mmX(1), 9);
    // A region picked on another page does not move this one.
    editor().setPickedRegion(1);
    expect(nudgePicked(1, 0, false)).toBe(false);
  });

  it("move what the Select tool picked: the pieces when there are any, else the region", () => {
    useEditorStore.setState({ tool: "pick" });
    layout().setSelection(0, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    editor().setPickedRegion(0);
    editor().pickCards(0, [1]);
    const x = pieces()[1].center.x;
    expect(nudgePicked(1, 0, false)).toBe(true);
    expect(pieces()[1].center.x).toBeCloseTo(x + mmX(1), 9);
    editor().setSelectedCard(null);
    expect(nudgePicked(1, 0, false)).toBe(true);
    const group = layout().groups[0];
    expect(group.kind === "grid" ? group.grids[0].selection?.x : 0).toBeCloseTo(0.1 + mmX(1), 9);
  });

  it("do nothing with nothing picked, or with the pieces picked on another page", () => {
    expect(nudgePicked(1, 0, false)).toBe(false);
    editor().pickCards(1, [0]);
    expect(nudgePicked(1, 0, false)).toBe(false);
  });
});

describe("duplicate, pick all and delete", () => {
  it("copies the picked pieces down and to the right, picks the copies, as one undo step", () => {
    editor().pickCards(0, [0, 2]);
    expect(duplicatePicked()).toBe(true);
    expect(pieces()).toHaveLength(5);
    expect(pieces()[3].center.x).toBeCloseTo(0.3 + mmX(DUPLICATE_OFFSET_MM), 9);
    expect(pieces()[3].center.y).toBeCloseTo(0.3 + mmY(DUPLICATE_OFFSET_MM), 9);
    expect(pieces()[4].center.x).toBeCloseTo(0.5 + mmX(DUPLICATE_OFFSET_MM), 9);
    expect(editor().pickedCards).toEqual([3, 4]);
    expect(editor().selectedCard).toEqual({ page: 0, index: 4 });
    undo();
    expect(pieces()).toHaveLength(3);
  });

  it("picks every piece of the page with the Piece tool", () => {
    useEditorStore.setState({ tool: "grid" });
    expect(pickAllPieces()).toBe(true);
    expect(editor().tool).toBe("card");
    expect(editor().pickedCards).toEqual([0, 1, 2]);
    useDocumentStore.getState().setCurrentPage(1);
    expect(pickAllPieces()).toBe(false);
  });

  it("deletes the picked pieces as one undo step", () => {
    editor().pickCards(0, [0, 2]);
    expect(deletePicked()).toBe(true);
    expect(pieces()).toEqual([piece(0.6, 0.6)]);
    expect(editor().selectedCard).toBeNull();
    undo();
    expect(pieces()).toHaveLength(3);
  });
});

describe("the arrow keys with a folder of grids", () => {
  const A = { x: 0.1, y: 0.1, width: 0.3, height: 0.2 };
  const B = { x: 0.5, y: 0.1, width: 0.3, height: 0.2 };
  const C = { x: 0.1, y: 0.6, width: 0.3, height: 0.2 };
  const grids = () => {
    const g = layout().groups[0];
    return g.kind === "grid" ? g.grids : [];
  };
  beforeEach(() => {
    layout().setSelection(0, A);
    layout().addGrid(0);
    layout().setSelection(0, B);
    layout().addGrid(0);
    layout().setSelection(0, C);
    layout().setGridLook(0, 0, { folder: "Top" });
    layout().setGridLook(0, 1, { folder: "Top" });
    useEditorStore.setState({ tool: "grid", pickedRegion: 0 });
  });

  it("move every grid of the picked folder, and only them", () => {
    layout().pickFolder(0, "Top");
    expect(layout().activeGrid).toBe(0);
    expect(nudgePicked(0, 1, false)).toBe(true);
    expect(grids()[0].selection?.y).toBeCloseTo(0.1 + mmY(1), 9);
    expect(grids()[1].selection?.y).toBeCloseTo(0.1 + mmY(1), 9);
    expect(grids()[2].selection).toEqual(C);
  });

  it("stop the folder as one at the page's edge", () => {
    layout().pickFolder(0, "Top");
    for (let i = 0; i < 40; i++) nudgePicked(1, 0, true);
    expect(grids()[1].selection?.x).toBeCloseTo(0.7, 9);
    // The other grid kept its distance.
    expect(grids()[0].selection?.x).toBeCloseTo(0.3, 9);
  });

  it("move a grid on its own once it is picked alone, even in a folder", () => {
    layout().pickFolder(0, "Top");
    layout().setActiveGrid(1);
    expect(layout().pickedFolder).toBeNull();
    nudgePicked(1, 0, false);
    expect(grids()[0].selection).toEqual(A);
    expect(grids()[1].selection?.x).toBeCloseTo(0.5 + mmX(1), 9);
  });
});
