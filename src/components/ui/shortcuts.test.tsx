// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyLocale } from "../../i18n";
import { isMac, isShortcutsKey, keyCap, SHORTCUT_AREAS, SHORTCUTS } from "../../lib/shortcuts";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import { useUiStore } from "../../stores/ui-store";
import { ShortcutsDialog } from "./ShortcutsDialog";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  useUiStore.setState({ shortcutsOpen: false });
});
afterEach(() => {
  cleanup();
  applyLocale({ language: "en", decimal: "auto" });
});

const press = (init: Partial<KeyboardEventInit> & { key: string }, target?: Element) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  (target ?? document.body).dispatchEvent(e);
  return e;
};

describe("the catalog of shortcuts", () => {
  const ids = SHORTCUT_AREAS.flatMap((a) => SHORTCUTS[a].map((s) => s.id));

  it("lists every shortcut once, each with at least one chord", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHORTCUT_AREAS.flatMap((a) => SHORTCUTS[a])) {
      expect(s.keys.length, s.id).toBeGreaterThan(0);
      for (const chord of s.keys) expect(chord.length, s.id).toBeGreaterThan(0);
    }
  });

  it("has exactly the texts of the catalog in English and in Spanish, and a name for every area", () => {
    for (const messages of [en, es]) {
      expect(Object.keys(messages.shortcuts.items).sort()).toEqual([...ids].sort());
      expect(Object.keys(messages.shortcuts.areas).sort()).toEqual([...SHORTCUT_AREAS].sort());
    }
  });

  it("has the shortcuts the app has", () => {
    const keysOf = (id: string) =>
      SHORTCUT_AREAS.flatMap((a) => SHORTCUTS[a])
        .find((s) => s.id === id)
        ?.keys.map((c) => c.join("+"));
    expect(keysOf("preferences")).toEqual(["Mod+,"]);
    expect(keysOf("openProject")).toEqual(["Mod+Shift+O"]);
    expect(keysOf("redo")).toEqual(["Mod+Shift+Z", "Mod+Y"]);
    expect(keysOf("shortcuts")).toEqual(["?"]);
    expect(keysOf("selectTool")).toEqual(["V"]);
    expect(keysOf("gridRegionTool")).toEqual(["G"]);
    expect(keysOf("pieceTool")).toEqual(["C"]);
    expect(keysOf("panTool")).toEqual(["H"]);
    expect(keysOf("turnLeft")).toEqual(["Shift+R"]);
  });

  it("has the editing controls of the Source tab, and not the old put-down entry", () => {
    const source = SHORTCUTS.source.map((s) => s.id);
    const keysOf = (id: string) => SHORTCUTS.source.find((s) => s.id === id)?.keys.map((c) => c.join("+"));
    expect(keysOf("nudgePicked")).toEqual(["Arrows"]);
    expect(keysOf("nudgePickedBig")).toEqual(["Shift+Arrows"]);
    expect(keysOf("pickMore")).toEqual(["Shift+Click"]); // only Shift: Ctrl/Cmd-click does not pick
    expect(keysOf("pickAll")).toEqual(["Mod+A"]);
    expect(keysOf("pickNone")).toEqual(["Esc"]);
    expect(keysOf("duplicatePieces")).toEqual(["Mod+D"]);
    expect(keysOf("dragCopy")).toEqual(["Alt+Drag"]);
    expect(keysOf("dragFree")).toEqual(["Mod+Drag"]);
    expect(source).not.toContain("putDownPiece");
    expect(en.shortcuts.items.nextPage).toContain("nothing picked");
    expect(es.shortcuts.items.nextPage).toContain("sin nada elegido");
    expect(es.shortcuts.items.nudgePickedBig).toContain("10 mm");
  });

  it("shows Ctrl on other systems and the Command and Option symbols on a Mac", () => {
    expect(keyCap("Mod", false)).toBe("Ctrl");
    expect(keyCap("Mod", true)).toBe("⌘");
    expect(keyCap("Alt", true)).toBe("⌥");
    expect(keyCap("Alt", false)).toBe("Alt");
    expect(keyCap("Shift", true)).toBe("Shift");
    expect(isMac()).toBe(false); // jsdom
  });
});

describe("the ? key", () => {
  it("opens the sheet from anywhere on the page", () => {
    expect(isShortcutsKey(press({ key: "?" }))).toBe(true);
  });

  it("leaves the character alone while typing in a field", () => {
    const input = document.body.appendChild(document.createElement("input"));
    expect(isShortcutsKey(press({ key: "?" }, input))).toBe(false);
    const area = document.body.appendChild(document.createElement("textarea"));
    expect(isShortcutsKey(press({ key: "?" }, area))).toBe(false);
    input.remove();
    area.remove();
  });

  it("is not Ctrl+?, Command+? or Alt+?, and not any other key", () => {
    expect(isShortcutsKey(press({ key: "?", ctrlKey: true }))).toBe(false);
    expect(isShortcutsKey(press({ key: "?", metaKey: true }))).toBe(false);
    expect(isShortcutsKey(press({ key: "?", altKey: true }))).toBe(false);
    expect(isShortcutsKey(press({ key: "/" }))).toBe(false);
  });
});

describe("the shortcuts sheet", () => {
  it("is closed until asked for, and opens as a dialog named Keyboard shortcuts", async () => {
    render(<ShortcutsDialog />);
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    expect(dialog.getAttribute("aria-label")).toBe("Keyboard shortcuts");
    expect(dialog.hasAttribute("open")).toBe(false);
    await act(async () => useUiStore.getState().setShortcutsOpen(true));
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBe(dialog);
  });

  it("lists every shortcut under its area", async () => {
    render(<ShortcutsDialog />);
    await act(async () => useUiStore.getState().setShortcutsOpen(true));
    for (const area of SHORTCUT_AREAS) {
      const section = screen.getByRole("region", { name: en.shortcuts.areas[area] });
      const rows = within(section).getAllByRole("listitem");
      expect(rows.map((r) => r.getAttribute("data-shortcut"))).toEqual(SHORTCUTS[area].map((s) => s.id));
    }
  });

  it("shows the keys as caps, with alternatives apart and the words of the language translated", async () => {
    render(<ShortcutsDialog />);
    await act(async () => useUiStore.getState().setShortcutsOpen(true));
    const redo = document.querySelector('[data-shortcut="redo"]') as HTMLElement;
    expect([...redo.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["Ctrl", "Shift", "Z", "Ctrl", "Y"]);
    expect(redo.textContent).toContain("or");
    const pan = document.querySelector('[data-shortcut="panHeld"]') as HTMLElement;
    expect(pan.querySelector("kbd")?.textContent).toBe("Space");
  });

  it("shows the copy and the free drag with the Option and Command symbols on a Mac", () => {
    expect(["Alt", "Drag"].map((k) => keyCap(k, true))).toEqual(["⌥", "Drag"]);
    expect(["Mod", "A"].map((k) => keyCap(k, true))).toEqual(["⌘", "A"]);
  });

  it("is in Spanish when the language is", async () => {
    applyLocale({ language: "es", decimal: "auto" });
    render(<ShortcutsDialog />);
    await act(async () => useUiStore.getState().setShortcutsOpen(true));
    expect(screen.getByRole("dialog", { name: "Atajos de teclado" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Pestaña Origen" })).toBeTruthy();
    expect(document.querySelector('[data-shortcut="panHeld"] kbd')?.textContent).toBe("Espacio");
    expect(screen.getByText("Herramienta Pieza")).toBeTruthy();
    expect([...document.querySelectorAll('[data-shortcut="nudgePickedBig"] kbd')].map((k) => k.textContent)).toEqual([
      "Shift",
      "Flechas",
    ]);
  });

  it("has a search that keeps the shortcuts matching their text or their keys, and says when none does", async () => {
    render(<ShortcutsDialog />);
    await act(async () => useUiStore.getState().setShortcutsOpen(true));
    const search = screen.getByRole("searchbox", { name: "Search shortcuts" }) as HTMLInputElement;
    expect(document.activeElement).toBe(search);
    const shown = () => [...document.querySelectorAll("[data-shortcut]")].map((r) => r.getAttribute("data-shortcut"));
    const type = (value: string) => fireEvent.change(search, { target: { value } });
    type("duplic");
    expect(shown()).toEqual(["duplicatePieces"]);
    type("ctrl dup"); // by keys too: Mod is Ctrl
    expect(shown()).toEqual(["duplicatePieces"]);
    type("option"); // Alt is also Option
    expect(shown()).toContain("dragCopy");
    type("PAGINA"); // not case or accent sensitive, in the language
    expect(shown()).toEqual([]);
    expect(screen.getByText("No shortcut matches that.")).toBeTruthy();
    type("");
    expect(shown().length).toBe(SHORTCUT_AREAS.flatMap((a) => SHORTCUTS[a]).length);
    // an area with no match leaves with its heading
    type("redo");
    expect(screen.queryByRole("region", { name: "Source tab" })).toBeNull();
    expect(screen.getByRole("region", { name: "General" })).toBeTruthy();
  });

  it("searches in Spanish ignoring accents, and sticks to the top of the list", async () => {
    applyLocale({ language: "es", decimal: "auto" });
    render(<ShortcutsDialog />);
    await act(async () => useUiStore.getState().setShortcutsOpen(true));
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar atajos" }), { target: { value: "pagina" } });
    expect([...document.querySelectorAll("[data-shortcut]")].map((r) => r.getAttribute("data-shortcut"))).toEqual([
      "fitPage",
      "panWheel",
      "nextPage",
      "previousPage",
      "pickAll",
      "makeGuide",
      "removePage",
    ]);
    expect(screen.getByRole("searchbox").closest("div")?.className).toContain("sticky");
  });

  it("closes with its button, and the store follows", async () => {
    render(<ShortcutsDialog />);
    await act(async () => useUiStore.getState().setShortcutsOpen(true));
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(useUiStore.getState().shortcutsOpen).toBe(false);
  });
});
