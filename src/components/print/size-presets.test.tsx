// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardIdKey, freeformCardId } from "../../lib/card";
import type { Card } from "../../lib/sheet-api";
import { mmToPt } from "../../lib/units";
import { useDocumentStore } from "../../stores/document-store";
import { redo, undo, useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { PrintInspector } from "./PrintInspector";

const ask = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: (...a: unknown[]) => ask(...a) }));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const piece = (index: number, w: number, h: number): Card => ({
  id: freeformCardId(0, 0, index),
  source: { center: { x: 100 + index * 10, y: 100 }, width: mmToPt(w), height: mmToPt(h), angle_deg: 0 },
  scale: 1,
  turn: 0,
});
const cards = [piece(0, 60, 80), piece(1, 80, 60)];
const key = (c: Card) => cardIdKey(c.id);
const edits = () => useLayoutStore.getState().cardEdits;
/** What a piece prints at, in mm, from the scales the edits hold. */
const printedMm = (c: Card) => {
  const x = edits().scales[key(c)] ?? 1;
  const y = edits().scalesY?.[key(c)] ?? x;
  const round = (pt: number) => Math.round((pt / mmToPt(1)) * 10) / 10;
  return [round(c.source.width * x), round(c.source.height * y)];
};

function choose(selectName: string, optionName: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: selectName }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}
const select = (...ks: string[]) => act(() => usePrintStore.getState().selectAll(ks));

beforeEach(() => {
  ask.mockReset();
  ask.mockResolvedValue(true);
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  usePreferencesStore.getState().resetToDefaults();
  usePrintStore.getState().reset();
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4], hash: "" }], 0);
  useLayoutStore.getState().resetDocument(1);
  usePrintStore.getState().setCards(cards, null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("size presets for the selected pieces", () => {
  it("sets the real size of the selection from a built-in size, as one undo step", async () => {
    select(key(cards[0]));
    render(<PrintInspector />);
    choose("Size preset", /^Standard:/);
    await act(async () => {});
    // 60 × 80 is not 63 × 88: it is stretched, so the app asked first.
    expect(ask).toHaveBeenCalledTimes(1);
    expect(printedMm(cards[0])).toEqual([63, 88]);
    act(() => undo());
    expect(edits().scales[key(cards[0])]).toBeUndefined();
    act(() => redo());
    expect(printedMm(cards[0])).toEqual([63, 88]);
  });

  it("changes nothing when the stretch is declined", async () => {
    ask.mockResolvedValue(false);
    select(key(cards[0]));
    render(<PrintInspector />);
    choose("Size preset", /^Standard:/);
    await act(async () => {});
    expect(edits().scales[key(cards[0])]).toBeUndefined();
  });

  it("does not ask when the proportions already match, and each piece gets its own scale", async () => {
    const same = [piece(0, 60, 83.8), piece(1, 120, 167.6)];
    usePrintStore.getState().setCards(same, null);
    select(key(same[0]), key(same[1]));
    render(<PrintInspector />);
    choose("Size preset", /^Standard:/);
    await act(async () => {});
    expect(ask).not.toHaveBeenCalled();
    expect(printedMm(same[0])).toEqual([63, 88]);
    expect(printedMm(same[1])).toEqual([63, 88]);
  });

  it("fixes only the width of a saved size, keeping each piece's proportions", async () => {
    usePreferencesStore.getState().saveSizePreset({ name: "62 wide", widthMm: 62, heightMm: null });
    select(key(cards[0]), key(cards[1]));
    render(<PrintInspector />);
    choose("Size preset", /62 wide/);
    await act(async () => {});
    expect(ask).not.toHaveBeenCalled();
    expect(printedMm(cards[0])).toEqual([62, 82.7]);
    expect(printedMm(cards[1])).toEqual([62, 46.5]);
  });
});

describe("your own sizes", () => {
  it("saves the size of the selection under a name, renames it and deletes it", () => {
    select(key(cards[0]));
    render(<PrintInspector />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name for this size" }), { target: { value: "Sleeves" } });
    fireEvent.click(screen.getByRole("radio", { name: "Width only" }));
    fireEvent.click(screen.getByRole("button", { name: "Save size" }));
    expect(usePreferencesStore.getState().prefs.sizePresets).toEqual([
      { name: "Sleeves", widthMm: 60, heightMm: null },
    ]);
    const rename = screen.getByRole("textbox", { name: "Rename Sleeves" });
    fireEvent.change(rename, { target: { value: "Perfect fits" } });
    fireEvent.blur(rename);
    expect(usePreferencesStore.getState().prefs.sizePresets.map((p) => p.name)).toEqual(["Perfect fits"]);
    fireEvent.click(screen.getByRole("button", { name: "Delete Perfect fits" }));
    expect(usePreferencesStore.getState().prefs.sizePresets).toEqual([]);
  });

  it("will not rename a size to the name of another", () => {
    const s = usePreferencesStore.getState();
    s.saveSizePreset({ name: "A", widthMm: 60, heightMm: 80 });
    s.saveSizePreset({ name: "B", widthMm: 70, heightMm: 70 });
    usePreferencesStore.getState().renameSizePreset("B", "a");
    expect(usePreferencesStore.getState().prefs.sizePresets.map((p) => p.name)).toEqual(["A", "B"]);
  });
});
