// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageGroups } from "../../lib/images";
import { exportDocument, pickExportPath } from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { EditorToolbar } from "./EditorToolbar";

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  validateExport: vi.fn(async () => []),
  pickExportPath: vi.fn(async () => "/out/art.pdf"),
  exportDocument: vi.fn(async () => 2),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const placement = { widthMm: 63, heightMm: 88, bleedMm: 0, fit: "fit" as const, reduceLarge: false };
const plan = (dpi: number, quality: "good" | "soft" | "blurry") => ({
  pageWidthMm: 63,
  pageHeightMm: 88,
  piece: { x: 0, y: 0, width: 1, height: 1 },
  proportionsDiffer: false,
  dpi,
  quality,
  veryLarge: false,
  reducedToDpi: null,
  storedBytes: 1,
});

function openImages(plans: ReturnType<typeof plan>[]) {
  const pages = plans.map((p, i) => ({
    path: `/art/card${i}.png`,
    hash: "0".repeat(64),
    placement,
    plan: p,
    missing: false,
  }));
  useDocumentStore
    .getState()
    .setDocuments(
      [{ id: 0, path: "/cache/art.pdf", pages: plans.map(() => A4), hash: "", images: { name: "art", pages } }],
      0,
    );
  useLayoutStore.getState().resetDocument(plans.length);
  useLayoutStore.getState().loadProject({
    active: { groups: imageGroups(plans.length, { x: 0, y: 0, width: 1, height: 1 }), freeform: {} },
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

describe("export warnings for images", () => {
  it("lists images that print soft or blurry, and exports anyway", async () => {
    openImages([plan(400, "good"), plan(120, "blurry")]);
    render(<EditorToolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    const panel = await screen.findByRole("region", { name: "Print quality warnings" });
    expect(panel.textContent).toContain("1 image may not print sharp");
    expect(panel.textContent).toContain("Page 2");
    expect(panel.textContent).toContain("card1.png will look blurry at this size (120 dpi)");
    expect(panel.textContent).toContain("These do not stop the export");
    await waitFor(() => expect(exportDocument).toHaveBeenCalledTimes(1));
    expect(pickExportPath).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when every image prints well", async () => {
    openImages([plan(400, "good"), plan(350, "good")]);
    render(<EditorToolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    await waitFor(() => expect(exportDocument).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("region", { name: "Print quality warnings" })).toBeNull();
  });
});
