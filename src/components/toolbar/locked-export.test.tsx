// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appError } from "../../lib/errors";
import { imageGroups } from "../../lib/images";
import { exportDocument, pickExportPath, validateExport } from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { EditorToolbar } from "./EditorToolbar";

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  validateExport: vi.fn(async () => []),
  pickExportPath: vi.fn(async () => "/out/art.pdf"),
  exportDocument: vi.fn(async () => 1),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const MESSAGE = "This PDF's publisher doesn't allow changes. Contact them for an unlocked print-and-play version.";

function open() {
  useDocumentStore
    .getState()
    .setDocuments(
      [{ id: 3, path: "/games/locked.pdf", pages: [A4], hash: "", access: { locked: "printing", restricted: false } }],
      3,
    );
  useLayoutStore.getState().loadProject({
    active: { groups: imageGroups(1, { x: 0, y: 0, width: 1, height: 1 }), freeform: {} },
    parked: {},
    output: useLayoutStore.getState(),
    edits: useLayoutStore.getState().cardEdits,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  usePreferencesStore.getState().resetToDefaults();
  useUiStore.getState().setStage("cards");
});
afterEach(cleanup);

describe("exporting a PDF its publisher locked", () => {
  it("lists the refusal with the other pre-flight problems, before the save dialog", async () => {
    open();
    vi.mocked(validateExport).mockRejectedValueOnce(
      appError("pdf_locked", MESSAGE, { document_id: 3, reason: "printing" }),
    );
    render(<EditorToolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    const panel = await screen.findByRole("region", { name: "Export problems" });
    expect(panel.textContent).toContain("This PDF can't be exported");
    expect(panel.textContent).toContain(MESSAGE);
    expect(panel.textContent).toContain("ask its publisher for an unlocked version");
    expect(pickExportPath).not.toHaveBeenCalled();
    expect(exportDocument).not.toHaveBeenCalled();
    // The badge on the toolbar says the same early.
    expect(screen.getByTestId("lock-badge").textContent).toBe("Locked");
  });

  it("lists it too when the refusal only comes with the export itself", async () => {
    open();
    vi.mocked(exportDocument).mockRejectedValueOnce(
      appError("pdf_locked", MESSAGE, { document_id: 3, reason: "modifying" }),
    );
    render(<EditorToolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    const panel = await screen.findByRole("region", { name: "Export problems" });
    await waitFor(() => expect(panel.textContent).toContain(MESSAGE));
  });
});
