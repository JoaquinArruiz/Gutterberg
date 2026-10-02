import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { z } from "zod";

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

/** Renders a page to a PNG blob URL. Caller owns the URL (revokeObjectURL). */
export async function renderPage(pageIndex: number, widthPx: number): Promise<string> {
  const bytes = await invoke<ArrayBuffer>("render_page", { pageIndex, widthPx });
  return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
}
