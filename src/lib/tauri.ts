import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { z } from "zod";
import type { NormalizedRect } from "./coordinates";

// Mirrors card_core::render::DocumentInfo (serde, snake_case).
const PageSizeSchema = z.object({ width_pt: z.number(), height_pt: z.number() });
export const DocumentInfoSchema = z.object({
  page_count: z.number().int(),
  pages: z.array(PageSizeSchema),
});
export type PageSize = z.infer<typeof PageSizeSchema>;
export type DocumentInfo = z.infer<typeof DocumentInfoSchema>;

export async function pickPdf(): Promise<string | null> {
  const picked = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  return typeof picked === "string" ? picked : null;
}

export async function openPdf(path: string): Promise<DocumentInfo> {
  return DocumentInfoSchema.parse(await invoke("open_pdf", { path }));
}

export async function pickExportPath(inputPath: string): Promise<string | null> {
  const name =
    inputPath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.pdf$/i, "") ?? "cards";
  return save({ defaultPath: `${name}-spaced.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
}

/** Mirrors card_core::layout::GridLayout. */
export type GridPayload = {
  bounds: NormalizedRect;
  rows: number;
  columns: number;
  source_gap_x_mm: number;
  source_gap_y_mm: number;
  gap_x_mm: number;
  gap_y_mm: number;
  margin_top_mm: number;
  margin_right_mm: number;
  margin_bottom_mm: number;
  margin_left_mm: number;
  output_page: PageSize | null;
  fit_page: boolean;
};

/** Exports every page with the given grid via the Rust exporter. Resolves to the page count. */
export async function exportDocument(grid: GridPayload, pageCount: number, outputPath: string): Promise<number> {
  return invoke<number>("export_document", { grid, pageCount, outputPath });
}

/** Renders a page to a PNG blob URL. Caller owns the URL (revokeObjectURL). */
export async function renderPage(pageIndex: number, widthPx: number): Promise<string> {
  const bytes = await invoke<ArrayBuffer>("render_page", { pageIndex, widthPx });
  return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
}

/** Renders only `region` (normalized) of a page at the scale where the page is `fullWidthPx` wide. Caller owns the URL. */
export async function renderRegion(pageIndex: number, region: NormalizedRect, fullWidthPx: number): Promise<string> {
  const bytes = await invoke<ArrayBuffer>("render_region", { pageIndex, region, fullWidthPx });
  return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
}
