// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyLocale } from "../../i18n";
import { TUTORIAL_GROUPS, TUTORIAL_IDS, TUTORIALS } from "../../lib/tutorials";
import { useDocumentStore } from "../../stores/document-store";
import { useUiStore } from "../../stores/ui-store";
import { HelpMenu } from "../toolbar/HelpMenu";
import { TutorialsDialog } from "./TutorialsDialog";
import { TutorialsList } from "./TutorialsList";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  useUiStore.setState({
    tutorial: null,
    tutorialsOpen: false,
    prefsOpen: false,
    shortcutsOpen: false,
    welcomeOpen: false,
    hintsHeld: false,
  });
  useDocumentStore.getState().setDocuments([], 0);
});
afterEach(() => {
  cleanup();
  applyLocale({ language: "en", decimal: "auto" });
});

const shown = () => [...document.querySelectorAll("[data-tutorial]")].map((b) => b.getAttribute("data-tutorial"));
const search = (text: string) =>
  fireEvent.change(screen.getByRole("searchbox", { name: /Search tutorials|Buscar tutoriales/ }), {
    target: { value: text },
  });

describe("the Tutorials list", () => {
  it("lists every tutorial under its group, in catalog order, with its summary", () => {
    render(<TutorialsList />);
    expect(shown()).toEqual(TUTORIAL_IDS.slice().sort((a, b) => order(a) - order(b)));
    for (const group of TUTORIAL_GROUPS) {
      const section = screen.queryByRole("region", { name: new RegExp(`^${groupName(group)}$`) });
      const inGroup = TUTORIAL_IDS.filter((id) => TUTORIALS[id].group === group);
      expect(section !== null, group).toBe(inGroup.length > 0);
    }
    expect(screen.getByText("Make pieces bigger or smaller")).toBeTruthy();
    expect(screen.getByText("Copy the log and open the GitHub form with your version filled in.")).toBeTruthy();
  });

  it("filters by the title and the summary, ignoring case", () => {
    render(<TutorialsList />);
    search("GUTTERFOLD");
    expect(shown()).toEqual(["gutterfold"]);
    // The summary counts too: "drift" is only in align-backs's.
    search("drift");
    expect(shown()).toEqual(["align-backs"]);
    // Every word has to match.
    search("update newer");
    expect(shown()).toEqual(["update"]);
    search("update zebra");
    expect(shown()).toEqual([]);
    expect(screen.getByText("No tutorial matches that.")).toBeTruthy();
    search("");
    expect(shown().length).toBe(TUTORIAL_IDS.length);
  });

  it("filters in the language of the app, ignoring accents", () => {
    applyLocale({ language: "es", decimal: "auto" });
    render(<TutorialsList />);
    // "Alinear frentes y dorsos" and "Emparejar" have no accent; "Reportar un problema" is found by "registro".
    search("ALINEAR");
    expect(shown()).toEqual(["align-backs"]);
    search("imagenes");
    expect(shown()).toEqual(["images-as-pieces"]);
    search("Imágenes");
    expect(shown()).toEqual(["images-as-pieces"]);
    search("gutterfold");
    expect(shown()).toEqual(["gutterfold"]);
    search("registro");
    expect(shown()).toEqual(["report-problem"]);
  });

  it("starts the one picked and closes the list and Preferences", () => {
    useUiStore.setState({ tutorialsOpen: true, prefsOpen: true });
    render(<TutorialsList />);
    fireEvent.click(screen.getByRole("button", { name: /Update Gutterberg/ }));
    const ui = useUiStore.getState();
    expect(ui.tutorial).toEqual({ id: "update", step: 0 });
    expect(ui.tutorialsOpen).toBe(false);
    expect(ui.prefsOpen).toBe(false);
    expect(ui.hintsHeld).toBe(true);
  });
});

describe("the Tutorials dialog", () => {
  it("opens from the store with the search ready, and starts the tutorial picked", async () => {
    render(<TutorialsDialog />);
    await act(async () => useUiStore.getState().setTutorialsOpen(true));
    const dialog = screen.getByRole("dialog", { name: "Tutorials", hidden: true });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(within(dialog).getByRole("searchbox", { hidden: true }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Choose the paper size/, hidden: true }));
    expect(useUiStore.getState().tutorial?.id).toBe("paper-size");
    expect(useUiStore.getState().tutorialsOpen).toBe(false);
  });

  it("starts with an empty search every time it opens", async () => {
    render(<TutorialsDialog />);
    await act(async () => useUiStore.getState().setTutorialsOpen(true));
    search("update");
    expect(shown()).toEqual(["update"]);
    await act(async () => useUiStore.getState().setTutorialsOpen(false));
    await act(async () => useUiStore.getState().setTutorialsOpen(true));
    expect(shown().length).toBe(TUTORIAL_IDS.length);
  });
});

describe("the Help menu", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Help" }));

  it("has Tutorials…, Keyboard shortcuts, Welcome tour and Report a problem, with no PDF open", () => {
    render(<HelpMenu />);
    open();
    expect(
      within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Tutorials…", "Keyboard shortcuts?", "Welcome tour", "Report a problem"]);
  });

  it("opens each one", () => {
    render(<HelpMenu />);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Tutorials…" }));
    expect(useUiStore.getState().tutorialsOpen).toBe(true);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: /Keyboard shortcuts/ }));
    expect(useUiStore.getState().shortcutsOpen).toBe(true);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Welcome tour" }));
    expect(useUiStore.getState().welcomeOpen).toBe(true);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Report a problem" }));
    expect(useUiStore.getState().prefsOpen).toBe(true);
    expect(useUiStore.getState().prefsSection).toBe("About");
    expect(useUiStore.getState().prefsPulse).toBe("bugReport");
  });

  it("is in Spanish when the language is", () => {
    applyLocale({ language: "es", decimal: "auto" });
    render(<HelpMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Ayuda" }));
    expect(screen.getByRole("menuitem", { name: "Tutoriales…" })).toBeTruthy();
  });
});

// The catalog order inside a group is the list's; across groups it follows the groups.
const order = (id: (typeof TUTORIAL_IDS)[number]) =>
  TUTORIAL_GROUPS.indexOf(TUTORIALS[id].group) * 100 + TUTORIAL_IDS.indexOf(id);
const groupName = (group: (typeof TUTORIAL_GROUPS)[number]) =>
  ({
    source: "Source tab",
    print: "Print tab",
    duplex: "Duplex \\(Print tab\\)",
    app: "App",
  })[group];
