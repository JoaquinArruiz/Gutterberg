// IPC and dialogs for project files. The format check (is it a project, is it too new, migrate an older
// one) happens in Rust before the data gets here; `parseProject` then validates the rest.

import { invoke } from "@tauri-apps/api/core";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
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

/** A yes/no question in a native dialog. */
export async function confirm(message: string, okLabel: string): Promise<boolean> {
  return ask(message, { kind: "warning", okLabel, cancelLabel: t("common.cancel") });
}
