// Save for sharing: a project handed to someone else with its PDFs, and a readme that says how to open it. Opening
// one finds the PDFs beside the project file (`firstPlace` in project-actions.ts).

import { t } from "../i18n";
import { fileName } from "../stores/document-store";
import { EXTERNAL_LINKS } from "./external-links";
import type { ProjectDocumentState } from "./project";

/** The folder part of a path, with either kind of separator. */
const folderOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));

/** The files a project reads: each PDF, and each image of an images document, by their saved paths. */
export function projectFiles(documents: ProjectDocumentState[]): string[] {
  return documents.flatMap((d) => (d.kind === "pdf" ? [d.path] : d.images.map((i) => i.path)));
}

/** The files of `files` that are not in the folder of the project file `projectFile`, by name. */
export function filesElsewhere(projectFile: string, files: string[]): string[] {
  const folder = folderOf(projectFile);
  return files.filter((f) => folderOf(f) !== folder).map(fileName);
}

/** The readme of a shared project, in the app's language: what the project is and how to print it. */
export function readmeText(projectFile: string, files: string[], version: string): string {
  const project = fileName(projectFile);
  const title = t("project.share.readme.title", { project });
  const lines = [
    title,
    "=".repeat(title.length),
    "",
    t("project.share.readme.what", { project }),
    "",
    t("project.share.readme.ready"),
    "",
    t("project.share.readme.how"),
    `1. ${t("project.share.readme.step1", { link: EXTERNAL_LINKS.projectPage })}`,
    `2. ${t("project.share.readme.step2")}`,
    ...files.map((f) => `   - ${fileName(f)}`),
    `   - ${project}`,
    `3. ${t("project.share.readme.step3", { project })}`,
    `4. ${t("project.share.readme.step4")}`,
    "",
    t("project.share.readme.change"),
    "",
    t("project.share.readme.madeWith", { version }),
    "",
  ];
  // Windows Notepad before 2018 shows a file with bare line feeds on one line.
  return lines.join("\r\n");
}
