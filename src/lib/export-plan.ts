// Turns the document layout into what the exporter takes: one PageJob per included page.

import { gridPayload, type OutputSettings } from "../stores/layout-store";
import type { FreeformCards, PageGroup } from "./document-layout";
import type { PageIssue, PageJob } from "./tauri";

export type ExportPlan = {
  /** One job per included page, in page order. */
  jobs: PageJob[];
  /** Pages that cannot be exported for a reason the UI already knows (the Rust checks come next). */
  issues: PageIssue[];
};

/** A page the UI already knows cannot be exported, worded from the catalog like the engine's own. */
const issue = (page: number, code: string, message: string): PageIssue => ({ page_index: page, message, code });

/**
 * The Source tab re-spaces grids only. Freeform pieces are printed from the Print tab, so a page that
 * has nothing but freeform pieces is reported rather than silently exported empty.
 */
export function buildExportPlan(
  groups: PageGroup[],
  settings: OutputSettings,
  freeform: FreeformCards = {},
): ExportPlan {
  const jobs: PageJob[] = [];
  const issues: PageIssue[] = [];
  for (const g of groups) {
    for (let page = g.pages.first; page <= g.pages.last; page++) {
      if (g.kind === "skip") continue;
      if (!g.selection) {
        const own = freeform[page]?.length ?? 0;
        issues.push(
          own > 0
            ? issue(page, "freeform_only", "this page has only freeform pieces: print it from the Print tab")
            : issue(page, "no_region", "no piece region is selected"),
        );
      } else {
        jobs.push({ page_index: page, grid: gridPayload(g.selection, g.grid, settings) });
      }
    }
  }
  return { jobs, issues };
}

/** All issues, once per page (the first reported wins), in page order. */
export function mergeIssues(...lists: PageIssue[][]): PageIssue[] {
  const byPage = new Map<number, PageIssue>();
  for (const issue of lists.flat()) if (!byPage.has(issue.page_index)) byPage.set(issue.page_index, issue);
  return [...byPage.values()].sort((a, b) => a.page_index - b.page_index);
}
