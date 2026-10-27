// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRemoved, isSkipped, removedPages } from "../../lib/document-layout";
import { stepPage } from "../../lib/removed-pages";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { ContextMenuHost } from "../ui/ContextMenu";
import { PagesPanel } from "./PagesPanel";

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  renderPage: vi.fn(async () => "blob:page"),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const groups = () => useLayoutStore.getState().groups;
const shown = () =>
  [...document.querySelectorAll("[data-testid=pages-list] > div > button > span")].map((s) => Number(s.textContent));
const panel = () => (
  <>
    <PagesPanel orientation="vertical" />
    <ContextMenuHost />
  </>
);

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: [A4, A4, A4, A4, A4], hash: "" }], 0);
  useLayoutStore.getState().resetDocument(5);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("removed pages", () => {
  it("removes a page from the panel with a right-click, and skips it", () => {
    render(panel());
    useDocumentStore.getState().setCurrentPage(1);
    fireEvent.contextMenu(screen.getByRole("button", { name: "2" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove page" }));
    expect(isRemoved(groups(), 1)).toBe(true);
    expect(isSkipped(groups(), 1)).toBe(true);
    expect(shown()).toEqual([1, 3, 4, 5]);
    // The viewed page moves to the next one in view.
    expect(useDocumentStore.getState().currentPage).toBe(2);
  });

  it("keeps only one page in view, and the arrow keys' steps skip the removed ones", () => {
    render(panel());
    fireEvent.contextMenu(screen.getByRole("button", { name: "3" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove the other pages" }));
    expect(removedPages(groups())).toEqual([0, 1, 3, 4]);
    expect(shown()).toEqual([3]);
    expect(useDocumentStore.getState().currentPage).toBe(2);
    stepPage(1);
    expect(useDocumentStore.getState().currentPage).toBe(2);
    // The last page in view cannot be removed: both options are off.
    fireEvent.contextMenu(screen.getByRole("button", { name: "3" }));
    expect(screen.getByRole("menuitem", { name: "Remove page" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: "Remove the other pages" }).hasAttribute("disabled")).toBe(true);
  });

  it("lists them folded at the bottom, and brings them back, included", () => {
    useLayoutStore.getState().setSkipped(0, true);
    useLayoutStore.getState().removePages([1, 3]);
    render(panel());
    const title = screen.getByRole("button", { name: "Removed pages (2)" });
    expect(title.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(title);
    fireEvent.click(screen.getByRole("button", { name: /^Page 4/ }));
    expect(removedPages(groups())).toEqual([1]);
    expect(isSkipped(groups(), 3)).toBe(false);
    // A skipped page next to a removed one stays skipped and in view.
    expect(isSkipped(groups(), 0)).toBe(true);
    expect(isRemoved(groups(), 0)).toBe(false);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Removed pages (1)" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Bring all back" }));
    expect(removedPages(groups())).toEqual([]);
    expect(screen.queryByTestId("removed-pages")).toBeNull();
    expect(shown()).toEqual([1, 2, 3, 4, 5]);
  });

  it("is one undo step, and an undo that removes the viewed page moves off it", () => {
    useLayoutStore.getState().removePages([0, 1]);
    useLayoutStore.temporal.getState().clear();
    useLayoutStore.getState().restorePages([0, 1]);
    useDocumentStore.getState().setCurrentPage(0);
    useLayoutStore.temporal.getState().undo();
    expect(removedPages(groups())).toEqual([0, 1]);
    expect(useDocumentStore.getState().currentPage).toBe(2);
  });

  it("removes the page whose thumbnail has the focus with Delete or Backspace, never the last one", () => {
    render(panel());
    const thumb = (n: number) => document.querySelector<HTMLElement>(`[data-page-thumb="${n - 1}"]`) as HTMLElement;
    fireEvent.click(thumb(2));
    expect(document.activeElement).toBe(thumb(2));
    fireEvent.keyDown(thumb(2), { key: "Delete" });
    expect(removedPages(groups())).toEqual([1]);
    expect(shown()).toEqual([1, 3, 4, 5]);
    fireEvent.keyDown(thumb(3), { key: "Backspace" });
    expect(removedPages(groups())).toEqual([1, 2]);
    act(() => useLayoutStore.getState().removePages([0, 3]));
    fireEvent.keyDown(thumb(5), { key: "Delete" });
    expect(shown()).toEqual([5]);
  });

  it("leaves other keys and other places alone", () => {
    render(panel());
    const thumb = document.querySelector<HTMLElement>('[data-page-thumb="0"]') as HTMLElement;
    fireEvent.keyDown(thumb, { key: "a" });
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(removedPages(groups())).toEqual([]);
  });
});
