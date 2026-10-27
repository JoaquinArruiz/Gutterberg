// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gridCardId } from "../../lib/card";
import { useDocumentStore } from "../../stores/document-store";
import { type PiecePeek as Peek, useUiStore } from "../../stores/ui-store";
import { PiecePeek } from "./PiecePeek";
import { PEEK_HOLD_MS, usePiecePeek } from "./use-piece-peek";

vi.mock("../../lib/use-card-image", () => ({ useCardImage: () => "blob:piece" }));

const PIECE: Peek = {
  card: gridCardId(0, 2, 1, 0),
  source: { center: { x: 100, y: 100 }, width: 180, height: 252, angle_deg: 0 },
  turn: 0,
  width: 180,
  height: 252,
};

function Piece() {
  const peek = usePiecePeek(() => PIECE);
  return <div data-testid="piece" {...peek} />;
}

const rightDown = () => fireEvent.pointerDown(screen.getByTestId("piece"), { button: 2 });
const rightUp = () => act(() => void window.dispatchEvent(new PointerEvent("pointerup", { button: 2 })));

beforeEach(() => {
  vi.useFakeTimers();
  useUiStore.getState().setPeek(null);
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [], hash: "" }], 0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a piece shown large", () => {
  it("shows while the right button is held on a piece, and goes when it is let go", () => {
    render(
      <>
        <Piece />
        <PiecePeek />
      </>,
    );
    rightDown();
    expect(screen.queryByTestId("piece-peek")).toBeNull();
    act(() => vi.advanceTimersByTime(PEEK_HOLD_MS));
    const peek = screen.getByTestId("piece-peek");
    expect(peek.getAttribute("aria-label")).toBe("p3 · r2 c1, shown large");
    expect(peek.querySelector("img")?.getAttribute("src")).toBe("blob:piece");
    rightUp();
    expect(screen.queryByTestId("piece-peek")).toBeNull();
  });

  it("stays after a quick right-click, until a click or Esc", () => {
    render(
      <>
        <Piece />
        <PiecePeek />
      </>,
    );
    rightDown();
    rightUp();
    expect(screen.getByTestId("piece-peek")).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId("piece-peek"), { button: 0 });
    expect(screen.queryByTestId("piece-peek")).toBeNull();
    rightDown();
    rightUp();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("piece-peek")).toBeNull();
  });

  it("keeps the web view's menu closed and ignores the left button", () => {
    render(
      <>
        <Piece />
        <PiecePeek />
      </>,
    );
    expect(fireEvent.contextMenu(screen.getByTestId("piece"))).toBe(false);
    fireEvent.pointerDown(screen.getByTestId("piece"), { button: 0 });
    act(() => vi.advanceTimersByTime(PEEK_HOLD_MS * 2));
    expect(screen.queryByTestId("piece-peek")).toBeNull();
  });
});
