#!/usr/bin/env node
// How far each translation in src/locales/ is, and what is wrong with it. English (en.json) is the source; every other
// catalog is compared with it. Spanish must stay complete (the catalog tests fail otherwise); any other language may
// fall behind, and a text it does not have yet shows in English. What is wrong is wrong in every language: a key that
// English does not have, a {{placeholder}} that is not English's, an empty text, or a plural without all its forms.
//
//   pnpm i18n:status                  every language: how many texts are translated, and the problems
//   pnpm i18n:status fr               one language, with the keys it is missing
//
// It exits with 1 when a catalog has a problem (not when it is only missing texts).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = join(root, "src", "locales");

/** The suffixes i18next gives plural forms, from the language's own plural rules. */
export const PLURAL_FORMS = ["zero", "one", "two", "few", "many", "other"];

/** Every text of a catalog as a dotted key -> its text. */
export function leaves(tree, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, leaves(v, key));
  }
  return out;
}

/** The {{placeholders}} of a text, sorted. */
export const placeholders = (text) => [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();

/**
 * The plural forms `language` uses: `allowed` is every form its rules have, `required` the ones a whole number of
 * things can take (0 to 1000), plus `other`, which i18next falls back to. Spanish needs one and other; Polish one,
 * few, many and other; Japanese only other.
 */
export function pluralForms(language) {
  const rules = new Intl.PluralRules(language);
  const required = new Set(["other"]);
  for (let n = 0; n <= 1000; n++) required.add(rules.select(n));
  return { allowed: rules.resolvedOptions().pluralCategories, required: PLURAL_FORMS.filter((f) => required.has(f)) };
}

/** The base of a plural key ("pieces" for "pieces_one") when English has that plural, else null. */
function pluralBase(key, englishBases) {
  const m = key.match(/^(.*)_(zero|one|two|few|many|other)$/);
  return m && englishBases.has(m[1]) ? { base: m[1], form: m[2] } : null;
}

/**
 * A catalog compared with English: `total` texts to translate (a plural counts once), `translated`, the English keys
 * it is `missing`, and its problems: `extra` keys English does not have (or a plural form its language does not
 * use), `placeholders` that differ from English's, `empty` texts, and `plurals` it has only some required forms of.
 */
export function compare(english, catalog, language) {
  const en = leaves(english);
  const cat = leaves(catalog);
  const bases = new Set(
    Object.keys(en)
      .filter((k) => k.endsWith("_other"))
      .map((k) => k.slice(0, -"_other".length)),
  );
  const { allowed, required } = pluralForms(language);

  const units = new Map(); // a text to translate -> the catalog's keys that translate it
  for (const k of Object.keys(en)) {
    const p = pluralBase(k, bases);
    units.set(p ? p.base : k, p ? allowed.map((f) => `${p.base}_${f}`) : [k]);
  }
  const missing = [];
  for (const [unit, keys] of units) if (!keys.some((k) => k in cat)) missing.push(unit);

  const extra = [];
  const mismatched = [];
  const empty = [];
  const partial = new Set();
  for (const [k, text] of Object.entries(cat)) {
    if (!text.trim()) empty.push(k);
    const p = pluralBase(k, bases);
    if (p && !allowed.includes(p.form)) extra.push(k);
    else if (!p && !(k in en)) extra.push(k);
    // A plural form English does not have (Polish "few") keeps the placeholders of English's "other".
    const source = en[k] ?? (p ? en[`${p.base}_other`] : undefined);
    if (source !== undefined && placeholders(source).join() !== placeholders(text).join()) mismatched.push(k);
    if (p && required.some((f) => !(`${p.base}_${f}` in cat))) partial.add(p.base);
  }
  return {
    total: units.size,
    translated: units.size - missing.length,
    missing,
    extra,
    placeholders: mismatched,
    empty,
    plurals: [...partial],
  };
}

/** What is wrong with a comparison, as lines; empty when nothing is. */
export function problems(result) {
  const lines = [];
  for (const [what, keys] of [
    ["key English does not have, or a plural form the language does not use", result.extra],
    ["{{placeholder}} that differs from English", result.placeholders],
    ["empty text", result.empty],
    ["plural without all the forms the language needs", result.plurals],
  ]) {
    for (const k of keys) lines.push(`${k}: ${what}`);
  }
  return lines;
}

/** The catalogs in src/locales, by language code, English first. */
export function catalogs(dir = localesDir) {
  const out = {};
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => (a === "en.json" ? -1 : b === "en.json" ? 1 : a.localeCompare(b)));
  for (const f of files) out[f.slice(0, -".json".length)] = JSON.parse(readFileSync(join(dir, f), "utf8"));
  return out;
}

function main(args) {
  const all = catalogs();
  const only = args[0];
  if (only && !(only in all)) {
    console.error(`No src/locales/${only}.json. There are: ${Object.keys(all).join(", ")}.`);
    return 1;
  }
  let failed = false;
  for (const [language, catalog] of Object.entries(all)) {
    if (language === "en" || (only && language !== only)) continue;
    const result = compare(all.en, catalog, language);
    const percent = Math.floor((result.translated / result.total) * 100);
    console.log(`${language}: ${result.translated} of ${result.total} texts translated (${percent}%)`);
    if (only) for (const k of result.missing) console.log(`  missing: ${k}`);
    for (const line of problems(result)) {
      console.log(`  ${line}`);
      failed = true;
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv.slice(2));
