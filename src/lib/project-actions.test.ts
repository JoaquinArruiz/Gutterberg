import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "../stores/document-store";
import { DEFAULT_OUTPUT, useLayoutStore } from "../stores/layout-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { usePrintStore } from "../stores/print-store";
import { useProjectStore } from "../stores/project-store";
import { gridCardId } from "./card";
import { getLayoutDocuments } from "./documents";
import { appError } from "./errors";
import { buildPrintRequest } from "./print-request";
import { PROJECT_FORMAT, PROJECT_VERSION, parseProject } from "./project";
import {
  activateDocument,
  addPdfDialog,
  newProject,
  openPdfDialog,
  openProjectDialog,
  saveProject,
  saveProjectAs,
} from "./project-actions";
import { currentProjectState, currentSignature } from "./project-state";

// A pretend disk and dialogs. The engine's own checks (is it a project, is it too new, the hash, the PDF
// itself) run in Rust and have their tests there; here the files are plain data.
const fake = vi.hoisted(() => ({
  /** PDFs on disk: path -> content hash and page count. */
  pdfs: new Map<string, { hash: string; pages: number }>(),
  /** Project files on disk, as the app wrote them (without the envelope), or a marker for other files. */
  projects: new Map<string, unknown>(),
  /** What the user will answer next. */
  confirms: [] as boolean[],
  asked: [] as string[],
  pickedPdf: [] as (string | null)[],
  pickedPdfs: [] as string[][],
  pickedProject: [] as (string | null)[],
  saveAs: [] as (string | null)[],
  opened: [] as [number, string][],
  closed: 0,
}));

vi.mock("./tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tauri")>()),
  pickPdf: vi.fn(async () => fake.pickedPdf.shift() ?? null),
  pickPdfs: vi.fn(async () => fake.pickedPdfs.shift() ?? []),
  closePdf: vi.fn(async () => {
    fake.closed++;
  }),
  openPdf: vi.fn(async (id: number, path: string) => {
    const pdf = fake.pdfs.get(path);
    if (!pdf) throw { code: "io", message: "no such file" };
    fake.opened.push([id, path]);
    return { page_count: pdf.pages, pages: Array.from({ length: pdf.pages }, () => A4) };
  }),
}));

vi.mock("./project-api", () => ({
  readProjectFile: vi.fn(async (path: string) => {
    if (!fake.projects.has(path)) throw { code: "io", message: "no such file" };
    const content = fake.projects.get(path);
    if (content === "not a project") throw appError("not_a_project", "not a valid project");
    if (content === "newer") throw appError("project_too_new", "newer", { found: 9, supported: 1 });
    return parseProject({ format: PROJECT_FORMAT, version: PROJECT_VERSION, ...(content as object) });
  }),
  writeProjectFile: vi.fn(async (path: string, project: object) => {
    fake.projects.set(path, JSON.parse(JSON.stringify(project)));
  }),
  hashFile: vi.fn(async (path: string) => {
    const pdf = fake.pdfs.get(path);
    if (!pdf) throw { code: "io", message: "no such file" };
    return pdf.hash;
  }),
  fileExists: vi.fn(async (path: string) => fake.pdfs.has(path)),
  pickProjectToOpen: vi.fn(async () => fake.pickedProject.shift() ?? null),
  pickProjectToSave: vi.fn(async () => fake.saveAs.shift() ?? null),
  notify: vi.fn(async () => {}),
  confirm: vi.fn(async (message: string) => {
    fake.asked.push(message);
    return fake.confirms.shift() ?? false;
  }),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const hash = (n: number) => n.toString(16).padStart(64, "0");
const sel = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
const tilted = { center: { x: 0.5, y: 0.5 }, width: 0.2, height: 0.3, angle_deg: 7 };

const docs = () => useDocumentStore.getState();
const layout = () => useLayoutStore.getState();
const project = () => useProjectStore.getState();
const errorCodes = () => project().notices.flatMap((n) => (n.error ? [n.error.code] : []));
const noticeKeys = () => project().notices.flatMap((n) => (n.key ? [n.key] : []));
/** Whether the project differs from what was last saved or opened. */
const modified = () => currentSignature() !== project().signature;

beforeEach(async () => {
  fake.pdfs.clear();
  fake.projects.clear();
  for (const list of [fake.confirms, fake.asked, fake.pickedPdf, fake.pickedPdfs, fake.pickedProject, fake.saveAs])
    list.length = 0;
  fake.opened.length = 0;
  fake.closed = 0;
  fake.pdfs.set("/games/a.pdf", { hash: hash(1), pages: 3 });
  fake.pdfs.set("/games/b.pdf", { hash: hash(2), pages: 2 });
  usePreferencesStore.getState().resetToDefaults();
  for (const p of usePreferencesStore.getState().prefs.files.recent)
    usePreferencesStore.getState().removeRecentProject(p);
  fake.confirms.push(true); // discarding whatever the last test left
  await newProject();
  fake.asked.length = 0;
  fake.closed = 0;
  project().clearNotices();
});

/** A project made of a.pdf, edited in every way a file stores. */
async function editedProject() {
  fake.pickedPdf.push("/games/a.pdf");
  await openPdfDialog();
  layout().setSelection(0, sel);
  layout().setGrid(0, { rows: 2, columns: 2 });
  layout().setSkipped(2, true);
  layout().addFreeformCard(1, tilted);
  layout().setGapX(1.5);
  layout().setPageMode("a4");
  layout().setCardEdits({
    turns: { "g:0:0:0:1": 90 },
    scales: { "g:0:0:1:0": 0.97 },
    order: ["g:0:0:1:0", "g:0:0:0:1"],
  });
  usePrintStore.getState().setQuantity(["g:0:0:0:0"], 4);
  usePrintStore.getState().setOrder("interleaved");
  docs().setCurrentPage(1);
}

describe("starting a project", () => {
  it("opens a PDF as a project of one document, with nothing to save yet", async () => {
    fake.pickedPdf.push("/games/a.pdf");
    await openPdfDialog();
    expect(docs().documents.map((d) => [d.id, d.path, d.pages.length, d.hash])).toEqual([
      [0, "/games/a.pdf", 3, hash(1)],
    ]);
    expect(layout().groups).toHaveLength(1);
    expect(project().path).toBeNull();
    expect(modified()).toBe(false);
    layout().setSelection(0, sel);
    expect(modified()).toBe(true);
  });

  it("starts empty with New, and asks before dropping changes", async () => {
    fake.pickedPdf.push("/games/a.pdf");
    await openPdfDialog();
    layout().setSelection(0, sel);
    fake.confirms.push(false);
    await newProject();
    expect(fake.asked).toHaveLength(1);
    expect(docs().documents).toHaveLength(1);
    expect(layout().groups[0]).toMatchObject({ selection: sel });

    fake.confirms.push(true);
    await newProject();
    expect(docs().documents).toEqual([]);
    expect(layout().groups).toEqual([]);
    expect(layout()).toMatchObject({ ...DEFAULT_OUTPUT });
    expect(fake.closed).toBeGreaterThan(0);
  });

  it("does not ask when nothing changed", async () => {
    fake.pickedPdf.push("/games/a.pdf");
    await openPdfDialog();
    fake.pickedPdf.push("/games/b.pdf");
    await openPdfDialog();
    expect(fake.asked).toEqual([]);
    expect(docs().documents.map((d) => d.path)).toEqual(["/games/b.pdf"]);
  });

  it("keeps the project on screen when the new PDF cannot be opened", async () => {
    fake.pickedPdf.push("/games/a.pdf");
    await openPdfDialog();
    fake.pickedPdf.push("/games/missing.pdf");
    await openPdfDialog();
    expect(errorCodes()).toEqual(["io"]);
    expect(docs().documents.map((d) => d.path)).toEqual(["/games/a.pdf"]);
    // The render thread has it open again.
    expect(fake.opened.at(-1)).toEqual([0, "/games/a.pdf"]);
  });
});

describe("saving and opening", () => {
  it("brings back the same layout, plan and output settings", async () => {
    await editedProject();
    const before = currentProjectState();
    fake.saveAs.push("/projects/game.gtr");
    expect(await saveProject()).toBe(true);
    expect(project().path).toBe("/projects/game.gtr");
    expect(modified()).toBe(false);

    fake.confirms.push(true);
    await newProject();
    expect(docs().documents).toEqual([]);
    await openProjectDialog("/projects/game.gtr");

    expect(errorCodes()).toEqual([]);
    expect(currentProjectState()).toEqual(before);
    expect(docs().currentPage).toBe(1);
    expect(project().path).toBe("/projects/game.gtr");
    expect(modified()).toBe(false);
    expect(usePrintStore.getState()).toMatchObject({
      mode: "custom",
      order: "interleaved",
      quantities: { "g:0:0:0:0": 4 },
    });
    expect(layout()).toMatchObject({ pageMode: "a4", gapXMm: 1.5, gapYMm: 1.5 });
    expect(layout().cardEdits.turns).toEqual({ "g:0:0:0:1": 90 });
    expect(layout().freeform).toEqual({ 1: [tilted] });
    expect(layout().groups.map((g) => g.kind)).toEqual(["grid", "skip"]);
  });

  it("asks where to save the first time only", async () => {
    fake.pickedPdf.push("/games/a.pdf");
    await openPdfDialog();
    layout().setSelection(0, sel);
    expect(await saveProject()).toBe(false); // the user closed the dialog
    expect(fake.projects.size).toBe(0);
    fake.saveAs.push("/projects/one.gtr");
    expect(await saveProject()).toBe(true);
    layout().setGrid(0, { rows: 4 });
    expect(modified()).toBe(true);
    expect(await saveProject()).toBe(true); // no dialog: the answers queue is empty
    expect(fake.projects.size).toBe(1);
    expect(modified()).toBe(false);
    fake.saveAs.push("/projects/two.gtr");
    expect(await saveProjectAs()).toBe(true);
    expect(project().path).toBe("/projects/two.gtr");
    expect(usePreferencesStore.getState().prefs.files.recent).toEqual(["/projects/two.gtr", "/projects/one.gtr"]);
  });

  it("saves nothing while no PDF is open", async () => {
    expect(await saveProject()).toBe(false);
    expect(await saveProjectAs()).toBe(false);
  });

  it("refuses a file that is not a project, and leaves the current project untouched", async () => {
    fake.pickedPdf.push("/games/a.pdf");
    await openPdfDialog();
    layout().setSelection(0, sel);
    fake.projects.set("/projects/notes.gtr", "not a project");
    fake.confirms.push(true);
    await openProjectDialog("/projects/notes.gtr");
    expect(errorCodes()).toEqual(["not_a_project"]);
    expect(docs().documents.map((d) => d.path)).toEqual(["/games/a.pdf"]);
    expect(layout().groups[0]).toMatchObject({ selection: sel });
  });

  it("refuses a project from a newer version, and opens nothing of it", async () => {
    fake.pickedPdf.push("/games/a.pdf");
    await openPdfDialog();
    fake.projects.set("/projects/future.gtr", "newer");
    await openProjectDialog("/projects/future.gtr");
    expect(errorCodes()).toEqual(["project_too_new"]);
    expect(docs().documents.map((d) => d.path)).toEqual(["/games/a.pdf"]);
  });

  it("refuses a project whose content is damaged", async () => {
    fake.pickedPdf.push("/games/a.pdf");
    await openPdfDialog();
    fake.projects.set("/projects/broken.gtr", { documents: [] });
    await openProjectDialog("/projects/broken.gtr");
    expect(docs().documents).toHaveLength(1);
    expect(project().notices).toHaveLength(1);
  });

  it("forgets a recent project whose file is gone", async () => {
    usePreferencesStore.getState().addRecentProject("/projects/gone.gtr");
    await openProjectDialog("/projects/gone.gtr");
    expect(errorCodes()).toEqual(["io"]);
    expect(usePreferencesStore.getState().prefs.files.recent).toEqual([]);
  });

  it("lists the project among the recent ones when it is opened", async () => {
    await editedProject();
    fake.saveAs.push("/projects/game.gtr");
    await saveProject();
    usePreferencesStore.getState().removeRecentProject("/projects/game.gtr");
    fake.confirms.push(true);
    await openProjectDialog("/projects/game.gtr");
    expect(usePreferencesStore.getState().prefs.files.recent).toEqual(["/projects/game.gtr"]);
  });
});

describe("a PDF that moved or changed", () => {
  async function savedWithA() {
    await editedProject();
    fake.saveAs.push("/projects/game.gtr");
    await saveProject();
    fake.confirms.push(true);
    await newProject();
    fake.asked.length = 0;
  }

  it("asks where it is now and takes a file with the same hash", async () => {
    await savedWithA();
    fake.pdfs.set("/moved/a.pdf", { hash: hash(1), pages: 3 });
    fake.pdfs.delete("/games/a.pdf");
    fake.confirms.push(true);
    fake.pickedPdf.push("/moved/a.pdf");
    await openProjectDialog("/projects/game.gtr");
    expect(fake.asked).toHaveLength(1);
    expect(fake.asked[0]).toContain("a.pdf");
    expect(errorCodes()).toEqual([]);
    expect(noticeKeys()).toEqual([]);
    expect(docs().documents.map((d) => d.path)).toEqual(["/moved/a.pdf"]);
    expect(layout().groups[0]).toMatchObject({ selection: sel });
    // The file says the old place, so saving would update it.
    expect(modified()).toBe(true);
  });

  it("warns when the file given is a different one, and uses it only if the user says so", async () => {
    await savedWithA();
    fake.pdfs.set("/other/a.pdf", { hash: hash(7), pages: 3 });
    fake.pdfs.delete("/games/a.pdf");
    // Where is it? Here. It is not the same file. Use it anyway? Yes.
    fake.confirms.push(true, true);
    fake.pickedPdf.push("/other/a.pdf");
    await openProjectDialog("/projects/game.gtr");
    expect(fake.asked).toHaveLength(2);
    expect(noticeKeys()).toEqual(["pdfChanged"]);
    expect(docs().documents.map((d) => [d.path, d.hash])).toEqual([["/other/a.pdf", hash(7)]]);
  });

  it("opens nothing when the user does not know where it is, and the open project stays", async () => {
    await savedWithA();
    fake.pickedPdf.push("/games/b.pdf");
    await openPdfDialog();
    fake.pdfs.delete("/games/a.pdf");
    fake.asked.length = 0;
    fake.confirms.push(false);
    await openProjectDialog("/projects/game.gtr");
    expect(fake.asked).toHaveLength(1);
    expect(errorCodes()).toEqual([]);
    expect(docs().documents.map((d) => d.path)).toEqual(["/games/b.pdf"]);
    expect(project().path).toBeNull();
  });

  it("warns about a PDF that is where it was but has changed", async () => {
    await savedWithA();
    fake.pdfs.set("/games/a.pdf", { hash: hash(9), pages: 3 });
    await openProjectDialog("/projects/game.gtr");
    expect(noticeKeys()).toEqual(["pdfChanged"]);
    expect(layout().groups[0]).toMatchObject({ selection: sel });
    expect(docs().documents[0].hash).toBe(hash(9));
  });

  it("resets a layout that no longer fits the PDF's pages, with what hangs on it", async () => {
    await savedWithA();
    fake.pdfs.set("/games/a.pdf", { hash: hash(9), pages: 5 });
    await openProjectDialog("/projects/game.gtr");
    expect(noticeKeys().sort()).toEqual(["layoutReset", "pdfChanged"]);
    expect(layout().groups).toHaveLength(1);
    expect(layout().groups[0]).toMatchObject({ kind: "grid", pages: { first: 0, last: 4 }, selection: null });
    expect(layout().freeform).toEqual({});
    expect(layout().cardEdits).toEqual({ turns: {}, scales: {}, order: [] });
    expect(usePrintStore.getState().quantities).toEqual({});
    // The output settings are not about any one PDF.
    expect(layout().pageMode).toBe("a4");
  });
});

describe("several PDFs in one project", () => {
  async function twoPdfs() {
    fake.pickedPdf.push("/games/a.pdf");
    await openPdfDialog();
    layout().setSelection(0, sel);
    fake.pickedPdfs.push(["/games/b.pdf"]);
    await addPdfDialog();
  }

  it("adds a PDF beside the first and switches to it", async () => {
    await twoPdfs();
    expect(docs().documents.map((d) => [d.id, d.path])).toEqual([
      [0, "/games/a.pdf"],
      [1, "/games/b.pdf"],
    ]);
    expect(docs().activeId).toBe(1);
    expect(docs().pages).toHaveLength(2);
    // The new PDF starts with a default layout; the first one's is parked untouched.
    expect(layout().groups[0]).toMatchObject({ selection: null, pages: { first: 0, last: 1 } });
    expect(layout().parked[0].groups[0]).toMatchObject({ selection: sel });
    expect(fake.opened).toContainEqual([1, "/games/b.pdf"]);
  });

  it("keeps each PDF's layout when switching back and forth", async () => {
    await twoPdfs();
    layout().setSelection(0, { x: 0, y: 0, width: 0.5, height: 0.5 });
    layout().addFreeformCard(0, tilted);
    activateDocument(0);
    expect(docs().activeId).toBe(0);
    expect(docs().pages).toHaveLength(3);
    expect(layout().groups[0]).toMatchObject({ selection: sel });
    expect(layout().freeform).toEqual({});
    activateDocument(1);
    expect(layout().groups[0]).toMatchObject({ selection: { x: 0, y: 0, width: 0.5, height: 0.5 } });
    expect(layout().freeform).toEqual({ 0: [tilted] });
  });

  it("returns to the page last viewed in each PDF", async () => {
    await twoPdfs();
    activateDocument(0);
    docs().setCurrentPage(2);
    activateDocument(1);
    docs().setCurrentPage(1);
    activateDocument(0);
    expect(docs().currentPage).toBe(2);
    activateDocument(1);
    expect(docs().currentPage).toBe(1);
  });

  it("sends the export every PDF with its own groups", async () => {
    await twoPdfs();
    activateDocument(1);
    layout().setSelection(0, { x: 0, y: 0, width: 1, height: 1 });
    const req = buildPrintRequest(usePrintStore.getState(), [], getLayoutDocuments(), layout(), layout().cardEdits);
    expect(req.documents.map((d) => d.document_id)).toEqual([0, 1]);
    expect(req.documents[0].groups[0]).toMatchObject({ pages: { first: 0, last: 2 } });
    expect(req.documents[1].groups[0]).toMatchObject({ pages: { first: 0, last: 1 } });
  });

  it("saves every PDF and opens them again with the same ids", async () => {
    await twoPdfs();
    layout().setSelection(0, { x: 0.2, y: 0.2, width: 0.5, height: 0.5 });
    usePrintStore.getState().setQuantity([cardKey(1, 0, 0, 0), cardKey(0, 0, 0, 0)], 2);
    const before = currentProjectState();
    fake.saveAs.push("/projects/two.gtr");
    await saveProject();
    fake.confirms.push(true);
    await newProject();
    await openProjectDialog("/projects/two.gtr");
    expect(currentProjectState()).toEqual(before);
    expect(docs().activeId).toBe(1);
    expect(Object.keys(layout().parked)).toEqual(["0"]);
    expect(usePrintStore.getState().quantities).toEqual({ [cardKey(1, 0, 0, 0)]: 2, [cardKey(0, 0, 0, 0)]: 2 });
  });

  it("adding a PDF to nothing is the same as opening one", async () => {
    fake.pickedPdf.push("/games/b.pdf");
    await addPdfDialog();
    expect(docs().documents.map((d) => [d.id, d.path])).toEqual([[0, "/games/b.pdf"]]);
  });

  it("keeps the others when one PDF cannot be added", async () => {
    await twoPdfs();
    fake.pickedPdfs.push(["/games/missing.pdf"]);
    await addPdfDialog();
    expect(errorCodes()).toEqual(["io"]);
    expect(docs().documents).toHaveLength(2);
  });
});

const cardKey = (doc: number, page: number, row: number, column: number) => {
  const id = gridCardId(doc, page, row, column);
  return `g:${id.document_id}:${page}:${row}:${column}`;
};
