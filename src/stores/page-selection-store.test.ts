import { beforeEach, describe, expect, it } from "vitest";
import { pagesFor, usePageSelectionStore } from "./page-selection-store";

const pick = () => usePageSelectionStore.getState().pages;

describe("page selection", () => {
  beforeEach(() => usePageSelectionStore.getState().clear());

  it("starts a pick with the viewed page and the clicked one", () => {
    usePageSelectionStore.getState().toggle(4, 1);
    expect(pick()).toEqual([1, 4]);
    usePageSelectionStore.getState().toggle(2, 1);
    expect(pick()).toEqual([1, 2, 4]);
    usePageSelectionStore.getState().toggle(1, 1);
    expect(pick()).toEqual([2, 4]);
  });

  it("picks a range of the pages in view only", () => {
    usePageSelectionStore.getState().range(5, 1, [0, 1, 2, 4, 5, 6]);
    expect(pick()).toEqual([1, 2, 4, 5]);
  });

  it("acts on the pick only when the page is in it", () => {
    usePageSelectionStore.getState().range(1, 3, [0, 1, 2, 3, 4]);
    expect(pagesFor(2)).toEqual([1, 2, 3]);
    expect(pagesFor(4)).toEqual([4]);
  });
});
