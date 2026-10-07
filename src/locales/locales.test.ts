import { describe, expect, it } from "vitest";
import { HINT_IDS, HINTS, type HintDef } from "../lib/hints";
import en from "./en.json";
import es from "./es.json";

type Tree = { [key: string]: string | Tree };

/** Every leaf as a dotted key -> its text. */
function leaves(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, leaves(v, key));
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();

const english = leaves(en as Tree);
const spanish = leaves(es as Tree);

describe("translation catalogs", () => {
  it("es.json has exactly the keys of en.json", () => {
    const missing = Object.keys(english).filter((k) => !(k in spanish));
    const extra = Object.keys(spanish).filter((k) => !(k in english));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("keeps the same {{placeholders}} in every translated text", () => {
    const mismatched = Object.keys(english)
      .filter((k) => k in spanish)
      .filter((k) => placeholders(english[k]).join() !== placeholders(spanish[k]).join());
    expect(mismatched).toEqual([]);
  });

  it("has no empty text", () => {
    for (const [k, v] of [...Object.entries(english), ...Object.entries(spanish)]) expect(v.trim(), k).not.toBe("");
  });

  it("gives every plural both forms in both languages", () => {
    for (const keys of [Object.keys(english), Object.keys(spanish)]) {
      for (const k of keys.filter((x) => x.endsWith("_one"))) expect(keys, k).toContain(k.replace(/_one$/, "_other"));
      for (const k of keys.filter((x) => x.endsWith("_other"))) expect(keys, k).toContain(k.replace(/_other$/, "_one"));
    }
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
