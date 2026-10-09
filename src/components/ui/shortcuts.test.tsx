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
    expect(keysOf("gridRegionTool")).toEqual(["V"]);
    expect(keysOf("pieceTool")).toEqual(["C"]);
    expect(keysOf("panTool")).toEqual(["H"]);
    expect(keysOf("turnLeft")).toEqual(["Shift+R"]);
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

  it("is in Spanish when the language is", async () => {
    applyLocale({ language: "es", decimal: "auto" });
    render(<ShortcutsDialog />);
    await act(async () => useUiStore.getState().setShortcutsOpen(true));
    expect(screen.getByRole("dialog", { name: "Atajos de teclado" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Pestaña Origen" })).toBeTruthy();
    expect(document.querySelector('[data-shortcut="panHeld"] kbd')?.textContent).toBe("Espacio");
    expect(screen.getByText("Herramienta Pieza")).toBeTruthy();
  });

  it("closes with its button, and the store follows", async () => {
    render(<ShortcutsDialog />);
    await act(async () => useUiStore.getState().setShortcutsOpen(true));
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(useUiStore.getState().shortcutsOpen).toBe(false);
  });
});
