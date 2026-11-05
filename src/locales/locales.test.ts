import { describe, expect, it } from "vitest";
// @ts-expect-error a plain Node script with no types
import { compare, leaves, problems } from "../../scripts/i18n-status.mjs";
import { resources } from "../i18n";
import { HINT_IDS, HINTS, type HintDef, type HintStep } from "../lib/hints";
import { LANGUAGE_NAME, LANGUAGES } from "../lib/locale";
import {
  NEEDS_STEPS,
  TUTORIAL_GROUPS,
  TUTORIAL_IDS,
  TUTORIALS,
  tutorialGroupKey,
  tutorialSummaryKey,
  tutorialTitleKey,
} from "../lib/tutorials";
import en from "./en.json";
import es from "./es.json";

type Tree = { [key: string]: string | Tree };

const english: Record<string, string> = leaves(en as Tree);
const spanish: Record<string, string> = leaves(es as Tree);

/** Every catalog in this folder, by language code. */
const files = import.meta.glob<Tree>("./*.json", { eager: true, import: "default" });
const all = Object.fromEntries(Object.entries(files).map(([path, tree]) => [path.slice(2, -".json".length), tree]));

describe("translation catalogs", () => {
  it("are all registered, each with its own name", () => {
    const codes = Object.keys(all).sort();
    expect([...LANGUAGES].sort()).toEqual(codes);
    expect(Object.keys(resources).sort()).toEqual(codes);
    for (const code of codes) expect(LANGUAGE_NAME[code as keyof typeof LANGUAGE_NAME], code).toBeTruthy();
  });

  // Spanish is kept complete; any other language may fall behind, and its missing texts show in English.
  it("es.json has every text of en.json", () => {
    expect(compare(en, es, "es").missing).toEqual([]);
  });

  it.each(Object.keys(all).filter((code) => code !== "en"))(
    "%s.json has no unknown key, wrong {{placeholder}}, empty text or incomplete plural",
    (code) => {
      expect(problems(compare(en, all[code], code))).toEqual([]);
    },
  );

  it("en.json has no empty text, and every plural has both forms", () => {
    expect(problems(compare(en, en, "en"))).toEqual([]);
  });

  it("has the text of every step of every hint", () => {
    for (const id of HINT_IDS) {
      for (const step of (HINTS[id] as HintDef).steps) {
        for (const key of [step.title, step.text, step.action?.label]) {
          if (key) {
            expect(english, key).toHaveProperty([key]);
            expect(spanish, key).toHaveProperty([key]);
          }
        }
      }
    }
  });

  it("has the title, summary and every step text of every tutorial, and the texts of its group and needs", () => {
    const keys: string[] = [
      ...TUTORIAL_GROUPS.map(tutorialGroupKey),
      ...TUTORIAL_IDS.flatMap((id) => [tutorialTitleKey(id), tutorialSummaryKey(id)]),
    ];
    for (const step of [
      ...Object.values(NEEDS_STEPS),
      ...TUTORIAL_IDS.flatMap((id) => TUTORIALS[id].steps as readonly HintStep[]),
    ]) {
      for (const key of [step.title, step.text, step.action?.label]) if (key) keys.push(key);
    }
    for (const key of keys) {
      expect(english, key).toHaveProperty([key]);
      expect(spanish, key).toHaveProperty([key]);
    }
  });

  it("has no tutorial text that nothing uses", () => {
    const used = new Set<string>([
      ...TUTORIAL_GROUPS.map(tutorialGroupKey),
      ...TUTORIAL_IDS.flatMap((id) => [tutorialTitleKey(id), tutorialSummaryKey(id)]),
      ...Object.values(NEEDS_STEPS).flatMap((s) => [s.title, s.text, s.action.label]),
      ...TUTORIAL_IDS.flatMap((id) =>
        (TUTORIALS[id].steps as readonly HintStep[]).flatMap((s) => [s.title ?? "", s.text, s.action?.label ?? ""]),
      ),
    ]);
    // The list's own texts (title, search, ...) are used by the components; the rest must come from the catalog.
    const own = new Set(["title", "hint", "search", "noMatch", "close", "closeTitle"]);
    const unused = Object.keys(english).filter(
      (k) => k.startsWith("tutorials.") && !own.has(k.slice("tutorials.".length)) && !used.has(k),
    );
    expect(unused).toEqual([]);
  });

  it("uses the glossary's Spanish terms", () => {
    const text = Object.values(spanish).join("\n");
    for (const term of [
      "Origen",
      "Imprimir",
      "Vista previa",
      "Dividida",
      "pieza",
      "biblioteca de piezas",
      "Herramienta Pieza",
      "hoja",
      "consejo",
    ]) {
      expect(text, term).toContain(term);
    }
    // The old word for a piece, and voseo or vosotros forms, must not come back.
    expect(text).not.toMatch(/\btarjeta/i);
    expect(text).not.toMatch(/\b(elegí|arrastrá|hacé|presioná|vosotros|elegid|arrastrad)\b/i);
  });
});
