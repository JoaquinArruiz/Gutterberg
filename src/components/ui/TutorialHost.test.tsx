// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { emitHintEvent } from "../../lib/hint-events";
import { TUTORIALS } from "../../lib/tutorials";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { useUiStore, WELCOME_HINT_DELAY_MS } from "../../stores/ui-store";
import { HintToast } from "./HintToast";
import { TutorialHost } from "./TutorialHost";

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const openDocument = () =>
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/demo.pdf", pages: [A4], hash: "" }], 0);
// A piece drawn on the page: the Source tab has pieces even before the Print tab worked out the library.
const addPieces = () =>
  useLayoutStore.setState({
    freeform: { 0: [{ center: { x: 0.5, y: 0.5 }, width: 0.2, height: 0.2, angle_deg: 0 }] },
  });
const start = (id: keyof typeof TUTORIALS) => act(() => useUiStore.getState().startTutorial(id));

beforeEach(() => {
  usePreferencesStore.getState().resetToDefaults();
  useDocumentStore.getState().setDocuments([], 0);
  usePrintStore.setState({ cards: [] });
  useLayoutStore.setState({ groups: [], freeform: {}, parked: {} });
  useUiStore.setState({ tutorial: null, hintsHeld: false, stage: "cards", prefsOpen: false, tutorialsOpen: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const card = (id: string) => screen.queryByTestId(`tutorial-${id}`);

describe("TutorialHost", () => {
  it("shows nothing until a tutorial is started", () => {
    render(<TutorialHost />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("runs a tutorial that needs nothing, and pages through it to Done", () => {
    render(<TutorialHost />);
    start("update");
    const total = TUTORIALS.update.steps.length;
    expect(card("update")?.textContent).toContain(t(TUTORIALS.update.steps[0].text));
    expect(screen.getByText(`1 / ${total}`)).toBeTruthy();
    for (let i = 1; i < total; i++) fireEvent.click(screen.getByRole("button", { name: "Next tip" }));
    expect(screen.getByText(`${total} / ${total}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(card("update")).toBeNull();
    expect(useUiStore.getState().tutorial).toBeNull();
  });

  it("works with help tips turned off and for tips that were closed, and saves nothing", () => {
    usePreferencesStore.getState().setTipsOn(false);
    usePreferencesStore.getState().dismissHint("first-pdf-tour");
    const before = JSON.stringify(usePreferencesStore.getState().prefs);
    render(<TutorialHost />);
    start("update");
    expect(card("update")).toBeTruthy();
    // It has no "Don't show tips" choice: it is not a tip.
    expect(screen.queryByRole("button", { name: "Don't show tips" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "End tutorial" }));
    expect(JSON.stringify(usePreferencesStore.getState().prefs)).toBe(before);
  });

  it("ends with the × and with Escape", () => {
    render(<TutorialHost />);
    start("update");
    fireEvent.click(screen.getByRole("button", { name: "End tutorial" }));
    expect(card("update")).toBeNull();
    start("update");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(card("update")).toBeNull();
    start("update");
    fireEvent.keyDown(card("update") as HTMLElement, { key: "Escape" });
    expect(card("update")).toBeNull();
  });

  it("goes on when the app event of the step fires, however the user caused it", () => {
    render(<TutorialHost />);
    start("update");
    expect(useUiStore.getState().tutorial?.step).toBe(0);
    act(() => emitHintEvent("prefs-opened:updates"));
    expect(useUiStore.getState().tutorial?.step).toBe(1);
    // An event of another step does nothing.
    act(() => emitHintEvent("log-copied"));
    expect(useUiStore.getState().tutorial?.step).toBe(1);
  });

  it("holds the help tips while it runs and for a moment after, even if the tour is opened over it", () => {
    vi.useFakeTimers();
    render(
      <>
        <HintToast hint="live-preview-output" />
        <TutorialHost />
      </>,
    );
    expect(screen.getByTestId("hint-live-preview-output")).toBeTruthy();
    start("update");
    expect(screen.queryByTestId("hint-live-preview-output")).toBeNull();
    act(() => useUiStore.getState().setWelcomeOpen(true));
    act(() => useUiStore.getState().setWelcomeOpen(false));
    act(() => void vi.advanceTimersByTime(WELCOME_HINT_DELAY_MS + 10));
    expect(screen.queryByTestId("hint-live-preview-output")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "End tutorial" }));
    expect(screen.queryByTestId("hint-live-preview-output")).toBeNull();
    act(() => void vi.advanceTimersByTime(WELCOME_HINT_DELAY_MS + 10));
    expect(screen.getByTestId("hint-live-preview-output")).toBeTruthy();
  });

  it("says a PDF is needed when none is open, with the way to open one, and loads nothing itself", () => {
    render(<TutorialHost />);
    start("paper-size");
    expect(card("paper-size")?.textContent).toContain("Open a PDF first");
    expect(screen.getByRole("button", { name: "Open PDF…" })).toBeTruthy();
    // Only the need is shown, not the tutorial's steps.
    expect(screen.queryByText("1 / 3")).toBeNull();
    expect(useDocumentStore.getState().documents).toHaveLength(0);
  });

  it("says the same for a tutorial about pieces with no PDF, and goes on once a PDF with pieces is open", () => {
    render(<TutorialHost />);
    start("resize-pieces");
    expect(card("resize-pieces")?.textContent).toContain("Open a PDF first");
    act(openDocument);
    expect(card("resize-pieces")?.textContent).toContain("Mark some pieces first");
    act(addPieces);
    // The first step takes the user to the Print tab.
    expect(card("resize-pieces")?.textContent).toContain(t(TUTORIALS["resize-pieces"].steps[0].text));
  });

  it("offers to start the mark-and-export tutorial when a PDF has no pieces", () => {
    render(<TutorialHost />);
    act(openDocument);
    start("find-piece");
    fireEvent.click(screen.getByRole("button", { name: "Start “Mark pieces and export”" }));
    expect(useUiStore.getState().tutorial?.id).toBe("mark-and-export");
    // The tour starts on the Source tab, where the user already is.
    expect(card("mark-and-export")?.textContent).toContain(t(TUTORIALS["mark-and-export"].steps[1].text));
  });

  it("skips the step that takes the user to the Print tab when they are already there", () => {
    act(openDocument);
    act(addPieces);
    useUiStore.setState({ stage: "print" });
    render(<TutorialHost />);
    start("find-piece");
    expect(useUiStore.getState().tutorial?.step).toBe(1);
    expect(card("find-piece")?.textContent).toContain(t(TUTORIALS["find-piece"].steps[1].text));
  });

  it("keeps the step that takes the user to the Print tab when they are not there, and moves on when they get there", () => {
    act(openDocument);
    act(addPieces);
    render(<TutorialHost />);
    start("find-piece");
    expect(useUiStore.getState().tutorial?.step).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Open the Print tab" }));
    expect(useUiStore.getState().stage).toBe("print");
    expect(useUiStore.getState().tutorial?.step).toBe(1);
  });

  it("is back on a skipped first step without bouncing when the user goes back to it", () => {
    act(openDocument);
    act(addPieces);
    useUiStore.setState({ stage: "print" });
    render(<TutorialHost />);
    start("find-piece");
    fireEvent.click(screen.getByRole("button", { name: "Previous tip" }));
    expect(useUiStore.getState().tutorial?.step).toBe(1);
  });

  it("puts the card in the dialog that is open, since it would sit behind it", () => {
    render(<TutorialHost />);
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    start("update");
    expect(dialog.contains(card("update"))).toBe(true);
    // Escape closes the dialog on its own; the tutorial goes on.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(card("update")).toBeTruthy();
    dialog.remove();
  });
});
