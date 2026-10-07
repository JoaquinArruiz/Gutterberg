// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PreferencesDialog } from "./components/preferences/PreferencesDialog";
import { EditorToolbar } from "./components/toolbar/EditorToolbar";
import { StatusBar } from "./components/toolbar/StatusBar";
import { i18n } from "./i18n";
import { decimalSeparator } from "./lib/locale";
import { useDocumentStore } from "./stores/document-store";
import { usePreferencesStore } from "./stores/preferences-store";
import { useUiStore } from "./stores/ui-store";

const prefs = () => usePreferencesStore.getState();

// jsdom has no modal dialogs; the dialog only needs to count as open.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  prefs().resetToDefaults();
  useDocumentStore
    .getState()
    .setDocuments([{ id: 0, path: "/tmp/cards.pdf", pages: [{ width_pt: 612, height_pt: 792 }], hash: "" }], 0);
});
afterEach(() => {
  cleanup();
  prefs().resetToDefaults();
});

describe("language", () => {
  it("starts in English with System, since the test system language is English", () => {
    expect(i18n.language).toBe("en");
    render(<EditorToolbar />);
    expect(screen.getByRole("tab", { name: "Source" })).toBeTruthy();
  });

  it("switches every visible text at once, with no restart", () => {
    render(
      <>
        <EditorToolbar />
        <StatusBar />
      </>,
    );
    act(() => prefs().setLanguage("es"));
    const stages = screen.getByRole("tablist", { name: "Pestañas" });
    expect(within(stages).getByRole("tab", { name: "Origen" })).toBeTruthy();
    expect(within(stages).getByRole("tab", { name: "Imprimir" })).toBeTruthy();
    // The views inside the Source tab: Original / Vista previa / Dividida.
    const views = screen.getByRole("tablist", { name: "Vista" });
    expect(
      within(views)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Original", "Vista previa", "Dividida"]);
    expect(screen.getByTitle("Herramienta Pieza (C)")).toBeTruthy();
    expect(screen.getByText("Página 1 / 1")).toBeTruthy();
    expect(document.documentElement.lang).toBe("es");
    act(() => prefs().setLanguage("en"));
    expect(screen.getByRole("tab", { name: "Source" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("is remembered with the other preferences", () => {
    prefs().setLanguage("es");
    expect(JSON.parse(localStorage.getItem("pdf-card-editor:preferences") ?? "{}").locale.language).toBe("es");
  });
});

describe("decimal separator", () => {
  it("follows the language when Automatic, and can be forced", () => {
    expect(decimalSeparator()).toBe(".");
    prefs().setLanguage("es");
    expect(decimalSeparator()).toBe(",");
    prefs().setDecimal("dot");
    expect(decimalSeparator()).toBe(".");
    prefs().setLanguage("en");
    prefs().setDecimal("comma");
    expect(decimalSeparator()).toBe(",");
    prefs().setDecimal("auto");
    expect(decimalSeparator()).toBe(".");
  });
});

describe("Preferences", () => {
  it("offers the language and the decimal separator, each in its own words", () => {
    useUiStore.setState({ prefsOpen: true, prefsSection: "General" });
    render(<PreferencesDialog />);
    const language = screen.getByRole("combobox", { name: "Language" });
    expect(language.textContent).toContain("System");
    expect(screen.getByRole("combobox", { name: "Decimal separator" }).textContent).toContain("Automatic");
    act(() => prefs().setLanguage("es"));
    expect(screen.getByRole("combobox", { name: "Idioma" }).textContent).toContain("Español");
    expect(screen.getByRole("combobox", { name: "Separador decimal" }).textContent).toContain("Automático");
    useUiStore.setState({ prefsOpen: false });
  });
});
