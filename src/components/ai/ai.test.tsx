// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiDeleteKey,
  aiDetectPieces,
  aiEstimate,
  aiKeyStatus,
  aiSetKey,
  aiSortPages,
  aiTestConnection,
  type Estimate,
} from "../../lib/ai-api";
import { isSkipped } from "../../lib/document-layout";
import { useAiStore } from "../../stores/ai-store";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { DetectDraftBar } from "../editor/DetectDraft";
import { AiSettings } from "../preferences/AiSettings";
import { PropertiesSidebar } from "../sidebar/PropertiesSidebar";
import { AiConfirmDialog, pageRanges } from "./AiConfirmDialog";

vi.mock("../../lib/ai-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ai-api")>()),
  aiKeyStatus: vi.fn(),
  aiSetKey: vi.fn(),
  aiDeleteKey: vi.fn(),
  aiTestConnection: vi.fn(),
  aiEstimate: vi.fn(),
  aiDetectPieces: vi.fn(),
  aiSortPages: vi.fn(),
  syncAiGate: vi.fn(async () => {}),
}));
vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tauri")>()),
  renderPage: vi.fn(async () => "blob:page"),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const prefs = () => usePreferencesStore.getState();
const ai = () => useAiStore.getState();

const anEstimate: Estimate = {
  requests: 3,
  images: 50,
  input_tokens: 24500,
  output_tokens: 1900,
  host: "api.anthropic.com",
  sends_images: true,
  cost_usd: 0.1,
};

function choose(name: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
  prefs().resetToDefaults();
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/x.pdf", pages: Array(6).fill(A4), hash: "" }], 0);
  useLayoutStore.getState().resetDocument(6);
  useEditorStore.getState().setDraft(null);
  ai().clear();
  ai().setSkipDetectConfirm(false);
  vi.mocked(aiKeyStatus).mockResolvedValue(false);
});
afterEach(cleanup);

describe("turning AI Mode on", () => {
  const warningDialog = () => document.querySelector("dialog[data-testid=ai-experimental]") as HTMLDialogElement;

  it("is called experimental in its section and its switch", () => {
    render(<AiSettings />);
    expect(screen.getByRole("switch", { name: /Use AI Mode \(experimental\)/ })).toBeTruthy();
    expect(screen.getByText("AI Mode (experimental)")).toBeTruthy();
  });

  it("warns first, and nothing is turned on until the user says Okay", () => {
    render(<AiSettings />);
    expect(warningDialog().open).toBe(false);
    fireEvent.click(screen.getByRole("switch", { name: /Use AI Mode/ }));
    expect(warningDialog().open).toBe(true);
    const text = within(warningDialog()).getByText(/needs further testing/).textContent ?? "";
    expect(text).toMatch(/token hungry/);
    expect(text).toMatch(/at your own responsibility/);
    // Still off while the question is open.
    expect(prefs().prefs.ai.enabled).toBe(false);
    expect(screen.getByRole("switch", { name: /Use AI Mode/ }).getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("Provider")).toBeNull();

    fireEvent.click(within(warningDialog()).getByRole("button", { name: "Okay" }));
    expect(warningDialog().open).toBe(false);
    expect(prefs().prefs.ai.enabled).toBe(true);
    expect(screen.getByText("Provider")).toBeTruthy();
  });

  it("stays off on Cancel and when the dialog is closed with Esc", () => {
    render(<AiSettings />);
    fireEvent.click(screen.getByRole("switch", { name: /Use AI Mode/ }));
    fireEvent.click(within(warningDialog()).getByRole("button", { name: "Cancel" }));
    expect(warningDialog().open).toBe(false);
    expect(prefs().prefs.ai.enabled).toBe(false);

    fireEvent.click(screen.getByRole("switch", { name: /Use AI Mode/ }));
    expect(warningDialog().open).toBe(true);
    fireEvent(warningDialog(), new Event("close"));
    expect(prefs().prefs.ai.enabled).toBe(false);
    // And it asks again the next time.
    fireEvent.click(screen.getByRole("switch", { name: /Use AI Mode/ }));
    expect(warningDialog().open).toBe(true);
  });

  it("turns off without asking", () => {
    prefs().setAiEnabled(true);
    render(<AiSettings />);
    fireEvent.click(screen.getByRole("switch", { name: /Use AI Mode/ }));
    expect(prefs().prefs.ai.enabled).toBe(false);
    expect(warningDialog().open).toBe(false);
  });
});

describe("with AI Mode off", () => {
  it("leaves no trace of it in the page editor's sidebar or anywhere it could pop up", () => {
    const { container } = render(
      <>
        <PropertiesSidebar />
        <AiConfirmDialog />
        <DetectDraftBar />
      </>,
    );
    expect(container.querySelectorAll("[data-ai]")).toHaveLength(0);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\bAI\b/);
    expect(text).not.toMatch(/Sort pages/);
    expect(text).not.toMatch(/provider/i);
    expect(container.querySelectorAll("dialog")).toHaveLength(0);
    // The local detection is there, with no AI button next to it.
    expect(screen.getByRole("button", { name: "Detect on this page" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Detect with AI" })).toBeNull();
  });

  it("shows in Preferences only the switch and one sentence", () => {
    render(<AiSettings />);
    expect(screen.getByRole("switch", { name: /Use AI Mode/ })).toBeTruthy();
    expect(screen.queryByText("Provider")).toBeNull();
    expect(screen.queryByText("API key")).toBeNull();
    expect(document.querySelector("[data-ai]")).toBeNull();
    expect(aiKeyStatus).not.toHaveBeenCalled();
  });
});

describe("with AI Mode on", () => {
  beforeEach(() => prefs().setAiEnabled(true));

  it("adds Sort pages and a Detect with AI button next to the local one, each with its spark", () => {
    render(<PropertiesSidebar />);
    const local = screen.getByRole("button", { name: "Detect on this page" });
    const detectAi = screen.getByRole("button", { name: "Detect with AI" });
    expect(local.querySelector("[data-ai=spark]")).toBeNull();
    expect(detectAi.firstElementChild?.getAttribute("data-ai")).toBe("spark");
    expect(detectAi.nextElementSibling).toBeNull();
    expect(local.parentElement).toBe(detectAi.parentElement);
    expect(screen.getByRole("button", { name: "Sort pages with AI" }).querySelector("[data-ai=spark]")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Local" })).toBeNull();
  });

  it("names the provider in the tooltip of every AI button", () => {
    render(<PropertiesSidebar />);
    expect(screen.getByRole("button", { name: "Detect with AI" }).getAttribute("title")).toBe(
      "Sends this page to Anthropic (Claude)",
    );
    expect(screen.getByRole("button", { name: "Sort pages with AI" }).getAttribute("title")).toBe(
      "Sends the pages of this PDF to Anthropic (Claude)",
    );
  });

  it("goes back to nothing when it is switched off again", () => {
    const { container } = render(<PropertiesSidebar />);
    expect(container.querySelectorAll("[data-ai]").length).toBeGreaterThan(0);
    act(() => prefs().setAiEnabled(false));
    expect(container.querySelectorAll("[data-ai]")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/Sort pages/);
  });
});

describe("Preferences › AI Mode", () => {
  beforeEach(() => prefs().setAiEnabled(true));

  it("shows the provider, the model, the key and the privacy choice, and asks the keychain only whether a key is there", async () => {
    vi.mocked(aiKeyStatus).mockResolvedValue(true);
    render(<AiSettings />);
    await act(async () => {});
    expect(aiKeyStatus).toHaveBeenCalledWith("anthropic");
    expect(screen.getByTestId("ai-key-saved").textContent).toContain("saved in the system keychain");
    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("claude-sonnet-5-5");
    expect(screen.queryByLabelText("Address")).toBeNull(); // Anthropic is always at its own address
    expect(screen.getByRole("switch", { name: /Send page images/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("keeps a typed model and address, committed when the field is left", () => {
    render(<AiSettings />);
    choose("Provider", "OpenAI-compatible");
    expect(prefs().prefs.ai.provider).toBe("openai_compatible");
    const model = screen.getByLabelText("Model");
    fireEvent.change(model, { target: { value: "gpt-x" } });
    expect(prefs().prefs.ai.providers.openai_compatible.model).toBe(""); // not yet
    fireEvent.blur(model);
    expect(prefs().prefs.ai.providers.openai_compatible.model).toBe("gpt-x");
    const address = screen.getByLabelText("Address");
    fireEvent.change(address, { target: { value: "http://localhost:1234/v1" } });
    fireEvent.keyDown(address, { key: "Enter" });
    fireEvent.blur(address);
    expect(prefs().prefs.ai.providers.openai_compatible.baseUrl).toBe("http://localhost:1234/v1");
    // Each provider keeps its own.
    expect(prefs().prefs.ai.providers.anthropic.model).toBe("claude-sonnet-5-5");
  });

  it("sends a typed key to the keychain, clears the field, and the key is in no preference", async () => {
    vi.mocked(aiSetKey).mockResolvedValue(undefined);
    render(<AiSettings />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Save key" }).hasAttribute("disabled")).toBe(true);
    const field = screen.getByLabelText("API key") as HTMLInputElement;
    expect(field.type).toBe("password");
    fireEvent.change(field, { target: { value: "  sk-ant-SECRET  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await act(async () => {});
    expect(aiSetKey).toHaveBeenCalledWith("anthropic", "  sk-ant-SECRET  ");
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("ai-key-saved")).toBeTruthy();
    expect(JSON.stringify(prefs().prefs)).not.toContain("SECRET");
    expect(document.body.innerHTML).not.toContain("SECRET");
  });

  it("removes a saved key, and says so when the keychain cannot be used", async () => {
    vi.mocked(aiKeyStatus).mockResolvedValue(true);
    vi.mocked(aiDeleteKey).mockResolvedValue(undefined);
    render(<AiSettings />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    await act(async () => {});
    expect(aiDeleteKey).toHaveBeenCalledWith("anthropic");
    expect(screen.queryByTestId("ai-key-saved")).toBeNull();

    vi.mocked(aiSetKey).mockRejectedValue({
      code: "ai_keychain",
      message: "x",
      detail: "the Secret Service is not running",
    });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "k-123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("the Secret Service is not running");
    expect(screen.queryByTestId("ai-key-saved")).toBeNull();
  });

  it("takes an optional workspace ID for Anthropic keys that are not scoped to one", () => {
    render(<AiSettings />);
    const field = screen.getByLabelText("Workspace ID (optional)");
    expect(screen.getByText(/anthropic-workspace-id header/)).toBeTruthy();
    fireEvent.change(field, { target: { value: " wrkspc_01ABC " } });
    fireEvent.blur(field);
    expect(prefs().prefs.ai.providers.anthropic.workspaceId).toBe("wrkspc_01ABC");
    // Other providers have no such field.
    choose("Provider", "Google Gemini");
    expect(screen.queryByLabelText("Workspace ID (optional)")).toBeNull();
    expect(prefs().prefs.ai.providers.gemini.workspaceId).toBe("");
  });

  it("needs no key for Ollama, and shows an address field for it", async () => {
    render(<AiSettings />);
    choose("Provider", "Ollama (on this computer)");
    await act(async () => {});
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect((screen.getByLabelText("Address") as HTMLInputElement).placeholder).toBe("http://localhost:11434");
    expect(aiKeyStatus).not.toHaveBeenCalledWith("ollama");
  });

  it("tests the connection and reports success or the provider's error", async () => {
    vi.mocked(aiTestConnection).mockResolvedValueOnce({ input_tokens: 21, output_tokens: 5 });
    render(<AiSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await act(async () => {});
    expect(screen.getByRole("status").textContent).toContain("Connected. Used 21 input and 5 output tokens.");
    vi.mocked(aiTestConnection).mockRejectedValueOnce({
      code: "ai_http",
      message: "x",
      status: 401,
      detail: "bad key",
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("The provider answered 401: bad key");
  });

  it("says what text only means", () => {
    render(<AiSettings />);
    expect(screen.getByText(/Pages are sent as pictures/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /Send page images/ }));
    expect(prefs().prefs.ai.sendImages).toBe(false);
    expect(screen.getByText(/no picture is ever sent/)).toBeTruthy();
  });
});

describe("the notice before anything is sent", () => {
  beforeEach(() => prefs().setAiEnabled(true));

  it("names the server, the pages and the cost for a sort, with Send and Cancel", () => {
    render(<AiConfirmDialog />);
    act(() =>
      ai().setConfirm({
        task: "sort",
        documentId: 0,
        pages: Array.from({ length: 50 }, (_, i) => i + 2).filter((i) => i !== 10),
        estimate: anEstimate,
        provider: "anthropic",
      }),
    );
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(screen.getByRole("heading").textContent).toBe("Send to Anthropic (Claude)?");
    expect(screen.getByTestId("ai-host").textContent).toBe("api.anthropic.com");
    expect(screen.getByTestId("ai-what").textContent).toContain(
      "49 pages (3–10, 12–52) will be sent as small pictures",
    );
    expect(screen.getByTestId("ai-what").textContent).toContain("in 3 requests");
    expect(screen.getByTestId("ai-estimate").textContent).toContain(
      "About 24,500 input tokens and up to 1,900 output tokens.",
    );
    expect(screen.getByTestId("ai-estimate").textContent).toContain("About $0.10 at list prices");
    // A sort has no "don't ask again".
    expect(screen.queryByText(/Don't ask again/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(ai().confirm).toBeNull();
    expect(dialog.open).toBe(false);
  });

  it("says text only when no picture goes, and offers to stop asking before detecting on one page", () => {
    render(<AiConfirmDialog />);
    act(() =>
      ai().setConfirm({
        task: "detect",
        documentId: 0,
        pages: [3],
        estimate: {
          ...anEstimate,
          requests: 1,
          images: 0,
          sends_images: false,
          cost_usd: null,
          host: "localhost:11434",
        },
        provider: "ollama",
      }),
    );
    expect(screen.getByTestId("ai-host").textContent).toBe("localhost:11434");
    expect(screen.getByTestId("ai-what").textContent).toContain("Text only: no picture is sent");
    expect(screen.getByTestId("ai-estimate").textContent).toContain("No price is known for this model.");
    fireEvent.click(screen.getByRole("checkbox", { name: /Don't ask again/ }));
    expect(ai().skipDetectConfirm).toBe(true);
  });

  it("sends only on Send", async () => {
    vi.mocked(aiDetectPieces).mockResolvedValue({
      detection: { proposals: [], reasons: [] },
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    render(<AiConfirmDialog />);
    act(() =>
      ai().setConfirm({ task: "detect", documentId: 0, pages: [0], estimate: anEstimate, provider: "anthropic" }),
    );
    expect(aiDetectPieces).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => {});
    expect(aiDetectPieces).toHaveBeenCalledWith(0, 0);
  });

  it("writes page lists the way people count pages", () => {
    expect(pageRanges([0, 1, 2, 4, 6, 7])).toBe("1–3, 5, 7–8");
    expect(pageRanges([5])).toBe("6");
    expect(pageRanges([])).toBe("");
  });
});

describe("the sort proposal", () => {
  const rows = [
    { page: 0, label: "cover" as const, confidence: 0.9, skip: true },
    { page: 1, label: "cards" as const, confidence: 0.9, skip: false },
    { page: 2, label: "rules" as const, confidence: 0.9, skip: true },
  ];

  beforeEach(() => prefs().setAiEnabled(true));

  it("lists every page with its label and skip choice, which the user can change before applying", () => {
    render(<PropertiesSidebar />);
    act(() => ai().setSort({ documentId: 0, rows }));
    expect(screen.getAllByTestId("ai-sort-row")).toHaveLength(3);
    expect(screen.getByTestId("ai-sort-changes").textContent).toBe("2 pages will change.");
    // Keep the cover after all, and call page 2 "Backs": the skip choice is the user's own.
    fireEvent.click(screen.getByRole("checkbox", { name: "Skip page 1" }));
    expect(screen.getByTestId("ai-sort-changes").textContent).toBe("1 page will change.");
    choose("Label of page 2", "Backs");
    expect(ai().sort?.rows[1].label).toBe("backs");
    // Nothing is skipped in the project yet.
    expect(isSkipped(useLayoutStore.getState().groups, 2)).toBe(false);
  });

  it("applies the skip states and nothing else", () => {
    render(<PropertiesSidebar />);
    act(() => ai().setSort({ documentId: 0, rows }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const groups = useLayoutStore.getState().groups;
    expect([0, 1, 2].map((p) => isSkipped(groups, p))).toEqual([true, false, true]);
    expect(ai().sort).toBeNull();
    expect(screen.queryByTestId("ai-sort-rows")).toBeNull();
  });

  it("Cancel changes nothing, and an unchanged list cannot be applied", () => {
    render(<PropertiesSidebar />);
    act(() => ai().setSort({ documentId: 0, rows: rows.map((r) => ({ ...r, skip: false })) }));
    expect(screen.getByTestId("ai-sort-changes").textContent).toBe("No page would change.");
    expect(screen.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(ai().sort).toBeNull();
    expect([0, 1, 2].map((p) => isSkipped(useLayoutStore.getState().groups, p))).toEqual([false, false, false]);
  });

  it("starts from the button: asks first, then shows the proposal", async () => {
    vi.mocked(aiEstimate).mockResolvedValue(anEstimate);
    vi.mocked(aiSortPages).mockResolvedValue({
      labels: [0, 1, 2, 3, 4, 5].map((i) => ({
        page_index: i,
        label: i === 0 ? ("cover" as const) : ("cards" as const),
        confidence: 0.9,
      })),
      usage: { input_tokens: 3000, output_tokens: 200 },
    });
    render(
      <>
        <PropertiesSidebar />
        <AiConfirmDialog />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sort pages with AI" }));
    await act(async () => {});
    expect(aiSortPages).not.toHaveBeenCalled();
    expect(within(document.querySelector("dialog") as HTMLElement).getByTestId("ai-host").textContent).toBe(
      "api.anthropic.com",
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => {});
    expect(screen.getAllByTestId("ai-sort-row")).toHaveLength(6);
    expect(screen.getByText("Used 3000 input and 200 output tokens.")).toBeTruthy();
  });
});

describe("detecting with the AI engine", () => {
  it("gives the usual draft, marked as from AI, with Apply and Discard", async () => {
    prefs().setAiEnabled(true);
    vi.mocked(aiEstimate).mockResolvedValue({ ...anEstimate, requests: 1, images: 1 });
    vi.mocked(aiDetectPieces).mockResolvedValue({
      detection: {
        proposals: [
          {
            kind: "grid",
            bounds: { x: 60, y: 84, width: 476, height: 673 },
            rows: 3,
            columns: 3,
            source_gap_x_mm: 0,
            source_gap_y_mm: 0,
            confidence: 0.8,
            engine: "ai",
            notes: [],
          },
        ],
        reasons: [],
      },
      usage: { input_tokens: 1700, output_tokens: 80 },
    });
    render(
      <>
        <PropertiesSidebar />
        <AiConfirmDialog />
        <DetectDraftBar />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Detect with AI" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(async () => {});
    expect(screen.getByTestId("detect-engine").textContent).toBe("from AI");
    expect(screen.getByTestId("detect-confidence").textContent).toBe("Good"); // never "Exact"
    expect(screen.getByTestId("detect-size").textContent).toBe("3 × 3 = 9 pieces");
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
    expect(screen.getByText("Used 1700 input and 80 output tokens.")).toBeTruthy();
  });

  it("shows the provider's error under the button and leaves the page alone", async () => {
    prefs().setAiEnabled(true);
    vi.mocked(aiEstimate).mockRejectedValue({ code: "ai_no_key", message: "no key" });
    render(<PropertiesSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Detect with AI" }));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("No API key is saved for this provider");
    expect(useEditorStore.getState().draft).toBeNull();
  });
});
