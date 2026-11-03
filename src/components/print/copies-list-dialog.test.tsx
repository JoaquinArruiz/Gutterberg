// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import type { CardId } from "../../lib/card";
import { cardIdKey } from "../../lib/card";
import { usePrintStore } from "../../stores/print-store";
import { CopiesListDialog } from "./CopiesListDialog";

const piece = (column: number): CardId =>
  ({ kind: "grid", document_id: 0, page_index: 0, group: 0, grid: 0, row: 0, column }) as unknown as CardId;
const pieces = [piece(0), piece(1), piece(2)];

beforeEach(() => {
  usePrintStore.getState().reset();
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

describe("CopiesListDialog", () => {
  it("shows which piece gets which line and applies the copies in order", () => {
    const onClose = vi.fn();
    render(<CopiesListDialog open onClose={onClose} pieces={pieces} />);
    fireEvent.change(screen.getByRole("textbox", { name: "List of copies" }), {
      target: { value: "Name,Count\n3x Ember Drake\nTide Caller, 2" },
    });
    expect(screen.getByRole("table").textContent).toContain("Ember Drake");
    expect(screen.getByRole("status").textContent).toContain("1 line without a number");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const { mode, quantities } = usePrintStore.getState();
    expect(mode).toBe("custom");
    expect(quantities[cardIdKey(pieces[0])]).toBe(3);
    expect(quantities[cardIdKey(pieces[1])]).toBe(2);
    expect(quantities[cardIdKey(pieces[2])]).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });
});
