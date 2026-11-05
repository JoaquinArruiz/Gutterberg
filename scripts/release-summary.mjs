#!/usr/bin/env node
// A version's short release notes, release-notes/<language>/<x.y.z>.md (en and es): the Keep a Changelog sections that
// have something in them, each with a few one-sentence bullets. CHANGELOG.md and the GitHub release keep the full notes; this summary
// is what the Discord post, the app (What's new and the update prompt, through latest.json) and the Microsoft Store's
// "What's new" show, each with a way to the full changelog except the Store. Discord and latest.json use the English
// one; the app's What's new and the Store's Spanish listing use the Spanish one too.
//
//   node scripts/release-summary.mjs check 1.3.1                fails when a language's summary is missing or wrong
//   node scripts/release-summary.mjs store 1.3.1 [file] [lang]  the Store's plain text (stdout without a file), en by default
//   node scripts/release-summary.mjs latest-json 1.3.1 file     puts the English summary in a latest.json as its notes
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The headings a summary may use, in Keep a Changelog's order, in each language a summary is written in. */
export const SECTIONS_BY_LANGUAGE = {
  en: ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"],
  es: ["Agregado", "Cambiado", "Obsoleto", "Eliminado", "Corregido", "Seguridad"],
};
export const LANGUAGES = Object.keys(SECTIONS_BY_LANGUAGE);
export const SECTIONS = SECTIONS_BY_LANGUAGE.en;

/** The Microsoft Store's limit for "What's new in this version". */
export const STORE_LIMIT = 1500;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the summary of `version` in `language` is, relative to the repository. */
export const summaryFile = (version, language = "en") => `release-notes/${language}/${version}.md`;
/** Where the summary of `version` in `language` is. */
export const summaryPath = (version, language = "en") => join(root, summaryFile(version, language));

/**
 * The summary's sections as { name, items }, and what is wrong with it: a heading that is not one of the language's
 * `SECTIONS_BY_LANGUAGE` or
 * comes twice, text that is not a bullet, a section without bullets, Markdown inside a bullet (the app shows it as
 * typed), or a Store text over its limit.
 */
export function parseSummary(text, language = "en") {
  const names = SECTIONS_BY_LANGUAGE[language] ?? SECTIONS;
  const sections = [];
  const problems = [];
  let current = null;
  for (const [i, line] of text.replace(/\r\n?/g, "\n").split("\n").entries()) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    const bullet = line.match(/^[-*]\s+(.+?)\s*$/);
    if (heading) {
      const name = heading[1];
      if (!names.includes(name)) problems.push(`line ${i + 1}: "${name}" is not one of ${names.join(", ")}`);
      else if (sections.some((s) => s.name === name)) problems.push(`line ${i + 1}: "${name}" comes twice`);
      current = { name, items: [] };
      sections.push(current);
    } else if (bullet && current) {
      current.items.push(bullet[1]);
    } else if (/^\s+\S/.test(line) && current?.items.length) {
      // A bullet that goes on over several lines.
      current.items[current.items.length - 1] += ` ${line.trim()}`;
    } else if (line.trim()) {
      problems.push(`line ${i + 1}: only "### Section" headings and "- " bullets belong in a summary`);
    }
  }
  for (const s of sections) if (!s.items.length) problems.push(`"${s.name}" has no bullets`);
  for (const item of sections.flatMap((s) => s.items)) {
    if (/\*\*|`|\]\(/.test(item)) problems.push(`no Markdown inside a bullet (the app shows it as typed): ${item}`);
  }
  if (!sections.length) problems.push("it has no sections");
  const store = storeText(sections);
  if (store.length > STORE_LIMIT) {
    problems.push(
      `its Store text is ${store.length} characters, over ${STORE_LIMIT}: shorten it or end with "...and more!"`,
    );
  }
  return { sections: sections.filter((s) => s.items.length && names.includes(s.name)), problems };
}

/** The Microsoft Store's text: plain, since the Store shows no Markdown, and without the link. */
export function storeText(sections) {
  return sections.map((s) => [s.name, ...s.items.map((item) => `• ${item}`)].join("\n")).join("\n\n");
}

/** The summary as Markdown again, tidied, as the app shows it from latest.json. */
export function markdown(sections) {
  return sections.map((s) => [`### ${s.name}`, "", ...s.items.map((item) => `- ${item}`)].join("\n")).join("\n\n");
}

/** Reads and checks the summary of `version` in `language`; throws with every problem. */
export function readSummary(version, language = "en") {
  const file = summaryFile(version, language);
  const path = summaryPath(version, language);
  if (!existsSync(path)) throw new Error(`${file} is missing: write the version's summary there`);
  const { sections, problems } = parseSummary(readFileSync(path, "utf8"), language);
  if (problems.length) throw new Error(`${file}:\n  ${problems.join("\n  ")}`);
  return sections;
}

function main([command, version, file, language = "en"]) {
  if (!command || !version) throw new Error("usage: release-summary.mjs check|store|latest-json <x.y.z> [file] [lang]");
  if (!LANGUAGES.includes(language)) throw new Error(`no summaries in "${language}", only ${LANGUAGES.join(", ")}`);
  if (command === "check") {
    // Every language at once, so one that was forgotten is found before the tag.
    const problems = [];
    for (const lang of LANGUAGES) {
      try {
        const store = storeText(readSummary(version, lang)).length;
        console.log(`ok: ${summaryFile(version, lang)} (Store text ${store}/${STORE_LIMIT})`);
      } catch (err) {
        problems.push(err.message);
      }
    }
    if (problems.length) throw new Error(problems.join("\nerror: "));
    return;
  }
  const sections = readSummary(version, command === "store" ? language : "en");
  if (command === "store") {
    if (file) writeFileSync(file, `${storeText(sections)}\n`);
    else console.log(storeText(sections));
  } else if (command === "latest-json") {
    if (!file) throw new Error("latest-json needs the latest.json file");
    const json = JSON.parse(readFileSync(file, "utf8"));
    json.notes = markdown(sections);
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  } else {
    throw new Error(`unknown command "${command}"`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
