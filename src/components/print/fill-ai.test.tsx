// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiFillEdge, type EdgeFill } from "../../lib/ai-api";
import { cardIdKey, gridCardId } from "../../lib/card";
import { saveFills } from "../../lib/project-api";
import type { Card } from "../../lib/sheet-api";
import { clearHistory, undo } from "../../stores/history";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { useProjectStore } from "../../stores/project-store";
import { PrintInspector } from "./PrintInspector";

vi.mock("../../lib/ai-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ai-api")>()),
  aiFillEdge: vi.fn(),
  syncAiGate: vi.fn(async () => {}),
}));
vi.mock("../../lib/project-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/project-api")>()),
  saveFills: vi.fn(),
}));

const piece = (column: number): Card => ({
  id: gridCardId(0, 0, 0, column),
  source: { center: { x: 100, y: 100 }, width: 180, height: 250, angle_deg: 0 },
  scale: 1,
  turn: 0,
});
const cards = [piece(0), piece(1)];
const print = () => usePrintStore.getState();
const made: EdgeFill = {
  before: "QkVGT1JF",
  after: "QUZURVI=",
  fill: "RklMTA==",
  inset: 35,
  hash: "abcdef012345",
  usage: { input_tokens: 1300, output_tokens: 1290 },
};

function choose(selectName: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: selectName }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  usePreferencesStore.getState().resetToDefaults();
  useLayoutStore.getState().resetDocument(1);
  useProjectStore.getState().setSaved("/games/deck.gtr", null);
  print().reset();
  print().setCards(cards, null);
  print().setBleed({ mm: 3 });
  clearHistory();
  vi.mocked(aiFillEdge).mockReset();
  vi.mocked(saveFills)
    .mockReset()
    .mockImplementation(async (_project, fills) => fills.map((f) => `${f.key.replaceAll(":", "-")}-${f.hash}.png`));
});
afterEach(cleanup);

function setUpAi() {
  const prefs = usePreferencesStore.getState();
  prefs.setAiEnabled(true);
  prefs.setAiProvider("gemini");
  prefs.setAiProviderSettings("gemini", { imageModel: "gemini-2.5-flash-image" });
}

function openBleed() {
  render(<PrintInspector />);
  fireEvent.click(screen.getByRole("button", { name: "Bleed" }));
}

describe("Fill with AI", () => {
  it("is not a bleed source while AI Mode is off", () => {
    openBleed();
    fireEvent.click(screen.getByRole("combobox", { name: "Taken from" }));
    expect(screen.queryByRole("option", { name: "Fill with AI" })).toBeNull();
  });

  it("says what is missing before anything can be sent", () => {
    setUpAi();
    usePreferencesStore.getState().setAiProviderSettings("gemini", { imageModel: "" });
    openBleed();
    choose("Taken from", "Fill with AI");
    fireEvent.click(screen.getByRole("button", { name: "Fill with AI…" }));
    expect(screen.getByTestId("ai-fill-blocked").textContent).toMatch(/Choose an image model/);
    expect(screen.getByRole("button", { name: "Send 2 pieces" }).hasAttribute("disabled")).toBe(true);
    expect(aiFillEdge).not.toHaveBeenCalled();
  });

  it("sends each piece, shows what came back, and keeps the ticked fills as one undo step", async () => {
    setUpAi();
    vi.mocked(aiFillEdge)
      .mockResolvedValueOnce(made)
      .mockRejectedValueOnce({ code: "fill_reply", message: "another shape", params: { detail: "another shape" } });
    openBleed();
    choose("Taken from", "Fill with AI");
    fireEvent.click(screen.getByRole("button", { name: "Fill with AI…" }));
    expect(screen.getByTestId("ai-fill-what").textContent).toMatch(
      /2 pieces will be sent to generativelanguage.googleapis.com .* gemini-2.5-flash-image: 2 paid image requests/,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send 2 pieces" })));
    expect(vi.mocked(aiFillEdge).mock.calls.map((c) => [c[0], c[1], c[3]])).toEqual([
      [0, 0, 3],
      [0, 0, 3],
    ]);
    // The first came back; the second's picture was refused, and says so.
    expect(screen.getByRole("img", { name: "With the AI fill" }).getAttribute("src")).toBe(
      `data:image/png;base64,${made.after}`,
    );
    expect(screen.getByText(/Piece 2: The picture that came back cannot be used/)).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use 1 fill" })));
    expect(saveFills).toHaveBeenCalledWith("/games/deck.gtr", [
      { key: cardIdKey(cards[0].id), png: made.fill, hash: made.hash },
    ]);
    expect(print().finish.bleed.aiFills).toEqual({
      [cardIdKey(cards[0].id)]: { file: "g-0-0-0-0-abcdef012345.png", inset: 35 },
    });
    expect(screen.getByTestId("ai-fill-count").textContent).toMatch(/1 of 2 pieces have an AI fill/);
    undo();
    expect(print().finish.bleed.aiFills).toEqual({});
    expect(print().finish.bleed.source).toBe("ai");
  });

  it("stops at an error that is not about one piece, and keeps nothing", async () => {
    setUpAi();
    vi.mocked(aiFillEdge).mockRejectedValue({ code: "ai_no_key", message: "no key", params: {} });
    openBleed();
    choose("Taken from", "Fill with AI");
    fireEvent.click(screen.getByRole("button", { name: "Fill with AI…" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send 2 pieces" })));
    expect(aiFillEdge).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toMatch(/Stopped: No API key is saved/);
    expect(screen.getByRole("button", { name: "Use 0 fills" }).hasAttribute("disabled")).toBe(true);
    expect(saveFills).not.toHaveBeenCalled();
  });
});
