// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiEstimatePairing, aiPairBacks, type Estimate } from "../../lib/ai-api";
import { cardIdKey, gridCardId } from "../../lib/card";
import type { Card } from "../../lib/sheet-api";
import { useAiStore } from "../../stores/ai-store";
import { useDocumentStore } from "../../stores/document-store";
import { clearHistory, undo } from "../../stores/history";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { AiConfirmDialog } from "../ai/AiConfirmDialog";
import { PrintInspector } from "./PrintInspector";

vi.mock("../../lib/ai-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ai-api")>()),
  aiEstimatePairing: vi.fn(),
  aiPairBacks: vi.fn(),
  syncAiGate: vi.fn(async () => {}),
}));

const piece = (page: number, row: number, column: number): Card => ({
  id: gridCardId(0, page, row, column),
  source: { center: { x: 100, y: 100 }, width: 180, height: 250, angle_deg: 0 },
  scale: 1,
  turn: 0,
});
// Two decks with a back each: three fronts on page 1, the two backs on page 2.
const cards = [piece(0, 0, 0), piece(0, 0, 1), piece(0, 0, 2), piece(1, 0, 0), piece(1, 0, 1)];
const key = (c: Card) => cardIdKey(c.id);
const print = () => usePrintStore.getState();
const layout = () => useLayoutStore.getState();
const estimate: Estimate = {
  requests: 1,
  images: 5,
  input_tokens: 1200,
  output_tokens: 456,
  host: "api.anthropic.com",
  sends_images: true,
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  usePreferencesStore.getState().resetToDefaults();
  layout().resetDocument(2);
  print().reset();
  print().setCards(cards, null);
  print().setDuplex({ on: true });
  useDocumentStore.getState().clear();
  useAiStore.getState().clear();
  clearHistory();
  vi.mocked(aiEstimatePairing).mockReset().mockResolvedValue(estimate);
  vi.mocked(aiPairBacks)
    .mockReset()
    .mockResolvedValue({
      pieces: [
        { index: 0, side: "front", back: 3, upside_down: false },
        { index: 1, side: "front", back: 4, upside_down: false },
        { index: 2, side: "front", back: 3, upside_down: false },
        { index: 3, side: "back", back: null, upside_down: true },
        { index: 4, side: "back", back: null, upside_down: false },
      ],
      usage: { input_tokens: 1100, output_tokens: 120 },
    });
});
afterEach(cleanup);

function openDialog() {
  render(
    <>
      <PrintInspector />
      <AiConfirmDialog />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Duplex" }));
  fireEvent.click(screen.getByRole("button", { name: "Pair backs automatically…" }));
  return screen.getByRole("dialog", { name: "Pair backs automatically" });
}

describe("Pair backs with AI", () => {
  it("is not offered while AI Mode is off", () => {
    openDialog();
    expect(screen.queryByRole("radio", { name: /By picture, with AI/ })).toBeNull();
  });

  it("asks first, sends a named picture of every piece, and applies the answer as one undo step", async () => {
    usePreferencesStore.getState().setAiEnabled(true);
    openDialog();
    fireEvent.click(screen.getByRole("radio", { name: /By picture, with AI/ }));
    // Nothing found yet, and nothing sent: the rule's options are gone, Apply waits for an answer.
    expect(screen.getByTestId("pairing-summary").textContent).toMatch(/Nothing is sent until/);
    expect(screen.queryByRole("checkbox", { name: /Backs are upside down/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Find backs with AI" })));
    const sent = vi.mocked(aiEstimatePairing).mock.calls[0][0];
    expect(sent.map((p) => p.name)).toEqual([
      "page 1, grid 1, row 1, column 1",
      "page 1, grid 1, row 1, column 2",
      "page 1, grid 1, row 1, column 3",
      "page 2, grid 1, row 1, column 1",
      "page 2, grid 1, row 1, column 2",
    ]);
    expect(aiPairBacks).not.toHaveBeenCalled();
    expect(screen.getByTestId("ai-what").textContent).toBe(
      "5 pieces will be sent as small pictures, about 256 px each, in one request.",
    );

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(aiPairBacks).toHaveBeenCalledWith(sent);
    expect(screen.getByTestId("pairing-summary").textContent).toBe("3 fronts paired with their backs.");

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(layout().cardEdits.backs).toEqual({
      [key(cards[0])]: key(cards[3]),
      [key(cards[1])]: key(cards[4]),
      [key(cards[2])]: key(cards[3]),
    });
    expect(layout().cardEdits.turns).toEqual({ [key(cards[3])]: 180 });
    expect(print().quantities).toEqual({ [key(cards[0])]: 1, [key(cards[1])]: 1, [key(cards[2])]: 1 });
    expect(useAiStore.getState().pairing).toBeNull();

    undo();
    expect(layout().cardEdits.backs).toEqual({});
  });

  it("shows why it cannot run", async () => {
    usePreferencesStore.getState().setAiEnabled(true);
    vi.mocked(aiEstimatePairing).mockRejectedValue({
      code: "ai_too_many_pieces",
      message: "x",
      count: 140,
      max: 100,
    });
    openDialog();
    fireEvent.click(screen.getByRole("radio", { name: /By picture, with AI/ }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Find backs with AI" })));
    expect(screen.getByRole("alert").textContent).toMatch(/140 pieces.*100 at most/);
  });
});
