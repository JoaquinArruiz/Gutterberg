#!/usr/bin/env node
// Packs the Windows build into the MSIX that goes to the Microsoft Store: the app, the command line, pdfium, the
// licenses and the Store icons, with src-tauri/msix/AppxManifest.xml, packed by the Windows SDK's makeappx. Run by
// .github/workflows/release.yml on the Windows build, once the app and the command line are built. The package is
// not signed: the Store signs it. To try it on your own PC first, see "Microsoft Store" in docs/releasing.md.
// Usage: node scripts/make-msix.mjs --exe <gutterberg.exe> --cli <gutterberg-cli.exe> --out <Gutterberg.msix>
// MAKEAPPX may name makeappx.exe; otherwise the newest one in the Windows SDK is used.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "src-tauri", "msix", "AppxManifest.xml");

// The manifest's Assets\ names and the icons in src-tauri/icons they are copied from.
export const ASSETS = {
  "StoreLogo.png": "StoreLogo.png",
  "Square44x44Logo.png": "Square44x44Logo.png",
  "Square71x71Logo.png": "Square71x71Logo.png",
  "Square150x150Logo.png": "Square150x150Logo.png",
};

// The app's version as MSIX wants it, four numbers: 1.2.0 becomes 1.2.0.0 (the Store keeps the fourth at 0). A
// pre-release such as 1.2.0-beta.1 has no MSIX version and gets null: it does not go to the Store.
export function msixVersion(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) return null;
  const parts = m.slice(1, 4).map(Number);
  if (parts.some((n) => n > 65535)) return null;
  return `${parts.join(".")}.0`;
}

// The manifest with its version filled in.
export function fillManifest(template, version) {
  const text = template.replaceAll("{{VERSION}}", version);
  const left = /\{\{\w+\}\}/.exec(text);
  if (left) throw new Error(`the manifest still has ${left[0]}`);
  return text;
}

// What goes into the package, as [source, path inside the package]. The app finds pdfium in resources\pdfium next to
// its exe, as in the MSI's install folder.
export function packageFiles({ exe, cli, root = ROOT }) {
  return [
    [exe, "Gutterberg.exe"],
    [cli, "gutterberg-cli.exe"],
    [join(root, "src-tauri", "resources", "pdfium"), join("resources", "pdfium")],
    [join(root, "src-tauri", "resources", "THIRD_PARTY_LICENSES"), join("resources", "THIRD_PARTY_LICENSES")],
    [join(root, "LICENSE"), "LICENSE"],
    ...Object.entries(ASSETS).map(([name, icon]) => [join(root, "src-tauri", "icons", icon), join("Assets", name)]),
  ];
}

function findMakeappx(env) {
  if (env.MAKEAPPX) return env.MAKEAPPX;
  const bin = join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  const found = existsSync(bin)
    ? readdirSync(bin)
        .filter((v) => /^10\.\d+\.\d+\.\d+$/.test(v) && existsSync(join(bin, v, "x64", "makeappx.exe")))
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    : [];
  if (!found.length) throw new Error(`no makeappx.exe in ${bin}; install the Windows SDK or set MAKEAPPX`);
  return join(bin, found.at(-1), "x64", "makeappx.exe");
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    if (!["exe", "cli", "out"].includes(key) || argv[i + 1] === undefined) throw new Error(`unexpected ${argv[i]}`);
    out[key] = resolve(argv[i + 1]);
  }
  for (const key of ["exe", "cli", "out"]) if (!out[key]) throw new Error(`--${key} is missing`);
  return out;
}

function main(argv, env) {
  const { exe, cli, out } = args(argv);
  const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const msix = msixVersion(version);
  if (!msix) throw new Error(`${version} is a pre-release or not a version: it does not go to the Store`);
  const dir = mkdtempSync(join(tmpdir(), "gutterberg-msix-"));
  try {
    for (const [from, to] of packageFiles({ exe, cli })) {
      if (!existsSync(from)) throw new Error(`${from} is missing`);
      cpSync(from, join(dir, to), { recursive: true });
    }
    writeFileSync(join(dir, "AppxManifest.xml"), fillManifest(readFileSync(MANIFEST, "utf8"), msix));
    rmSync(out, { force: true });
    execFileSync(findMakeappx(env), ["pack", "/d", dir, "/p", out, "/o"], { stdio: "inherit" });
    console.log(`Packed ${out} (version ${msix}).`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
