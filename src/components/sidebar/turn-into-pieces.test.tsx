// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gridCardId } from "../../lib/card";
import { gridGroupAt } from "../../lib/document-layout";
import type { Card } from "../../lib/sheet-api";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { TurnIntoPiecesButton } from "./TurnIntoPiecesButton";

const cards: Card[] = [0, 1, 2].flatMap((page) =>
  [0, 1].map((column) => ({
    id: gridCardId(0, page, 0, column),
    source: { center: { x: 100 + column * 200, y: 100 }, width: 180, height: 190, angle_deg: 0 },
    scale: 1,
    turn: 0 as const,
  })),
);
const computeCards = vi.fn(async () => cards);
vi.mock("../../lib/sheet-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sheet-api")>()),
  computeCards: (...a: unknown[]) => (computeCards as (...x: unknown[]) => unknown)(...a),
}));

const PAGE = { width_pt: 600, height_pt: 800 };
const REGION = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
const store = () => useLayoutStore.getState();

beforeEach(() => {
  computeCards.mockClear();
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/a.pdf", pages: Array(3).fill(PAGE), hash: "" }], 0);
  store().resetDocument(3);
  store().setSelection(0, REGION);
});
afterEach(cleanup);

describe("Turn into pieces", () => {
  it("is off until a region is drawn", () => {
    store().setSelection(0, null);
    render(<TurnIntoPiecesButton />);
    expect((screen.getByRole("button", { name: "Turn into pieces" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks which pages when the grid is shared, and turns only this one when told", async () => {
    render(<TurnIntoPiecesButton />);
    fireEvent.click(screen.getByRole("button", { name: "Turn into pieces" }));
    expect(screen.getByRole("radio", { name: /Every page of the group \(3\)/ })).toBeTruthy();
    expect(computeCards).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Turn into pieces" })[1]);
    });
    expect(store().freeform[0]).toHaveLength(2);
    expect(store().freeform[1]).toBeUndefined();
    expect(gridGroupAt(store().groups, 1)?.selection).toEqual(REGION);
    expect(screen.getByRole("status").textContent).toContain("2 pieces made");
  });

  it("turns every page of the group when told", async () => {
    render(<TurnIntoPiecesButton />);
    fireEvent.click(screen.getByRole("button", { name: "Turn into pieces" }));
    fireEvent.click(screen.getByRole("radio", { name: /Every page of the group/ }));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Turn into pieces" })[1]);
    });
    for (const p of [0, 1, 2]) expect(store().freeform[p]).toHaveLength(2);
  });

  it("does not ask when the page has a grid of its own", async () => {
    store().applyGrid(0, [0]);
    store().setSelection(0, REGION);
    render(<TurnIntoPiecesButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Turn into pieces" }));
    });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(store().freeform[0]).toHaveLength(2);
  });

  it("says when the engine finds nothing to turn", async () => {
    computeCards.mockResolvedValueOnce([]);
    store().applyGrid(0, [0]);
    store().setSelection(0, REGION);
    render(<TurnIntoPiecesButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Turn into pieces" }));
    });
    expect(screen.getByRole("status").textContent).toBe("This grid has no pieces to turn.");
  });
});
