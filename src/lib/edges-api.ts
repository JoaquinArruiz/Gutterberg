// IPC for the straight edges of a page (sticky edges). Mirrors `card_core::detect::PageEdges` (serde,
// snake_case): points of the page as displayed, top-left origin. The UI asks once per page and keeps
// the answer for the session; opening or closing a document forgets its pages.

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import type { DocumentId } from "./card";

export const PageEdgesSchema = z.object({
  /** Edges that run down the page at `x`, from `y0` to `y1`. */
  vertical: z.array(z.object({ x: z.number(), y0: z.number(), y1: z.number(), strength: z.number() })),
  /** Edges that run across the page at `y`, from `x0` to `x1`. */
  horizontal: z.array(z.object({ y: z.number(), x0: z.number(), x1: z.number(), strength: z.number() })),
});
export type PageEdges = z.infer<typeof PageEdgesSchema>;

const cache = new Map<string, Promise<PageEdges>>();
const key = (documentId: DocumentId, pageIndex: number) => `${documentId}:${pageIndex}`;

/** The strong straight edges of a page of an open PDF, asked for once per page. A failure is not kept. */
export function pageEdges(documentId: DocumentId, pageIndex: number): Promise<PageEdges> {
  const k = key(documentId, pageIndex);
  const hit = cache.get(k);
  if (hit) return hit;
  const asked = invoke("page_edges", { documentId, pageIndex }).then((raw) => PageEdgesSchema.parse(raw));
  cache.set(k, asked);
  asked.catch(() => {
    if (cache.get(k) === asked) cache.delete(k);
  });
  return asked;
}

/** Forgets the edges of one document's pages, or of every document when `documentId` is omitted. */
export function forgetPageEdges(documentId?: DocumentId): void {
  if (documentId === undefined) {
    cache.clear();
    return;
  }
  for (const k of cache.keys()) if (k.startsWith(`${documentId}:`)) cache.delete(k);
}
