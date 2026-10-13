#!/usr/bin/env node
// Makes sure the pdfium library is in src-tauri/resources/pdfium before `pnpm tauri dev` starts the app, so a fresh
// checkout does not open to "could not load the pdfium library". tauri.conf.json runs it in beforeDevCommand.
//
// What it does, and all it does:
//   1. Stops at once, quietly, if PDFIUM_LIB_PATH is set (you manage pdfium yourself), if
//      GUTTERBERG_SKIP_PDFIUM_FETCH is set, or if the library is already in src-tauri/resources/pdfium.
//   2. Otherwise it says so and runs `bash scripts/fetch-pdfium.sh <your platform>`: the script anyone can read, that
//      downloads one prebuilt pdfium from github.com/bblanchon/pdfium-binaries at a pinned tag, checks it against a
//      SHA-256 written in the script, and copies the library and its licenses into src-tauri/resources/pdfium.
// It never fails the start: if the download does not work it prints what to run by hand, and the app says the same.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The file name of the pdfium library on a platform (Node's `process.platform`). */
export const libraryName = (platform) =>
  platform === "win32" ? "pdfium.dll" : platform === "darwin" ? "libpdfium.dylib" : "libpdfium.so";

/** The target `scripts/fetch-pdfium.sh` takes for this machine, or null when there is no prebuilt pdfium for it. */
export function pdfiumTarget(platform, arch) {
  const key = `${platform}-${arch}`;
  const targets = {
    "linux-x64": "linux-x64",
    "linux-arm64": "linux-arm64",
    "darwin-x64": "mac-x64",
    "darwin-arm64": "mac-arm64",
    "win32-x64": "win-x64",
  };
  return targets[key] ?? null;
}

/** What to do: nothing (`skip`, with the reason) or fetch. `exists` says whether the library is already there. */
export function plan({ env, platform, arch, exists }) {
  if (env.PDFIUM_LIB_PATH) return { action: "skip", reason: "PDFIUM_LIB_PATH is set" };
  if (env.GUTTERBERG_SKIP_PDFIUM_FETCH) return { action: "skip", reason: "GUTTERBERG_SKIP_PDFIUM_FETCH is set" };
  if (exists) return { action: "skip", reason: "pdfium is already there" };
  const target = pdfiumTarget(platform, arch);
  if (!target) return { action: "unsupported" };
  return { action: "fetch", target };
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = join(root, "src-tauri", "resources", "pdfium");
  const { platform, arch, env } = process;
  const step = plan({ env, platform, arch, exists: existsSync(join(dir, libraryName(platform))) });
  if (step.action === "skip") return;
  if (step.action === "unsupported") {
    console.warn(`No prebuilt pdfium for ${platform}-${arch}. Build or download one and set PDFIUM_LIB_PATH.`);
    return;
  }
  console.log(`pdfium is not in ${dir}.`);
  console.log(`Running scripts/fetch-pdfium.sh ${step.target} (downloads a pinned pdfium and checks its SHA-256).`);
  console.log("To skip this next time, set PDFIUM_LIB_PATH or GUTTERBERG_SKIP_PDFIUM_FETCH.");
  const run = spawnSync("bash", [join(root, "scripts", "fetch-pdfium.sh"), step.target], { stdio: "inherit" });
  if (run.status !== 0) {
    console.warn(`Could not fetch pdfium. Run it yourself: scripts/fetch-pdfium.sh ${step.target}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
