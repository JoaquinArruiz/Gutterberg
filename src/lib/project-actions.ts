// What the File menu does: start, open, add to and save a project. The stores hold the project while it is
// open; these functions move it between the stores and the disk, and never leave a half-opened project
// behind: a file is checked, its PDFs are found and read, and only then do the stores change.

import { t } from "../i18n";
import {
  documentName,
  fileName,
  nextDocumentId,
  type OpenDocument,
  type PdfLock,
  useDocumentStore,
} from "../stores/document-store";
import { useEditorStore } from "../stores/editor-store";
import { useImageImportStore } from "../stores/image-import-store";
import { DEFAULT_OUTPUT, type DocLayout, outputSettings, useLayoutStore } from "../stores/layout-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { usePrintStore } from "../stores/print-store";
import { useProjectStore } from "../stores/project-store";
import { useToastStore } from "../stores/toast-store";
import type { DocumentId } from "./card";
import { backsWithoutDocument, type CardEdits, isCardOfDocument, NO_EDITS } from "./card-edits";
import { defaultGroups } from "./document-layout";
import { formatError, toAppError } from "./errors";
import { emitHintEvent } from "./hint-events";
import {
  buildImagesDocument,
  type ImagePageInfo,
  type ImageProbe,
  type ImagesInfo,
  imageGroups,
  imagesDocumentName,
  pickImages,
  planImages,
  probeImages,
} from "./images";
import { usualPaper } from "./paper";
import { DEFAULT_PLAN, type PrintPlan } from "./print-request";
import {
  fromProject,
  groupsCoverPages,
  type ImagesDocumentState,
  type ProjectDocumentState,
  type ProjectState,
  projectSignature,
  toProject,
} from "./project";
import {
  confirm,
  fileExists,
  hashFile,
  notify,
  pickProjectToOpen,
  pickProjectToSave,
  readProjectFile,
  writeProjectFile,
} from "./project-api";
import { currentProjectState, currentSignature } from "./project-state";
import { closePdf, type DocumentInfo, openPdf, pickPdf, pickPdfs } from "./tauri";
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

/**
 * Before the app restarts for an update: a project with unsaved changes is saved first (asking where, if it has no
 * file yet). Resolves to whether it may go on; "no" or a cancelled save keeps the app as it is.
 */
export async function saveBeforeRestart(): Promise<boolean> {
  const { signature } = useProjectStore.getState();
  const now = currentSignature();
  if (now === null || now === signature) return true;
  if (!(await confirm(t("updates.unsaved"), t("updates.saveFirst")))) return false;
  return saveProject();
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

/** The permission flags to keep with an open PDF; nothing for an unrestricted one. */
function accessOf(info: DocumentInfo): { access?: PdfLock } {
  const restricted = info.access.other_restricted;
  return info.locked || restricted ? { access: { locked: info.locked, restricted } } : {};
}

/**
 * Opens these PDFs in the render thread in place of the open ones. If one cannot be read, the previous ones
 * are opened again so the project on screen keeps working.
 */
async function swapDocuments(
  files: { id: DocumentId; path: string; hash?: string; images?: ImagesInfo }[],
): Promise<OpenDocument[]> {
  const previous = useDocumentStore.getState().documents;
  try {
    await closePdf();
    const opened: OpenDocument[] = [];
    for (const f of files) {
      const [info, hash] = await Promise.all([openPdf(f.id, f.path), f.hash ?? hashFile(f.path)]);
      opened.push({
        id: f.id,
        path: f.path,
        pages: info.pages,
        hash,
        ...(f.images ? { images: f.images } : accessOf(info)),
      });
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

/** The images of `paths` that the engine accepts; the ones it refuses are listed together, by name. */
async function usableImages(paths: string[]): Promise<ImageProbe[]> {
  const outcomes = await probeImages(paths);
  const refused = outcomes.filter((o) => o.probe === null);
  if (refused.length > 0) await notify(refused.map((o) => formatError(toAppError(o.error))).join("\n"));
  return outcomes.flatMap((o) => (o.probe ? [o.probe] : []));
}

/**
 * Add images to the project, as one document with one page per image. With nothing open it starts the project.
 * Asks the size once for all of them (the size dialog), then the pieces join the piece library. Without `paths`
 * the user chooses the files.
 */
export async function addImagesDialog(paths?: string[]): Promise<void> {
  const chosen = paths ?? (await pickImages());
  if (chosen.length === 0) return;
  let probes: ImageProbe[] = [];
  await run(async () => {
    probes = await usableImages(chosen);
  });
  if (probes.length === 0) return;
  const choice = await useImageImportStore.getState().ask(probes);
  if (!choice) return;

  await run(async () => {
    const docs = useDocumentStore.getState();
    const name = imagesDocumentName(probes.map((p) => p.name));
    const pages: ImagePageInfo[] = probes.map((p, i) => ({
      path: p.path,
      hash: p.hash,
      placement: choice.placements[i],
      plan: null,
      missing: false,
    }));
    const built = await materializeImages(name, pages, probes);
    const piece = built.images.pages.find((p) => p.plan)?.plan?.piece;
    if (!piece) return;
    const groups = imageGroups(pages.length, piece);

    if (docs.documents.length === 0) {
      const output = outputSettings(useLayoutStore.getState());
      const [doc] = await swapDocuments([{ id: 0, path: built.path, images: built.images }]);
      useProjectStore.getState().clearNotices();
      applyLoaded([doc], {
        activeId: doc.id,
        layouts: { [doc.id]: { groups, freeform: {} } },
        viewed: {},
        output,
        edits: NO_EDITS,
        plan: DEFAULT_PLAN,
      });
      sheetForImages();
      useProjectStore.getState().setSaved(null, currentSignature());
      return;
    }
    const id = nextDocumentId(docs);
    const [info, hash] = await Promise.all([openPdf(id, built.path), hashFile(built.path)]);
    useLayoutStore.getState().parkDocument(id, { groups, freeform: {} });
    useDocumentStore.getState().addDocument({ id, path: built.path, pages: info.pages, hash, images: built.images });
    activateDocument(id);
    sheetForImages();
  });
}

/**
 * Images are each the size of one piece, so a sheet "the same as the source" would hold just that piece and, with
 * the margins and the gap, not even that. When the sheet size is still "same as source", set the paper people
 * usually print on (A4 or Letter) and say so; any other size the user chose is kept.
 */
function sheetForImages(): void {
  const layout = useLayoutStore.getState();
  if (layout.pageMode !== "same") return;
  const paper = usualPaper(typeof navigator === "undefined" ? "" : navigator.language);
  layout.setPageMode(paper);
  useToastStore.getState().show({
    title: t("images.sheetSet.title", { size: t(`print.page.modes.${paper}`) }),
    text: t("images.sheetSet.text"),
    autoCloseMs: 10_000,
  });
}

/** Takes the PDF being edited out of the project, after asking. The others, and the output settings, stay. */
export async function removeActiveDocument(): Promise<void> {
  const docs = useDocumentStore.getState();
  const current = docs.documents.find((d) => d.id === docs.activeId);
  if (!current) return;
  const last = docs.documents.length === 1;
  const name = documentName(current);
  const message = t(last ? "project.remove.messageLast" : "project.remove.message", { name });
  if (!(await confirm(message, t("project.remove.ok")))) return;
  await run(async () => {
    await closePdf(current.id);
    const next = docs.documents.find((d) => d.id !== current.id)?.id ?? null;
    if (next === null) {
      const output = outputSettings(useLayoutStore.getState());
      resetSession();
      docs.clear();
      useLayoutStore.getState().loadProject({
        active: { groups: [], freeform: {} },
        parked: {},
        output,
        edits: NO_EDITS,
      });
      return;
    }
    useLayoutStore.getState().removeDocument(current.id, next);
    docs.removeDocument(current.id);
    usePrintStore.getState().forgetDocument(current.id);
    useEditorStore.getState().setSelectedCard(null);
    useEditorStore.getState().reset();
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
      useDocumentStore.getState().addDocument({ id, path, pages: info.pages, hash, ...accessOf(info) });
      first ??= id;
    }
    if (first !== null) activateDocument(first);
  });
}

/** A document of the project as found on disk: a PDF's file, or the images of an images document. */
type Located =
  | { kind: "pdf"; id: DocumentId; path: string; hash: string }
  | { kind: "images"; id: DocumentId; name: string; pages: ImagePageInfo[] };

/**
 * Finds the image files of an images document. One that moved is looked for with the user, like a PDF, and
 * taken if it is the same file; one that changed asks before it replaces the old one. An image the user does
 * not find or does not accept keeps its page, blank and marked missing, so the rest of the project works.
 */
async function locateImages(d: ImagesDocumentState): Promise<ImagePageInfo[]> {
  const notices = useProjectStore.getState();
  const pages: ImagePageInfo[] = [];
  for (const image of d.images) {
    const name = fileName(image.path);
    const missing = (): ImagePageInfo => ({ ...image, plan: null, missing: true });
    let path = image.path;
    let page: ImagePageInfo | null = null;
    for (;;) {
      if (!(await fileExists(path))) {
        if (!(await confirm(t("project.relink.message", { name }), t("project.relink.ok")))) break;
        const [picked] = await pickImages();
        if (!picked) break;
        path = picked;
      }
      const hash = await hashFile(path);
      if (hash === image.hash) {
        page = { ...image, path, plan: null, missing: false };
        break;
      }
      // A different file: at the saved place it replaces the image if the user agrees; elsewhere, too.
      if (await confirm(t("images.changed", { name }), t("images.useChanged"))) {
        notices.addNotice("imageChanged", { name });
        page = { ...image, path, hash, plan: null, missing: false };
        break;
      }
      if (path === image.path) break;
      path = image.path;
    }
    pages.push(page ?? missing());
  }
  if (pages.some((p) => p.missing)) notices.addNotice("imagesMissing", { name: d.name });
  return pages;
}

/** The cached PDF of an images document (built if it is not there), with each image's plan filled in. */
async function materializeImages(
  name: string,
  pages: ImagePageInfo[],
  known: ImageProbe[] = [],
): Promise<{
  path: string;
  images: ImagesInfo;
}> {
  const path = await buildImagesDocument(pages.map((p) => ({ ...p })));
  const present = pages.filter((p) => !p.missing);
  const probes = new Map(known.map((p) => [p.path, p]));
  const toProbe = present.filter((p) => !probes.has(p.path)).map((p) => p.path);
  for (const o of await probeImages(toProbe)) if (o.probe) probes.set(o.path, o.probe);
  const plans = await planImages(
    present.flatMap((p) => {
      const probe = probes.get(p.path);
      return probe ? [{ probe, placement: p.placement }] : [];
    }),
  );
  let next = 0;
  return {
    path,
    images: {
      name,
      pages: pages.map((p) => ({ ...p, plan: p.missing || !probes.has(p.path) ? null : (plans[next++] ?? null) })),
    },
  };
}

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
    if (d.kind === "images") {
      located.push({ kind: "images", id: d.id, name: d.name, pages: await locateImages(d) });
      continue;
    }
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
        located.push({ kind: "pdf", id: d.id, path, hash });
        break;
      }
      if (path === d.path) {
        notices.addNotice("pdfChanged", { name });
        located.push({ kind: "pdf", id: d.id, path, hash });
        break;
      }
      // Found somewhere else, and it is a different file.
      if (await confirm(t("project.relink.differs", { name }), t("project.relink.useAnyway"))) {
        notices.addNotice("pdfChanged", { name });
        located.push({ kind: "pdf", id: d.id, path, hash });
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
    const files = await Promise.all(
      located.map(async (l) => {
        if (l.kind === "pdf") return l;
        const built = await materializeImages(l.name, l.pages);
        return { id: l.id, path: built.path, images: built.images };
      }),
    );
    const opened = await swapDocuments(files);

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
          ...(edits.scalesY ? { scalesY: withoutDocument(edits.scalesY, d.id) } : {}),
          order: edits.order.filter((k) => !k.startsWith(`g:${d.id}:`) && !k.startsWith(`f:${d.id}:`)),
          backs: backsWithoutDocument(edits.backs, d.id),
        };
        const common = plan.finish.duplex.commonBack;
        plan = {
          ...plan,
          quantities: withoutDocument(plan.quantities, d.id),
          finish:
            common !== null && isCardOfDocument(common, d.id)
              ? { ...plan.finish, duplex: { ...plan.finish.duplex, commonBack: null } }
              : plan.finish,
        };
        useProjectStore.getState().addNotice("layoutReset", { name: documentName(opened[i]) });
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
  return first ? documentName(first).replace(/\.(pdf|png|jpe?g|webp)$/i, "") : t("project.untitled");
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
