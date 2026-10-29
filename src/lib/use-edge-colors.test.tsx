// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePrintStore } from "../stores/print-store";
import { gridCardId } from "./card";
import type { Card } from "./sheet-api";
import { useEdgeColors } from "./use-edge-colors";

const calls = vi.hoisted(() => ({ pieces: [] as unknown[][] }));
vi.mock("./tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tauri")>()),
  edgeColors: vi.fn(async (pieces: unknown[]) => {
    calls.pieces.push(pieces);
    return pieces.map((_, i) => (i === 0 ? "#112233" : "#445566"));
  }),
}));

const card = (column: number): Card => ({
  id: gridCardId(0, 0, 0, column),
  source: { center: { x: 50 + column * 100, y: 50 }, width: 90, height: 90, angle_deg: 0 },
  scale: 1,
  turn: 0,
});
const print = () => usePrintStore.getState();

beforeEach(() => {
  vi.useFakeTimers();
  calls.pieces.length = 0;
  print().reset();
  print().setCards([card(0), card(1)], null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the Edge bleed's colours", () => {
  it("are found for every piece once the Edge bleed is on, without an undo step of their own", async () => {
    renderHook(() => useEdgeColors());
    await act(async () => vi.advanceTimersByTime(1000));
    expect(calls.pieces).toHaveLength(0);

    act(() => print().setBleed({ mm: 2, source: "edge" }));
    const steps = usePrintStore.temporal.getState().pastStates.length;
    await act(async () => vi.advanceTimersByTime(1000));
    expect(calls.pieces).toEqual([
      [
        { documentId: 0, pageIndex: 0, source: card(0).source },
        { documentId: 0, pageIndex: 0, source: card(1).source },
      ],
    ]);
    expect(print().finish.bleed.edgeColors).toEqual({ "g:0:0:0:0": "#112233", "g:0:0:0:1": "#445566" });
    expect(usePrintStore.temporal.getState().pastStates.length).toBe(steps);
  });

  it("are found again when the pieces change", async () => {
    print().setBleed({ mm: 2, source: "edge" });
    renderHook(() => useEdgeColors());
    await act(async () => vi.advanceTimersByTime(1000));
    act(() => print().setCards([card(0)], null));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(calls.pieces).toHaveLength(2);
    expect(print().finish.bleed.edgeColors).toEqual({ "g:0:0:0:0": "#112233" });
  });
});
