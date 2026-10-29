// IPC and dialogs for project files. The format check (is it a project, is it too new, migrate an older
// one) happens in Rust before the data gets here; `parseProject` then validates the rest.

import { invoke } from "@tauri-apps/api/core";
import { ask, open, save, message as showMessage } from "@tauri-apps/plugin-dialog";
import { ZodError } from "zod";
import { t } from "../i18n";
import { appError } from "./errors";
import { PROJECT_EXTENSION, type Project, parseProject } from "./project";

const filters = () => [{ name: t("project.fileFilter"), extensions: [PROJECT_EXTENSION] }];

/** Reads, checks and migrates the project at `path`. Rejects with the engine's error (not a project, too new, I/O). */
export async function readProjectFile(path: string): Promise<Project> {
  const raw = await invoke<unknown>("open_project", { path });
  try {
    return parseProject(raw);
  } catch (e) {
    if (!(e instanceof ZodError)) throw e;
    // The signature and version are right but the content is damaged or hand-edited out of shape.
    throw appError("project_invalid", "this project file is damaged or incomplete");
  }
}

/** Writes `project` (without the envelope keys) to `path`; Rust writes `format` and `version` first. */
export async function writeProjectFile(path: string, project: object): Promise<void> {
  await invoke("save_project_file", { path, project });
}

/** SHA-256 of the file at `path`, as lowercase hex. */
export const hashFile = (path: string): Promise<string> => invoke<string>("hash_file", { path });

export const fileExists = (path: string): Promise<boolean> => invoke<boolean>("file_exists", { path });

/** A file of the project beside the project file `project`: named `name`, or with the SHA-256 `hash`. */
export const findBeside = (
  project: string,
  name: string,
  hash: string,
): Promise<{ path: string; same: boolean } | null> =>
  invoke<{ path: string; same: boolean } | null>("find_beside_project", { project, name, hash });

/** Writes `text` as `<name>-Gutterberg-readme.txt` beside the project file `project`; resolves to its path. */
export const writeProjectReadme = (project: string, text: string): Promise<string> =>
  invoke<string>("write_project_readme", { project, text });

/** Writes the Fill with AI pictures beside the project at `project`; their file names, in order. */
export const saveFills = (project: string, fills: { key: string; png: string; hash: string }[]): Promise<string[]> =>
  invoke<string[]>("save_fills", { project, fills });

/** Copies the fills `names` of the project at `from` beside the project at `to` (Save As). */
export const copyProjectFills = (from: string, to: string, names: string[]): Promise<number> =>
  invoke<number>("copy_project_fills", { from, to, names });

/** Of the fills `names` of the project at `project`, the ones whose file is not there. */
export const missingFills = (project: string, names: string[]): Promise<string[]> =>
  invoke<string[]>("missing_fills", { project, names });

export async function pickProjectToOpen(): Promise<string | null> {
  const picked = await open({ multiple: false, filters: filters() });
  return typeof picked === "string" ? picked : null;
}

/** Asks where to save; the `.gtr` extension is added when the user leaves it out. */
export async function pickProjectToSave(suggestedName: string): Promise<string | null> {
  const picked = await save({ defaultPath: `${suggestedName}.${PROJECT_EXTENSION}`, filters: filters() });
  if (!picked) return null;
  return picked.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`) ? picked : `${picked}.${PROJECT_EXTENSION}`;
}

/**
 * Save, Don't save or Cancel in a native dialog, for a project about to be closed. Some systems answer with the
 * button's label and some with its role, so both are understood; anything else (the window's ×, `Esc`) is Cancel.
 */
export async function askSave(text: string): Promise<"save" | "discard" | "cancel"> {
  const buttons = { yes: t("project.close.save"), no: t("project.close.discard"), cancel: t("common.cancel") };
  const answer = await showMessage(text, { kind: "warning", buttons });
  if (answer === buttons.yes || answer === "Yes") return "save";
  if (answer === buttons.no || answer === "No") return "discard";
  return "cancel";
}

/** A message that is not a warning, with an OK button, in a native dialog. */
export async function inform(message: string): Promise<void> {
  await showMessage(message, { kind: "info", okLabel: t("common.ok") });
}

/** A message with an OK button in a native dialog. */
export async function notify(message: string): Promise<void> {
  await showMessage(message, { kind: "warning", okLabel: t("common.ok") });
}

/** A yes/no question in a native dialog; the second button says Cancel unless told otherwise. */
export async function confirm(message: string, okLabel: string, cancelLabel = t("common.cancel")): Promise<boolean> {
  return ask(message, { kind: "warning", okLabel, cancelLabel });
}
