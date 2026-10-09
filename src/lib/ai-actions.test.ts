import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiStore } from "../stores/ai-store";
import { useDocumentStore } from "../stores/document-store";
import { useEditorStore } from "../stores/editor-store";
import { undo, useLayoutStore } from "../stores/layout-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { applySort, askDetect, askSort, cancelRun, confirmRun, discardSort } from "./ai-actions";
import { aiDetectPieces, aiEstimate, aiSortPages, type Estimate } from "./ai-api";
import { defaultGroups, isSkipped } from "./document-layout";

vi.mock("./ai-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai-api")>()),
  aiEstimate: vi.fn(),
  aiDetectPieces: vi.fn(),
  aiSortPages: vi.fn(),
  syncAiGate: vi.fn(async () => {}),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const estimate = vi.mocked(aiEstimate);
const detect = vi.mocked(aiDetectPieces);
const sort = vi.mocked(aiSortPages);
const ai = () => useAiStore.getState();

const anEstimate: Estimate = {
  requests: 1,
  images: 1,
  input_tokens: 1900,
  output_tokens: 2048,
  host: "api.anthropic.com",
  sends_images: true,
  cost_usd: 0.04,
};
const usage = { input_tokens: 1800, output_tokens: 90 };
const gridDetection = {
  proposals: [
    {
      kind: "grid" as const,
      bounds: { x: 60, y: 84, width: 476, height: 673 },
      rows: 3,
      columns: 3,
      source_gap_x_mm: 0,
      source_gap_y_mm: 0,
      confidence: 0.7,
      engine: "ai",
      notes: [],
    },
  ],
  reasons: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  usePreferencesStore.getState().resetToDefaults();
  usePreferencesStore.getState().setAiEnabled(true);
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: Array(6).fill(A4), hash: "" }], 0);
  useLayoutStore.getState().resetDocument(6);
  ai().clear();
  ai().setSkipDetectConfirm(false);
  useEditorStore.getState().setDraft(null);
});

describe("detecting with AI", () => {
  it("asks first: it works out what would be sent and sends nothing", async () => {
    estimate.mockResolvedValue(anEstimate);
    useDocumentStore.getState().setCurrentPage(2);
    await askDetect();
    expect(estimate).toHaveBeenCalledWith("detect", 0, [2]);
    expect(ai().confirm).toMatchObject({ task: "detect", documentId: 0, pages: [2], provider: "anthropic" });
    expect(ai().confirm?.estimate.host).toBe("api.anthropic.com");
    expect(detect).not.toHaveBeenCalled();
  });

  it("sends only after the yes, and shows the answer as the usual draft with what it used", async () => {
    estimate.mockResolvedValue(anEstimate);
    detect.mockResolvedValue({ detection: gridDetection, usage });
    await askDetect();
    await confirmRun();
    expect(detect).toHaveBeenCalledWith(0, 0);
    expect(ai().confirm).toBeNull();
    expect(useEditorStore.getState().draft).toMatchObject({ documentId: 0, page: 0, index: 0 });
    expect(useEditorStore.getState().draft?.detection.proposals[0].engine).toBe("ai");
    expect(ai().usage).toEqual({ task: "detect", tokens: usage });
    expect(ai().running).toBe(false);
    // The project is as it was.
    expect(useLayoutStore.getState().groups).toEqual(defaultGroups(6));
  });

  it("a no sends nothing", async () => {
    estimate.mockResolvedValue(anEstimate);
    await askDetect();
    cancelRun();
    expect(ai().confirm).toBeNull();
    expect(detect).not.toHaveBeenCalled();
    expect(useEditorStore.getState().draft).toBeNull();
  });

  it("can skip the question for the session, and then goes straight to the provider", async () => {
    detect.mockResolvedValue({ detection: gridDetection, usage });
    ai().setSkipDetectConfirm(true);
    await askDetect();
    expect(estimate).not.toHaveBeenCalled();
    expect(detect).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().draft).not.toBeNull();
  });

  it("keeps an error and changes nothing", async () => {
    estimate.mockResolvedValue(anEstimate);
    detect.mockRejectedValue({ code: "ai_http", message: "x", status: 429, detail: "slow down" });
    await askDetect();
    await confirmRun();
    expect(ai().error?.error.code).toBe("ai_http");
    expect(ai().error?.error.values).toMatchObject({ status: 429 });
    expect(useEditorStore.getState().draft).toBeNull();
    expect(ai().running).toBe(false);
    expect(useLayoutStore.getState().groups).toEqual(defaultGroups(6));
  });

  it("shows an error from working out the estimate (no key, a keychain that fails)", async () => {
    estimate.mockRejectedValue({ code: "ai_no_key", message: "no key" });
    await askDetect();
    expect(ai().error?.error.code).toBe("ai_no_key");
    expect(ai().confirm).toBeNull();
    expect(ai().estimating).toBe(false);
  });

  it("drops an answer for a page the user has left", async () => {
    estimate.mockResolvedValue(anEstimate);
    let resolve: (v: { detection: typeof gridDetection; usage: typeof usage }) => void = () => {};
    detect.mockReturnValue(new Promise((r) => (resolve = r)));
    await askDetect();
    const run = confirmRun();
    useDocumentStore.getState().setCurrentPage(3);
    resolve({ detection: gridDetection, usage });
    await run;
    expect(useEditorStore.getState().draft).toBeNull();
    expect(ai().usage).toBeNull();
  });
});

describe("sorting pages with AI", () => {
  const labels = [
    { page_index: 0, label: "cover" as const, confidence: 0.9 },
    { page_index: 1, label: "rules" as const, confidence: 0.9 },
    { page_index: 2, label: "cards" as const, confidence: 0.9 },
    { page_index: 3, label: "backs" as const, confidence: 0.8 },
    { page_index: 4, label: "other" as const, confidence: 0.5 },
    { page_index: 5, label: "cards" as const, confidence: 0.9 },
  ];

  async function sorted() {
    estimate.mockResolvedValue({ ...anEstimate, requests: 1, images: 6 });
    sort.mockResolvedValue({ labels, usage });
    await askSort();
    await confirmRun();
  }

  it("always asks first, for every page", async () => {
    estimate.mockResolvedValue({ ...anEstimate, images: 6 });
    await askSort();
    expect(estimate).toHaveBeenCalledWith("sort", 0, [0, 1, 2, 3, 4, 5]);
    expect(ai().confirm?.task).toBe("sort");
    expect(sort).not.toHaveBeenCalled();
  });

  it("labels the pages and starts rules, cover and other as skipped, cards and backs kept", async () => {
    await sorted();
    expect(sort).toHaveBeenCalledWith(0, [0, 1, 2, 3, 4, 5]);
    expect(ai().sort?.rows.map((r) => [r.page, r.label, r.skip])).toEqual([
      [0, "cover", true],
      [1, "rules", true],
      [2, "cards", false],
      [3, "backs", false],
      [4, "other", true],
      [5, "cards", false],
    ]);
    expect(ai().usage).toEqual({ task: "sort", tokens: usage });
    // Nothing is skipped yet: it is a proposal.
    expect(isSkipped(useLayoutStore.getState().groups, 0)).toBe(false);
  });

  it("applies exactly the rows as they stand now, in one undo step, touching only skip states", async () => {
    await sorted();
    ai().updateRow(3, { skip: true }); // the user also skips the backs
    ai().updateRow(4, { skip: false }); // and keeps page 5
    useLayoutStore.getState().setSelection(2, { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    const regionBefore = useLayoutStore.getState().groups.find((g) => g.kind === "grid" && g.selection !== null);
    applySort();
    const groups = useLayoutStore.getState().groups;
    expect([0, 1, 2, 3, 4, 5].map((p) => isSkipped(groups, p))).toEqual([true, true, false, true, false, false]);
    expect(ai().sort).toBeNull();
    // The region drawn on page 3 is still there.
    expect(groups.some((g) => g.kind === "grid" && g.selection !== null)).toBe(true);
    expect(regionBefore).toBeDefined();

    undo();
    const back = useLayoutStore.getState().groups;
    expect([0, 1, 2, 3, 4, 5].map((p) => isSkipped(back, p))).toEqual([false, false, false, false, false, false]);
    expect(back.some((g) => g.kind === "grid" && g.selection !== null)).toBe(true);
  });

  it("changes nothing when it is dropped", async () => {
    await sorted();
    const before = useLayoutStore.getState().groups;
    discardSort();
    expect(ai().sort).toBeNull();
    expect(useLayoutStore.getState().groups).toBe(before);
  });

  it("an error leaves the project and any older proposal untouched", async () => {
    estimate.mockResolvedValue({ ...anEstimate, images: 6 });
    sort.mockRejectedValue({ code: "ai_invalid_proposal", message: "x", detail: "page 4 has no label" });
    await askSort();
    await confirmRun();
    expect(ai().error?.error.code).toBe("ai_invalid_proposal");
    expect(ai().sort).toBeNull();
    expect(useLayoutStore.getState().groups).toEqual(defaultGroups(6));
  });
});

describe("leaving things behind", () => {
  it("switching to another PDF drops what was waiting", async () => {
    estimate.mockResolvedValue(anEstimate);
    await askDetect();
    ai().setSort({ documentId: 0, rows: [] });
    useDocumentStore.getState().setDocuments(
      [
        { id: 0, path: "/x.pdf", pages: Array(6).fill(A4), hash: "" },
        { id: 1, path: "/y.pdf", pages: [A4], hash: "" },
      ],
      0,
    );
    useDocumentStore.getState().setActive(1);
    expect(ai().confirm).toBeNull();
    expect(ai().sort).toBeNull();
  });

  it("turning AI Mode off drops everything of it", async () => {
    estimate.mockResolvedValue(anEstimate);
    await askDetect();
    ai().setUsage("detect", usage);
    usePreferencesStore.getState().setAiEnabled(false);
    expect(ai().confirm).toBeNull();
    expect(ai().usage).toBeNull();
  });
});
