#!/usr/bin/env node
// Writes THIRD_PARTY_LICENSES: the notices that the open-source software Gutterberg ships with requires to travel
// with it. The release workflow runs this before the build; the file is built into the app (Preferences › About
// shows it) and bundled with every installer.
//
//   node scripts/third-party-licenses.mjs [--out <file>]
//
// Needs `cargo-about` (cargo install cargo-about --locked --features cli), pnpm with the packages installed, and
// pdfium fetched (scripts/fetch-pdfium.sh writes its licenses next to the library). It stops with an error rather
// than write a file with a section missing.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flag = process.argv.indexOf("--out");
const out = flag > -1 ? resolve(process.argv[flag + 1]) : join(root, "src-tauri/resources/THIRD_PARTY_LICENSES");

const run = (cmd, args) =>
  execFileSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === "win32",
  });
const rule = (title) => `\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}\n`;

/** The Rust crates the app is built from: cargo-about groups them by license, with the license text once. */
function rustNotices() {
  const text = run("cargo", ["about", "generate", "--config", "about.toml", "about.hbs"]).trim();
  if (!text) throw new Error("cargo about produced nothing");
  return text;
}

/** The license files of a package folder: LICENSE, COPYING and NOTICE files, in that folder only. */
export function licenseFiles(dir) {
  return readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8").trim())
    .filter(Boolean);
}

/** The npm packages that go into the app's web side (production dependencies and what they need). */
function npmNotices() {
  const byLicense = JSON.parse(run("pnpm", ["licenses", "list", "--prod", "--json"]));
  const packages = Object.values(byLicense).flat();
  const blocks = [];
  for (const pkg of packages.sort((a, b) => a.name.localeCompare(b.name))) {
    for (const [i, dir] of pkg.paths.entries()) {
      const texts = licenseFiles(dir);
      if (texts.length === 0) throw new Error(`${pkg.name} ${pkg.versions[i] ?? ""} has no license file in ${dir}`);
      const head = `${pkg.name} ${pkg.versions[i] ?? pkg.versions[0]} (${pkg.license})${pkg.homepage ? `\n${pkg.homepage}` : ""}`;
      blocks.push(`${head}\n\n${texts.join("\n\n")}`);
    }
  }
  return blocks.join(`\n\n${"-".repeat(78)}\n\n`);
}

/** pdfium's own license and those of the libraries inside it, collected by scripts/fetch-pdfium.sh. */
function pdfiumNotices() {
  const file = join(root, "src-tauri/resources/pdfium/PDFIUM_LICENSES.txt");
  if (!existsSync(file)) throw new Error("pdfium's licenses are missing: run scripts/fetch-pdfium.sh first");
  return readFileSync(file, "utf8").trim();
}

function main() {
  const header = [
    "Third-party licenses",
    "",
    "Gutterberg is built from the open-source software below. Each part is used under its own license, and the",
    "notices that these licenses require are reproduced here. Gutterberg's own license is in the LICENSE file.",
  ].join("\n");
  const sections = [
    [`Rust libraries (the application)`, rustNotices()],
    [`Web libraries (the interface)`, npmNotices()],
    [`pdfium and the libraries inside it (PDF rendering)`, pdfiumNotices()],
  ];
  const text = `${header}\n${sections.map(([title, body]) => `${rule(title)}\n${body}\n`).join("")}`;
  writeFileSync(out, text);
  console.log(`Wrote ${out} (${(text.length / 1024).toFixed(0)} KiB)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
