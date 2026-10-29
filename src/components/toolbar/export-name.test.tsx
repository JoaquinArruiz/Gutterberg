// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type OpenDocument, useDocumentStore } from "../../stores/document-store";
import { usePrintStore } from "../../stores/print-store";
import { useProjectStore } from "../../stores/project-store";
import { useUiStore } from "../../stores/ui-store";
import { DocumentName } from "./DocumentName";

const A4 = { width_pt: 595, height_pt: 842 };
const doc = (id: number, name: string): OpenDocument => ({
  id,
  path: `/games/${name}.pdf`,
  pages: [A4],
  hash: String(id),
});

afterEach(cleanup);

describe("the export name in the Print tab", () => {
  beforeEach(() => {
    useDocumentStore.getState().clear();
    useDocumentStore.getState().setDocuments([doc(0, "dungeon")], 0);
    useProjectStore.setState({ path: null });
    usePrintStore.getState().setExportName(null);
    useUiStore.setState({ stage: "print" });
  });

  it("shows the name the save dialog will offer: the PDF's, with -print", () => {
    render(<DocumentName />);
    expect(screen.getByText("dungeon-print.pdf")).toBeTruthy();
  });

  it("follows the saved project's name", () => {
    useProjectStore.setState({ path: "/games/my-game.gtr" });
    render(<DocumentName />);
    expect(screen.getByText("my-game-print.pdf")).toBeTruthy();
  });

  it("opens with the suggestion to edit, and keeping it chooses nothing", () => {
    render(<DocumentName />);
    fireEvent.click(screen.getByText("dungeon-print.pdf"));
    const field = screen.getByRole("textbox") as HTMLInputElement;
    expect(field.value).toBe("dungeon-print");
    expect([field.selectionStart, field.selectionEnd]).toEqual([13, 13]);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(usePrintStore.getState().exportName).toBeNull();
  });

  it("keeps a name typed after the suggestion", () => {
    render(<DocumentName />);
    fireEvent.click(screen.getByText("dungeon-print.pdf"));
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "dungeon-print-a4" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(usePrintStore.getState().exportName).toBe("dungeon-print-a4");
    expect(screen.getByText("dungeon-print-a4.pdf")).toBeTruthy();
  });
});
