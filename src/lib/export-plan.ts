// Turns the document layout into what the exporter takes: one PageJob per included page.

import { gridPayload, type OutputSettings } from "../stores/layout-store";
import type { PageGroup } from "./document-layout";
import type { PageIssue, PageJob } from "./tauri";

export type ExportPlan = {
  /** One job per included page, in page order. */
  jobs: PageJob[];
  /** Pages that cannot be exported for a reason the UI already knows (the Rust checks come next). */
  issues: PageIssue[];
};

export function buildExportPlan(groups: PageGroup[], settings: OutputSettings): ExportPlan {
  const jobs: PageJob[] = [];
  const issues: PageIssue[] = [];
  for (const g of groups) {
    for (let page = g.pages.first; page <= g.pages.last; page++) {
      if (g.kind === "skip") continue;
      if (g.kind === "freeform") {
        issues.push({ page_index: page, message: "pages with freeform cards cannot be exported yet" });
      } else if (!g.selection) {
        issues.push({ page_index: page, message: "no card region is selected" });
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
