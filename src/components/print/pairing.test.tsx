// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardIdKey, gridCardId } from "../../lib/card";
import type { Card } from "../../lib/sheet-api";
import { useDocumentStore } from "../../stores/document-store";
import { clearHistory, undo } from "../../stores/history";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { PrintInspector } from "./PrintInspector";

const piece = (page: number, row: number, column: number): Card => ({
  id: gridCardId(0, page, row, column),
  source: { center: { x: 100, y: 100 }, width: 180, height: 250, angle_deg: 0 },
  scale: 1,
  turn: 0,
});
// A duplex file: two fronts on page 1, their backs mirrored on page 2, and one piece on page 3 with no back.
const cards = [piece(0, 0, 0), piece(0, 0, 1), piece(1, 0, 0), piece(1, 0, 1), piece(2, 0, 0)];
const key = (c: Card) => cardIdKey(c.id);
const print = () => usePrintStore.getState();
const layout = () => useLayoutStore.getState();

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  usePreferencesStore.getState().resetToDefaults();
  layout().resetDocument(3);
  print().reset();
  print().setCards(cards, null);
  print().setDuplex({ on: true });
  useDocumentStore.getState().clear();
  clearHistory();
});
afterEach(cleanup);

function openDialog() {
  render(<PrintInspector />);
  fireEvent.click(screen.getByRole("button", { name: "Duplex" }));
  fireEvent.click(screen.getByRole("button", { name: "Pair backs automatically…" }));
  return screen.getByRole("dialog", { name: "Pair backs automatically" });
}

describe("Pair backs automatically", () => {
  it("shows what the rule finds as it changes", () => {
    openDialog();
    const summary = screen.getByTestId("pairing-summary");
    // Pages 1 and 2 pair; page 3 is a front whose back page is missing.
    expect(summary.textContent).toBe("2 fronts paired with their backs. 1 piece left without a pair.");
    // One row per page: nothing below anything, so nothing pairs, and there is nothing to apply.
    fireEvent.click(screen.getByRole("radio", { name: /Beside each other on the page/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Bottom half" }));
    expect(summary.textContent).toBe("No pairs found with this rule.");
    expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true);
  });

  it("turns the backs upside down by default for backs below the fronts", () => {
    openDialog();
    const upside = () => screen.getByRole("checkbox", { name: /Backs are upside down/ });
    expect(upside().getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("radio", { name: /Beside each other on the page/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Bottom half" }));
    expect(upside().getAttribute("aria-checked")).toBe("true");
  });

  it("gives each front its back, prints only the fronts, and is one undo step", () => {
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(layout().cardEdits.backs).toEqual({
      [key(cards[0])]: key(cards[3]),
      [key(cards[1])]: key(cards[2]),
    });
    expect(print().mode).toBe("custom");
    expect(print().quantities).toEqual({ [key(cards[0])]: 1, [key(cards[1])]: 1, [key(cards[4])]: 1 });
    expect(screen.queryByRole("dialog")).toBeNull();

    undo();
    expect(layout().cardEdits.backs).toEqual({});
    expect(print().mode).toBe("all");
  });
});

describe("Pair backs from another PDF", () => {
  const doc = (id: number, name: string) => ({
    id,
    path: `/games/${name}`,
    pages: [],
    hash: "0".repeat(64),
  });
  const other = (page: number, column: number): Card => ({
    ...piece(page, 0, column),
    id: gridCardId(1, page, 0, column),
  });

  it("offers the choice only with two or more PDFs", () => {
    useDocumentStore.getState().setDocuments([doc(0, "fronts.pdf")], 0);
    openDialog();
    expect(screen.queryByRole("radio", { name: /Backs in another PDF/ })).toBeNull();
  });

  it("pairs page n with page n of the PDF picked, takes the backs out of the copies, and is one undo step", () => {
    useDocumentStore.getState().setDocuments([doc(0, "fronts.pdf"), doc(1, "backs.pdf")], 0);
    print().setCards([piece(0, 0, 0), piece(0, 0, 1), other(0, 0), other(0, 1), other(1, 0)], null);
    openDialog();
    fireEvent.click(screen.getByRole("radio", { name: /Backs in another PDF/ }));
    expect(screen.getByRole("combobox", { name: /PDF with the backs/ })).toBeTruthy();
    expect(screen.getByTestId("pairing-summary").textContent).toBe(
      "2 fronts paired with their backs. 1 piece left without a pair.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(layout().cardEdits.backs).toEqual({
      [key(piece(0, 0, 0))]: key(other(0, 1)),
      [key(piece(0, 0, 1))]: key(other(0, 0)),
    });
    expect(print().quantities).not.toHaveProperty(key(other(0, 0)));
    undo();
    expect(layout().cardEdits.backs).toEqual({});
  });

  it("uses a backs PDF of one piece as the common back", () => {
    useDocumentStore.getState().setDocuments([doc(0, "fronts.pdf"), doc(1, "backs.pdf")], 0);
    print().setCards([piece(0, 0, 0), piece(0, 0, 1), piece(1, 0, 0), other(0, 0)], null);
    openDialog();
    fireEvent.click(screen.getByRole("radio", { name: /Backs in another PDF/ }));
    expect(screen.getByTestId("pairing-summary").textContent).toBe("Every front gets that piece as its back.");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(print().finish.duplex.commonBack).toBe(key(other(0, 0)));
    expect(layout().cardEdits.backs).toEqual({});
    expect(print().quantities).not.toHaveProperty(key(other(0, 0)));
  });
});
