#!/usr/bin/env node
// A version's short release notes, release-notes/<x.y.z>.md: the Keep a Changelog sections that have something in
// them, each with a few one-sentence bullets. CHANGELOG.md and the GitHub release keep the full notes; this summary
// is what the Discord post, the app (What's new and the update prompt, through latest.json) and the Microsoft Store's
// "What's new" show, each with a way to the full changelog except the Store.
//
//   node scripts/release-summary.mjs check 1.3.1               fails when the summary is missing or wrong
//   node scripts/release-summary.mjs store 1.3.1 [file]        the Store's plain text (stdout without a file)
//   node scripts/release-summary.mjs latest-json 1.3.1 file    puts the summary in a latest.json as its notes
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The headings a summary may use, in Keep a Changelog's order. */
export const SECTIONS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

/** The Microsoft Store's limit for "What's new in this version". */
export const STORE_LIMIT = 1500;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the summary of `version` is. */
export const summaryPath = (version) => join(root, "release-notes", `${version}.md`);

/**
 * The summary's sections as { name, items }, and what is wrong with it: a heading that is not one of `SECTIONS` or
 * comes twice, text that is not a bullet, a section without bullets, Markdown inside a bullet (the app shows it as
 * typed), or a Store text over its limit.
 */
export function parseSummary(text) {
  const sections = [];
  const problems = [];
  let current = null;
  for (const [i, line] of text.replace(/\r\n?/g, "\n").split("\n").entries()) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    const bullet = line.match(/^[-*]\s+(.+?)\s*$/);
    if (heading) {
      const name = heading[1];
      if (!SECTIONS.includes(name)) problems.push(`line ${i + 1}: "${name}" is not one of ${SECTIONS.join(", ")}`);
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
  return { sections: sections.filter((s) => s.items.length && SECTIONS.includes(s.name)), problems };
}

/** The Microsoft Store's text: plain, since the Store shows no Markdown, and without the link. */
export function storeText(sections) {
  return sections.map((s) => [s.name, ...s.items.map((item) => `• ${item}`)].join("\n")).join("\n\n");
}

/** The summary as Markdown again, tidied, as the app shows it from latest.json. */
export function markdown(sections) {
  return sections.map((s) => [`### ${s.name}`, "", ...s.items.map((item) => `- ${item}`)].join("\n")).join("\n\n");
}

/** Reads and checks the summary of `version`; throws with every problem. */
export function readSummary(version) {
  const path = summaryPath(version);
  if (!existsSync(path)) throw new Error(`release-notes/${version}.md is missing: write the version's summary there`);
  const { sections, problems } = parseSummary(readFileSync(path, "utf8"));
  if (problems.length) throw new Error(`release-notes/${version}.md:\n  ${problems.join("\n  ")}`);
  return sections;
}

function main([command, version, file]) {
  if (!command || !version) throw new Error("usage: release-summary.mjs check|store|latest-json <x.y.z> [file]");
  const sections = readSummary(version);
  if (command === "check") {
    console.log(`ok: release-notes/${version}.md (Store text ${storeText(sections).length}/${STORE_LIMIT})`);
  } else if (command === "store") {
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
