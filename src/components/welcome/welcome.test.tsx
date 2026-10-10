// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale } from "../../i18n";
import { DEFAULT_PREFERENCES } from "../../lib/preferences";
import { forgetLoadedClips, WELCOME_STEPS, WELCOME_VERSION } from "../../lib/welcome";
import { useDocumentStore } from "../../stores/document-store";
import { useHint } from "../../stores/hint-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore, WELCOME_HINT_DELAY_MS } from "../../stores/ui-store";
import { HintToast } from "../ui/HintToast";
import { useWelcomeAutoOpen, WelcomeDialog } from "./WelcomeDialog";

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const play = vi.fn(() => Promise.resolve());
let reducedMotion = false;
/** The clip files the pretend app serves: a URL that is not here is a failed load. */
let served: Set<string>;
// A string body: jsdom's Blob is not one that Node's Response can read.
const fetchClip = vi.fn(async (url: string) =>
  served.has(url) ? new Response(url) : new Response(null, { status: 404 }),
);
let blobs = 0;
/** Lets the clip loads (promises) finish. */
const loads = () => act(async () => {});

function Host() {
  useWelcomeAutoOpen();
  return <WelcomeDialog />;
}

const dialog = () => document.querySelector("dialog") as HTMLDialogElement;
const ui = () => useUiStore.getState();
const seen = () => usePreferencesStore.getState().prefs.help.welcomeSeen;
const step = () => screen.getByTestId("welcome").dataset.step;
const next = () => screen.getByRole("button", { name: /^(Next|Get started)/ });

beforeEach(() => {
  vi.useFakeTimers();
  play.mockClear();
  fetchClip.mockClear();
  reducedMotion = false;
  served = new Set(WELCOME_STEPS.flatMap((s) => [`/welcome/${s.clip}.webm`, `/welcome/${s.clip}.mp4`]));
  blobs = 0;
  forgetLoadedClips();
  vi.stubGlobal("fetch", fetchClip);
  URL.createObjectURL = () => `blob:clip-${++blobs}`;
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
  HTMLMediaElement.prototype.play = play;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reducedMotion && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  usePreferencesStore.setState({ prefs: DEFAULT_PREFERENCES });
  useDocumentStore.getState().clear();
  useUiStore.setState({ welcomeOpen: false, welcomeDeferred: false, hintsHeld: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  applyLocale({ language: "en", decimal: "auto" });
});

describe("opening", () => {
  it("opens by itself on a first start, over the start screen", () => {
    render(<Host />);
    expect(dialog().open).toBe(true);
    expect(screen.getByRole("heading", { name: "Your PDF, cut into pieces" })).toBeTruthy();
    expect(ui().welcomeOpen).toBe(true);
  });

  it("does not open again once it was closed", () => {
    usePreferencesStore.getState().setWelcomeSeen(WELCOME_VERSION);
    render(<Host />);
    expect(dialog().open).toBe(false);
    expect(ui().welcomeOpen).toBe(false);
  });

  it("only opens over the start screen, not over an open project", () => {
    useDocumentStore.getState().setDocuments([{ id: 0, path: "/a.pdf", pages: [A4], hash: "" }], 0);
    render(<Host />);
    expect(dialog().open).toBe(false);
  });

  it("waits for the next start screen when the app started with a file", () => {
    ui().deferWelcome();
    render(<Host />);
    expect(dialog().open).toBe(false);
    // The file opens: nothing to show, and the deferral is spent.
    act(() => useDocumentStore.getState().setDocuments([{ id: 0, path: "/a.gtr", pages: [A4], hash: "" }], 0));
    expect(ui().welcomeDeferred).toBe(false);
    expect(dialog().open).toBe(false);
    // Closing the project brings the start screen back, and the welcome with it.
    act(() => useDocumentStore.getState().clear());
    expect(dialog().open).toBe(true);
  });

  it("can be opened again whenever the user asks", () => {
    usePreferencesStore.getState().setWelcomeSeen(WELCOME_VERSION);
    render(<Host />);
    act(() => ui().setWelcomeOpen(true));
    expect(dialog().open).toBe(true);
    expect(step()).toBe("cut");
  });
});

describe("the steps", () => {
  it("go forward and back, with Get started on the last one", () => {
    render(<Host />);
    expect(screen.getByRole("button", { name: /Back/ }).hasAttribute("disabled")).toBe(true);
    const seenSteps = [step()];
    for (let i = 1; i < WELCOME_STEPS.length; i++) {
      fireEvent.click(next());
      seenSteps.push(step());
    }
    expect(seenSteps).toEqual(WELCOME_STEPS.map((s) => s.id));
    expect(next().textContent).toContain("Get started");
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(step()).toBe("arrange");
    expect(next().textContent).toContain("Next");
  });

  it("have a dot for each, labelled for a screen reader, and the dots go to their step", () => {
    render(<Host />);
    const dots = screen.getAllByRole("button", { name: /^Step \d of 4: / });
    expect(dots).toHaveLength(4);
    expect(dots[0].getAttribute("aria-label")).toBe("Step 1 of 4: Your PDF, cut into pieces");
    expect(dots[0].getAttribute("aria-current")).toBe("step");
    fireEvent.click(dots[2]);
    expect(step()).toBe("arrange");
    expect(dots[2].getAttribute("aria-current")).toBe("step");
    expect(dots[0].getAttribute("aria-current")).toBeNull();
  });

  it("start on Next, so Enter goes on", () => {
    render(<Host />);
    expect(document.activeElement).toBe(next());
  });

  it("show the clip from memory, with its last frame as the poster", async () => {
    render(<Host />);
    const video = screen.getByTestId("welcome-clip") as HTMLVideoElement;
    expect(video.getAttribute("poster")).toBe("/welcome/01-cut.png");
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("loop")).toBe(false);
    expect(video.hasAttribute("src")).toBe(false); // nothing until the clip is loaded
    await loads();
    // jsdom's video says it cannot play VP9, so the .mp4 is the one loaded.
    expect(fetchClip).toHaveBeenCalledWith("/welcome/01-cut.mp4");
    expect(screen.getByTestId("welcome-clip").getAttribute("src")).toBe("blob:clip-1");
    fireEvent.click(next());
    expect(screen.getByTestId("welcome-clip").getAttribute("poster")).toBe("/welcome/02-place.png");
    expect(screen.getByTestId("welcome-clip").hasAttribute("src")).toBe(false); // never the previous step's clip
    await loads();
    expect(screen.getByTestId("welcome-clip").getAttribute("src")).toBe("blob:clip-2");
  });

  it("load each clip once, so going back is instant", async () => {
    render(<Host />);
    await loads();
    fireEvent.click(next());
    await loads();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    await loads();
    expect(screen.getByTestId("welcome-clip").getAttribute("src")).toBe("blob:clip-1");
    expect(fetchClip).toHaveBeenCalledTimes(2);
  });

  it("fall back to the file's own address when a clip cannot be loaded", async () => {
    served.delete("/welcome/01-cut.mp4");
    render(<Host />);
    await loads();
    expect(screen.getByTestId("welcome-clip").getAttribute("src")).toBe("/welcome/01-cut.mp4");
  });

  it("show the poster, not a black box, when the webview cannot play a clip", async () => {
    render(<Host />);
    await loads();
    fireEvent.error(screen.getByTestId("welcome-clip"));
    expect(screen.queryByTestId("welcome-clip")).toBeNull();
    expect(screen.getByTestId("welcome-poster").getAttribute("src")).toBe("/welcome/01-cut.png");
    expect(screen.queryByRole("button", { name: "Play again" })).toBeNull();
    // The next step tries its own clip again.
    fireEvent.click(next());
    await loads();
    expect(screen.getByTestId("welcome-clip").getAttribute("src")).toBe("blob:clip-2");
  });

  it("is in Spanish when the language is", () => {
    applyLocale({ language: "es", decimal: "auto" });
    render(<Host />);
    expect(screen.getByRole("heading", { name: "Tu PDF, cortado en piezas" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Omitir/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(screen.getByRole("heading", { name: "En la hoja que imprimes" })).toBeTruthy();
  });
});

describe("the clips", () => {
  it("play once when their step opens, and again on request", async () => {
    render(<Host />);
    await loads();
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.click(next());
    await loads();
    expect(play).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(play).toHaveBeenCalledTimes(3);
  });

  it("do not move on by themselves", () => {
    render(<Host />);
    const video = screen.getByTestId("welcome-clip");
    fireEvent.ended(video);
    act(() => vi.advanceTimersByTime(10_000));
    expect(step()).toBe("cut");
  });

  it("wait for a Play button with reduced motion, showing the poster", async () => {
    reducedMotion = true;
    render(<Host />);
    await loads();
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByTestId("welcome-clip").getAttribute("poster")).toBe("/welcome/01-cut.png");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.click(next());
    await loads();
    expect(play).toHaveBeenCalledTimes(1); // the next step waits for its own Play too
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });
});

describe("closing", () => {
  it("is marked as seen by Skip", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(seen()).toBe(WELCOME_VERSION);
    expect(dialog().open).toBe(false);
    expect(ui().welcomeOpen).toBe(false);
  });

  it("is marked as seen by Esc", () => {
    render(<Host />);
    const cancel = new Event("cancel", { cancelable: true });
    act(() => {
      dialog().dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true); // the dialog closes through the app, not on its own
    expect(seen()).toBe(WELCOME_VERSION);
    expect(dialog().open).toBe(false);
  });

  it("is marked as seen by Get started, from any step", () => {
    render(<Host />);
    for (let i = 1; i < WELCOME_STEPS.length; i++) fireEvent.click(next());
    fireEvent.click(next());
    expect(seen()).toBe(WELCOME_VERSION);
    expect(dialog().open).toBe(false);
  });

  it("does not open again after it closed, even with the start screen showing", () => {
    const { rerender } = render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    rerender(<Host />);
    expect(dialog().open).toBe(false);
  });

  it("starts from the first step when it is replayed", () => {
    render(<Host />);
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    act(() => ui().setWelcomeOpen(true));
    expect(step()).toBe("cut");
  });
});

describe("help tips while it is open", () => {
  function Tip() {
    // Any tip: it shows when it is the one to show.
    return <HintToast hint="live-preview-output" />;
  }

  it("wait while it is open, and for a moment after it closes", () => {
    usePreferencesStore.getState().setWelcomeSeen(WELCOME_VERSION);
    render(
      <>
        <Host />
        <Tip />
      </>,
    );
    expect(screen.getByTestId("hint-live-preview-output")).toBeTruthy();
    act(() => ui().setWelcomeOpen(true));
    expect(screen.queryByTestId("hint-live-preview-output")).toBeNull();
    act(() => ui().setWelcomeOpen(false));
    // Closed, but the first tip does not fire the moment it does.
    expect(screen.queryByTestId("hint-live-preview-output")).toBeNull();
    act(() => vi.advanceTimersByTime(WELCOME_HINT_DELAY_MS - 1));
    expect(screen.queryByTestId("hint-live-preview-output")).toBeNull();
    act(() => vi.advanceTimersByTime(2));
    expect(screen.getByTestId("hint-live-preview-output")).toBeTruthy();
  });

  it("are not held at all when the welcome never opened", () => {
    usePreferencesStore.getState().setWelcomeSeen(WELCOME_VERSION);
    function Probe() {
      return <span data-testid="probe">{String(useHint("live-preview-output").visible)}</span>;
    }
    render(<Probe />);
    // Not registered by a component here, so nothing is "visible", but the hold is off.
    expect(ui().hintsHeld).toBe(false);
  });
});
