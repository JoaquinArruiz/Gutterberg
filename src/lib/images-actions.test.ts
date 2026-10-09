import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "../stores/document-store";
import { useImageImportStore } from "../stores/image-import-store";
import { useLayoutStore } from "../stores/layout-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { useProjectStore } from "../stores/project-store";
import { appError } from "./errors";
import { imageWarnings } from "./image-warnings";
import type { ImagePlacement, ImageProbe } from "./images";
import { PROJECT_FORMAT, PROJECT_VERSION, parseProject } from "./project";
import { addImagesDialog, newProject, openProjectDialog, saveProject } from "./project-actions";
import { currentProjectState, currentSignature } from "./project-state";

// A pretend disk: images with a hash and a size in pixels, and the PDFs built from them. The engine itself
// (reading headers, building the PDF, the maths of the plan) has its own tests in Rust; here its answers
// are a simple stand-in.
const fake = vi.hoisted(() => ({
  images: new Map<string, { hash: string; w: number; h: number; dpi: number | null }>(),
  built: new Map<string, number>(),
  buildCalls: [] as string[][],
  projects: new Map<string, unknown>(),
  confirms: [] as boolean[],
  asked: [] as string[],
  notified: [] as string[],
  pickedImages: [] as string[][],
  saveAs: [] as (string | null)[],
  pdfs: new Map<string, { hash: string; pages: number }>(),
}));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const hash = (n: number) => n.toString(16).padStart(64, "0");

vi.mock("./images", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./images")>()),
  pickImages: vi.fn(async () => fake.pickedImages.shift() ?? []),
  probeImages: vi.fn(async (paths: string[]) =>
    paths.map((path) => {
      const img = fake.images.get(path);
      const name = path.split("/").pop() ?? path;
      if (!img || /\.(heic|gif)$/.test(path))
        return { path, probe: null, error: { code: "image_unsupported", message: "unsupported", name } };
      const probe: ImageProbe = {
        path,
        name,
        format: "png",
        widthPx: img.w,
        heightPx: img.h,
        dpi: img.dpi,
        nativeWidthMm: img.dpi ? (img.w / img.dpi) * 25.4 : null,
        nativeHeightMm: img.dpi ? (img.h / img.dpi) * 25.4 : null,
        bytes: 1000,
        hash: img.hash,
        storedBytes: 1000,
      };
      return { path, probe, error: null };
    }),
  ),
  planImages: vi.fn(async (requests: { probe: ImageProbe; placement: ImagePlacement }[]) =>
    requests.map(({ probe, placement }) => {
      const dpi = probe.widthPx / (placement.widthMm / 25.4);
      const pw = placement.widthMm + 2 * placement.bleedMm;
      const ph = placement.heightMm + 2 * placement.bleedMm;
      return {
        pageWidthMm: pw,
        pageHeightMm: ph,
        piece: {
          x: placement.bleedMm / pw,
          y: placement.bleedMm / ph,
          width: placement.widthMm / pw,
          height: placement.heightMm / ph,
        },
        proportionsDiffer: false,
        dpi,
        quality: dpi < 150 ? "blurry" : dpi < 300 ? "soft" : "good",
        veryLarge: dpi > 1200,
        reducedToDpi: null,
        storedBytes: 1000,
      };
    }),
  ),
  buildImagesDocument: vi.fn(async (specs: { path: string; hash: string; missing?: boolean }[]) => {
    fake.buildCalls.push(specs.map((s) => `${s.path}${s.missing ? ":missing" : ""}`));
    const path = `/cache/${specs.map((s) => s.hash.slice(-2) + (s.missing ? "m" : "")).join("")}.pdf`;
    fake.built.set(path, specs.length);
    fake.pdfs.set(path, { hash: hash(900 + specs.length), pages: specs.length });
    return path;
  }),
}));

vi.mock("./tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tauri")>()),
  closePdf: vi.fn(async () => {}),
  openPdf: vi.fn(async (_id: number, path: string) => {
    const pdf = fake.pdfs.get(path);
    if (!pdf) throw { code: "io", message: "no such file" };
    return {
      page_count: pdf.pages,
      pages: Array.from({ length: pdf.pages }, () => A4),
      access: { other_restricted: false },
      locked: null,
    };
  }),
}));

vi.mock("./project-api", () => ({
  readProjectFile: vi.fn(async (path: string) => {
    if (!fake.projects.has(path)) throw { code: "io", message: "no such file" };
    return parseProject({ format: PROJECT_FORMAT, version: PROJECT_VERSION, ...(fake.projects.get(path) as object) });
  }),
  writeProjectFile: vi.fn(async (path: string, project: object) => {
    fake.projects.set(path, JSON.parse(JSON.stringify(project)));
  }),
  hashFile: vi.fn(async (path: string) => {
    const img = fake.images.get(path);
    const pdf = fake.pdfs.get(path);
    if (img) return img.hash;
    if (pdf) return pdf.hash;
    throw { code: "io", message: "no such file" };
  }),
  fileExists: vi.fn(async (path: string) => fake.images.has(path) || fake.pdfs.has(path)),
  pickProjectToOpen: vi.fn(async () => null),
  pickProjectToSave: vi.fn(async () => fake.saveAs.shift() ?? null),
  notify: vi.fn(async (message: string) => {
    fake.notified.push(message);
  }),
  confirm: vi.fn(async (message: string) => {
    fake.asked.push(message);
    return fake.confirms.shift() ?? false;
  }),
}));

const standard: ImagePlacement = { widthMm: 63, heightMm: 88, bleedMm: 0, fit: "fit", reduceLarge: false };
const docs = () => useDocumentStore.getState();
const project = () => useProjectStore.getState();
const noticeKeys = () => project().notices.flatMap((n) => (n.key ? [n.key] : []));

/** Runs the import and answers its size dialog with `placements` (or a cancel). */
async function importImages(paths: string[], answer: ImagePlacement[] | null) {
  const run = addImagesDialog(paths);
  for (let i = 0; i < 50 && !useImageImportStore.getState().pending; i++) await Promise.resolve();
  if (useImageImportStore.getState().pending)
    useImageImportStore.getState().answer(answer ? { placements: answer } : null);
  await run;
}

beforeEach(async () => {
  fake.images.clear();
  fake.built.clear();
  fake.pdfs.clear();
  fake.projects.clear();
  for (const list of [fake.confirms, fake.asked, fake.notified, fake.pickedImages, fake.saveAs, fake.buildCalls])
    list.length = 0;
  fake.images.set("/art/dragon.png", { hash: hash(1), w: 744, h: 1039, dpi: 300 });
  fake.images.set("/art/knight.png", { hash: hash(2), w: 744, h: 1039, dpi: 300 });
  fake.images.set("/art/tiny.png", { hash: hash(3), w: 100, h: 140, dpi: null });
  usePreferencesStore.getState().resetToDefaults();
  fake.confirms.push(true);
  await newProject();
  fake.asked.length = 0;
  project().clearNotices();
  useImageImportStore.setState({ pending: null });
});

describe("adding images", () => {
  it("starts a project from images: one document, one page and one 1 × 1 piece per image", async () => {
    await importImages(["/art/dragon.png", "/art/knight.png"], [standard, standard]);
    expect(docs().documents).toHaveLength(1);
    const doc = docs().documents[0];
    expect(doc.images?.name).toBe("dragon.png + 1 more");
    expect(doc.pages).toHaveLength(2);
    expect(doc.path.startsWith("/cache/")).toBe(true);
    const groups = useLayoutStore.getState().groups;
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.kind === "grid" && [g.grid.rows, g.grid.columns]).toEqual([1, 1]);
    expect(g.kind === "grid" && g.selection).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    // A new project has nothing to save yet, and is not marked as modified.
    expect(project().dirty).toBe(false);
    expect(currentSignature()).toBe(project().signature);
  });

  it("puts bleed around the piece: the piece is the middle of the page", async () => {
    await importImages(["/art/dragon.png"], [{ ...standard, bleedMm: 3 }]);
    const g = useLayoutStore.getState().groups[0];
    expect(g.kind === "grid" && g.selection?.x).toBeCloseTo(3 / 69);
    expect(g.kind === "grid" && g.selection?.width).toBeCloseTo(63 / 69);
  });

  it("names a single image after its file", async () => {
    await importImages(["/art/dragon.png"], [standard]);
    expect(docs().documents[0].images?.name).toBe("dragon.png");
  });

  it("refuses a format it does not read, naming the file, and goes on with the rest", async () => {
    fake.images.set("/art/photo.heic", { hash: hash(4), w: 10, h: 10, dpi: null });
    await importImages(["/art/photo.heic", "/art/dragon.png"], [standard]);
    expect(fake.notified).toHaveLength(1);
    expect(fake.notified[0]).toContain("photo.heic");
    expect(fake.notified[0]).toContain("PNG, JPEG or WebP");
    expect(docs().documents[0].pages).toHaveLength(1);
  });

  it("does nothing, and says so, when every file is refused", async () => {
    fake.images.set("/art/a.gif", { hash: hash(5), w: 10, h: 10, dpi: null });
    await importImages(["/art/a.gif"], null);
    expect(fake.notified).toHaveLength(1);
    expect(docs().documents).toHaveLength(0);
  });

  it("does nothing when the size dialog is cancelled", async () => {
    await importImages(["/art/dragon.png"], null);
    expect(docs().documents).toHaveLength(0);
    expect(fake.buildCalls).toHaveLength(0);
  });

  it("adds a second document to an open project and makes it the one being edited", async () => {
    await importImages(["/art/dragon.png"], [standard]);
    await importImages(["/art/knight.png"], [standard]);
    expect(docs().documents.map((d) => [d.id, d.images?.name])).toEqual([
      [0, "dragon.png"],
      [1, "knight.png"],
    ]);
    expect(docs().activeId).toBe(1);
    expect(useLayoutStore.getState().groups[0].kind).toBe("grid");
  });

  it("keeps the resolution of each page, so low-resolution images can be flagged", async () => {
    await importImages(["/art/tiny.png"], [standard]);
    const page = docs().documents[0].images?.pages[0];
    expect(page?.plan?.quality).toBe("blurry");
    expect(imageWarnings(docs().documents, [{ documentId: 0, page: 0 }])).toEqual([
      expect.objectContaining({ documentId: 0, page: 0, name: "tiny.png", quality: "blurry" }),
    ]);
    // The same page is not listed twice, and a good image is not listed at all.
    expect(
      imageWarnings(docs().documents, [
        { documentId: 0, page: 0 },
        { documentId: 0, page: 0 },
      ]),
    ).toHaveLength(1);
  });
});

describe("saving and opening a project with images", () => {
  async function savedProject() {
    await importImages(["/art/dragon.png", "/art/knight.png"], [standard, { ...standard, fit: "fill" }]);
    fake.saveAs.push("/projects/art.gtr");
    expect(await saveProject()).toBe(true);
  }

  it("keeps the images and their placement, not the PDF built from them", async () => {
    await savedProject();
    const saved = fake.projects.get("/projects/art.gtr") as { documents: Record<string, unknown>[] };
    const doc = saved.documents[0];
    expect(doc.kind).toBe("images");
    expect(doc.name).toBe("dragon.png + 1 more");
    expect(doc.path).toBeUndefined();
    expect(doc.images).toEqual([
      { path: "/art/dragon.png", hash: hash(1), placement: standard },
      { path: "/art/knight.png", hash: hash(2), placement: { ...standard, fit: "fill" } },
    ]);
  });

  it("opens again, building the PDF again when the cache is gone", async () => {
    await savedProject();
    const before = currentProjectState();
    fake.pdfs.clear(); // the cache was cleared
    fake.buildCalls.length = 0;
    await openProjectDialog("/projects/art.gtr");
    expect(fake.buildCalls).toHaveLength(1);
    expect(docs().documents[0].images?.pages.map((p) => [p.path, p.missing])).toEqual([
      ["/art/dragon.png", false],
      ["/art/knight.png", false],
    ]);
    expect(currentProjectState()).toEqual(before);
    expect(project().notices).toHaveLength(0);
  });

  it("keeps the page of an image that is gone, marked missing, and opens the rest", async () => {
    await savedProject();
    fake.images.delete("/art/knight.png");
    fake.confirms.push(false); // "where is it now?" -> the user gives up (the saved project has nothing to discard)
    await openProjectDialog("/projects/art.gtr");
    const pages = docs().documents[0].images?.pages ?? [];
    expect(pages.map((p) => p.missing)).toEqual([false, true]);
    expect(pages[1].plan).toBeNull();
    expect(docs().documents[0].pages).toHaveLength(2);
    expect(noticeKeys()).toContain("imagesMissing");
    // The page is built blank, and the project still saves its image.
    expect(fake.buildCalls.at(-1)).toEqual(["/art/dragon.png", "/art/knight.png:missing"]);
    expect(currentProjectState()?.documents[0]).toMatchObject({ kind: "images" });
    expect(imageWarnings(docs().documents, [{ documentId: 0, page: 1 }])[0].quality).toBe("missing");
  });

  it("finds an image that moved when the user points at the same file", async () => {
    await savedProject();
    const moved = fake.images.get("/art/knight.png");
    if (!moved) throw new Error("fixture");
    fake.images.delete("/art/knight.png");
    fake.images.set("/elsewhere/knight.png", moved);
    fake.pickedImages.push(["/elsewhere/knight.png"]);
    fake.confirms.push(true); // "where is it now?" -> choose the file
    await openProjectDialog("/projects/art.gtr");
    const pages = docs().documents[0].images?.pages ?? [];
    expect(pages[1]).toMatchObject({ path: "/elsewhere/knight.png", missing: false });
    expect(noticeKeys()).not.toContain("imagesMissing");
  });

  it("asks before it uses an image that changed, and keeps the page blank if the user says no", async () => {
    await savedProject();
    fake.images.set("/art/knight.png", { hash: hash(22), w: 744, h: 1039, dpi: 300 });
    fake.confirms.push(false); // do not use the changed file
    await openProjectDialog("/projects/art.gtr");
    expect(fake.asked.some((m) => m.includes("knight.png"))).toBe(true);
    expect(docs().documents[0].images?.pages[1].missing).toBe(true);

    fake.confirms.push(true); // use the changed file
    await openProjectDialog("/projects/art.gtr");
    const page = docs().documents[0].images?.pages[1];
    expect(page).toMatchObject({ missing: false, hash: hash(22) });
    expect(noticeKeys()).toContain("imageChanged");
  });
});

describe("errors from the engine", () => {
  it("reach the notices as codes", async () => {
    const e = appError("image_too_large", "too large", { name: "x.png", megapixels: 120, mb: 10 });
    expect(e.code).toBe("image_too_large");
  });
});
