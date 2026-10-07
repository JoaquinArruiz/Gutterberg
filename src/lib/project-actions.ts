// What the File menu does: start, open, add to and save a project. The stores hold the project while it is
// open; these functions move it between the stores and the disk, and never leave a half-opened project
// behind: a file is checked, its PDFs are found and read, and only then do the stores change.

import { t } from "../i18n";
import { fileName, nextDocumentId, type OpenDocument, useDocumentStore } from "../stores/document-store";
import { useEditorStore } from "../stores/editor-store";
import { DEFAULT_OUTPUT, type DocLayout, outputSettings, useLayoutStore } from "../stores/layout-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { usePrintStore } from "../stores/print-store";
import { useProjectStore } from "../stores/project-store";
import type { DocumentId } from "./card";
import { type CardEdits, NO_EDITS } from "./card-edits";
import { defaultGroups } from "./document-layout";
import { toAppError } from "./errors";
import { emitHintEvent } from "./hint-events";
import { DEFAULT_PLAN, type PrintPlan } from "./print-request";
import {
  fromProject,
  groupsCoverPages,
  type ProjectDocumentState,
  type ProjectState,
  projectSignature,
  toProject,
} from "./project";
import {
  confirm,
  fileExists,
  hashFile,
  pickProjectToOpen,
  pickProjectToSave,
  readProjectFile,
  writeProjectFile,
} from "./project-api";
import { currentProjectState, currentSignature } from "./project-state";
import { closePdf, openPdf, pickPdf, pickPdfs } from "./tauri";
import { clearCardImages } from "./use-card-image";
import { startSession } from "./workspace";

/** Runs one of the menu's actions: the toolbar shows it is busy, and a failure becomes a notice. */
async function run(action: () => Promise<void>): Promise<void> {
  const docs = useDocumentStore.getState();
  docs.setLoading(true);
  try {
    await action();
  } catch (e) {
    useProjectStore.getState().addError(toAppError(e));
  } finally {
    docs.setLoading(false);
  }
}

/** Whether the project may be replaced: nothing to lose, or the user said to discard it. */
async function confirmDiscard(): Promise<boolean> {
  const { signature } = useProjectStore.getState();
  const now = currentSignature();
  if (now === null || now === signature) return true;
  return confirm(t("project.discard.message"), t("project.discard.ok"));
}

/** Session state that belongs to one project: tool, view, plan, preview and cached images start over. */
function resetSession() {
  useEditorStore.getState().reset();
  useEditorStore.getState().setSelectedCard(null);
  usePrintStore.getState().reset();
  useLayoutStore.getState().clearSnapshot();
  clearCardImages();
  startSession();
}

/**
 * Opens these PDFs in the render thread in place of the open ones. If one cannot be read, the previous ones
 * are opened again so the project on screen keeps working.
 */
async function swapDocuments(files: { id: DocumentId; path: string; hash?: string }[]): Promise<OpenDocument[]> {
  const previous = useDocumentStore.getState().documents;
  try {
    await closePdf();
    const opened: OpenDocument[] = [];
    for (const f of files) {
      const [info, hash] = await Promise.all([openPdf(f.id, f.path), f.hash ?? hashFile(f.path)]);
      opened.push({ id: f.id, path: f.path, pages: info.pages, hash });
    }
    return opened;
  } catch (e) {
    await closePdf().catch(() => {});
    for (const d of previous) await openPdf(d.id, d.path).catch(() => {});
    throw e;
  }
}

type Loaded = {
  activeId: DocumentId;
  layouts: Record<DocumentId, DocLayout>;
  viewed: Record<DocumentId, number>;
  output: ProjectState["output"];
  edits: CardEdits;
  plan: PrintPlan;
};

/** Puts a project into the stores. The PDFs are already open in the render thread. */
function applyLoaded(documents: OpenDocument[], loaded: Loaded) {
  resetSession();
  useDocumentStore.getState().setDocuments(documents, loaded.activeId, loaded.viewed);
  const { [loaded.activeId]: active, ...parked } = loaded.layouts;
  useLayoutStore.getState().loadProject({
    active: active ?? { groups: [], freeform: {} },
    parked,
    output: loaded.output,
    edits: loaded.edits,
  });
  usePrintStore.getState().loadPlan(loaded.plan);
}

/** A project with no PDFs. */
export async function newProject(): Promise<void> {
  if (!(await confirmDiscard())) return;
  await run(async () => {
    await closePdf();
    resetSession();
    useDocumentStore.getState().clear();
    useLayoutStore.getState().loadProject({
      active: { groups: [], freeform: {} },
      parked: {},
      output: DEFAULT_OUTPUT,
      edits: NO_EDITS,
    });
    useProjectStore.getState().clearNotices();
    useProjectStore.getState().setSaved(null, null);
  });
}

/** A new project made of one PDF. The output settings (gap, page, margins) are kept as they are. */
export async function openPdfDialog(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const path = await pickPdf();
  if (!path) return;
  await run(async () => {
    const output = outputSettings(useLayoutStore.getState());
    const [doc] = await swapDocuments([{ id: 0, path }]);
    useProjectStore.getState().clearNotices();
    applyLoaded([doc], {
      activeId: doc.id,
      layouts: { [doc.id]: { groups: defaultGroups(doc.pages.length), freeform: {} } },
      viewed: {},
      output,
      edits: NO_EDITS,
      plan: DEFAULT_PLAN,
    });
    useProjectStore.getState().setSaved(null, currentSignature());
    emitHintEvent("pdf-opened");
  });
}

/** Switch the Source tab to another PDF of the project. */
export function activateDocument(id: DocumentId): void {
  const docs = useDocumentStore.getState();
  if (id === docs.activeId || !docs.documents.some((d) => d.id === id)) return;
  useLayoutStore.getState().switchDocument(docs.activeId, id);
  docs.setActive(id);
  useEditorStore.getState().setSelectedCard(null);
  useEditorStore.getState().reset();
}

/** Add PDFs to the project. Their pieces join the piece library and can share sheets with the others. */
export async function addPdfDialog(): Promise<void> {
  if (useDocumentStore.getState().documents.length === 0) return openPdfDialog();
  const paths = await pickPdfs();
  if (paths.length === 0) return;
  await run(async () => {
    let first: DocumentId | null = null;
    for (const path of paths) {
      const id = nextDocumentId(useDocumentStore.getState());
      const [info, hash] = await Promise.all([openPdf(id, path), hashFile(path)]);
      useLayoutStore.getState().parkDocument(id, { groups: defaultGroups(info.pages.length), freeform: {} });
      useDocumentStore.getState().addDocument({ id, path, pages: info.pages, hash });
      first ??= id;
    }
    if (first !== null) activateDocument(first);
  });
}

/** A PDF of the project that is on disk, or null when the user gave up looking for it. */
type Located = { id: DocumentId; path: string; hash: string };

/**
 * Finds the file of each PDF of a project and checks it is still the same one. A missing file is looked for
 * with the user ("Where is this file now?"), and the new location is taken if its hash matches; if it does
 * not, the user is told and chooses. A file at the saved place that has changed is used, with a warning.
 * Returns null if the user gives up, so nothing is opened.
 */
async function locateDocuments(documents: ProjectDocumentState[]): Promise<Located[] | null> {
  const notices = useProjectStore.getState();
  const located: Located[] = [];
  for (const d of documents) {
    const name = fileName(d.path);
    let path = d.path;
    for (;;) {
      if (!(await fileExists(path))) {
        if (!(await confirm(t("project.relink.message", { name }), t("project.relink.ok")))) return null;
        const picked = await pickPdf();
        if (!picked) return null;
        path = picked;
      }
      const hash = await hashFile(path);
      if (hash === d.hash) {
        located.push({ id: d.id, path, hash });
        break;
      }
      if (path === d.path) {
        notices.addNotice("pdfChanged", { name });
        located.push({ id: d.id, path, hash });
        break;
      }
      // Found somewhere else, and it is a different file.
      if (await confirm(t("project.relink.differs", { name }), t("project.relink.useAnyway"))) {
        notices.addNotice("pdfChanged", { name });
        located.push({ id: d.id, path, hash });
        break;
      }
      path = d.path;
    }
  }
  return located;
}

/** Drop what the project remembers about the pieces of one PDF (its layout was reset). */
function withoutDocument<T>(rec: Record<string, T>, id: DocumentId): Record<string, T> {
  const own = [`g:${id}:`, `f:${id}:`];
  return Object.fromEntries(Object.entries(rec).filter(([k]) => !own.some((p) => k.startsWith(p))));
}

/** Open a saved project, replacing the current one. Without a path the user chooses the file. */
export async function openProjectDialog(path?: string): Promise<void> {
  if (!(await confirmDiscard())) return;
  const file = path ?? (await pickProjectToOpen());
  if (!file) return;
  await run(async () => {
    useProjectStore.getState().clearNotices();
    const prefs = usePreferencesStore.getState();
    let project: ProjectState;
    try {
      project = fromProject(await readProjectFile(file));
    } catch (e) {
      // A recent project that is gone is forgotten; any other file stays where it was listed.
      if (toAppError(e).code === "io") prefs.removeRecentProject(file);
      throw e;
    }
    const located = await locateDocuments(project.documents);
    if (!located) return;
    const opened = await swapDocuments(located);

    let { edits, plan } = project;
    const layouts: Record<DocumentId, DocLayout> = {};
    const viewed: Record<DocumentId, number> = {};
    for (const [i, d] of project.documents.entries()) {
      const n = opened[i].pages.length;
      const fits = groupsCoverPages(d.groups, n) && Object.keys(d.freeform).every((p) => Number(p) < n);
      if (fits) {
        layouts[d.id] = { groups: d.groups, freeform: d.freeform };
      } else {
        // The PDF has other pages than when the project was saved: its old layout would not fit it.
        layouts[d.id] = { groups: defaultGroups(n), freeform: {} };
        edits = {
          turns: withoutDocument(edits.turns, d.id),
          scales: withoutDocument(edits.scales, d.id),
          order: edits.order.filter((k) => !k.startsWith(`g:${d.id}:`) && !k.startsWith(`f:${d.id}:`)),
        };
        plan = { ...plan, quantities: withoutDocument(plan.quantities, d.id) };
        useProjectStore.getState().addNotice("layoutReset", { name: fileName(opened[i].path) });
      }
      viewed[d.id] = Math.min(d.viewedPage, n - 1);
    }

    applyLoaded(opened, { activeId: project.activeId, layouts, viewed, output: project.output, edits, plan });
    // What the file says. If a PDF moved or its layout had to be reset, the open project differs from it,
    // so it counts as modified and saving updates the file.
    useProjectStore.getState().setSaved(file, projectSignature(project));
    prefs.addRecentProject(file);
    emitHintEvent("pdf-opened");
  });
}

/** The name a new project file is offered under: the first PDF's, without `.pdf`. */
function suggestedName(): string {
  const first = useDocumentStore.getState().documents[0];
  return first ? fileName(first.path).replace(/\.pdf$/i, "") : t("project.untitled");
}

async function saveTo(path: string): Promise<boolean> {
  const state = currentProjectState();
  if (!state) return false;
  try {
    await writeProjectFile(path, toProject(state));
  } catch (e) {
    useProjectStore.getState().addError(toAppError(e));
    return false;
  }
  useProjectStore.getState().setSaved(path, projectSignature(state));
  usePreferencesStore.getState().addRecentProject(path);
  return true;
}

/** Save to the project's file; the first time, ask where. Resolves to whether it was saved. */
export async function saveProject(): Promise<boolean> {
  if (useDocumentStore.getState().documents.length === 0) return false;
  const { path } = useProjectStore.getState();
  return path ? saveTo(path) : saveProjectAs();
}

export async function saveProjectAs(): Promise<boolean> {
  if (useDocumentStore.getState().documents.length === 0) return false;
  const picked = await pickProjectToSave(suggestedName());
  return picked ? saveTo(picked) : false;
}
