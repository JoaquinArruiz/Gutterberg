import { getName, getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { arch, version as osVersion, type } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";

/** The product name, from the app's own configuration (null until known, and outside the app window). */
export function useAppName(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getName()
      .then((n) => live && setName(n))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return name;
}

/** What "Copy app info" and the bug report form carry. */
export type AppInfo = {
  name: string;
  version: string;
  /** The system, e.g. "Windows 11 (x86_64)". */
  os: string;
  language: string;
  /** The pdfium build number; empty when it is not known. */
  pdfium: string;
};

/** A system as people name it: Windows 11 is version 10.0 with a build of 22000 or more. */
export function describeSystem(kind: string, version: string, architecture: string): string {
  let name: string;
  if (kind === "windows") {
    const build = Number(version.split(".")[2]);
    name = Number.isFinite(build) && build >= 22000 ? "Windows 11" : "Windows 10";
  } else if (kind === "macos") name = `macOS ${version}`;
  else if (kind === "linux") name = `Linux ${version}`;
  else name = `${kind} ${version}`.trim();
  return architecture ? `${name} (${architecture})` : name;
}

/** `Gutterberg 1.0.0 · Windows 11 (x86_64) · Language: es · pdfium 8086`, the line to paste into a bug report. */
export function formatAppInfo(info: AppInfo): string {
  const parts = [`${info.name} ${info.version}`, info.os, `Language: ${info.language}`];
  if (info.pdfium) parts.push(`pdfium ${info.pdfium}`);
  return parts.join(" · ");
}

/** Reads the app's name and version, the system and the pdfium build from the app and its plugins. */
export async function loadAppInfo(language: string): Promise<AppInfo> {
  const [name, version, kind, systemVersion, architecture, extra] = await Promise.all([
    getName(),
    getVersion(),
    Promise.resolve(type()),
    Promise.resolve(osVersion()),
    Promise.resolve(arch()),
    invoke<{ pdfium: string }>("app_info").catch(() => ({ pdfium: "" })),
  ]);
  return { name, version, os: describeSystem(kind, systemVersion, architecture), language, pdfium: extra.pdfium };
}

/** The app's version, from its own configuration (null until known, and outside the app window). */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getVersion()
      .then((v) => live && setVersion(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return version;
}
