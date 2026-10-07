import { describe, expect, it } from "vitest";
import type { OutputSettings } from "../stores/layout-store";
import { applyGridTo, defaultGroups, patchGrid, setSkipped, updateGridGroup } from "./document-layout";
import { buildExportPlan, mergeIssues } from "./export-plan";

const settings: OutputSettings = {
  gapXMm: 3,
  gapYMm: 4,
  gapLinked: false,
  pageMode: "a4",
  orientation: "landscape",
  customWidthMm: 210,
  customHeightMm: 297,
  margins: { top: 1, right: 2, bottom: 3, left: 4 },
};
const sel = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };

describe("buildExportPlan", () => {
  it("makes one job per included page and leaves skipped pages out", () => {
    let g = updateGridGroup(defaultGroups(4), 0, (x) => ({ ...x, selection: sel }));
    g = setSkipped(g, 0, true);
    const { jobs, issues } = buildExportPlan(g, settings);
    expect(issues).toEqual([]);
    expect(jobs.map((j) => j.page_index)).toEqual([1, 2, 3]);
  });

  it("gives each section its own grid and region", () => {
    // Page 0 rules (skipped), pages 1-2 a 3x3 section, page 3 a 2x2 section.
    let g = defaultGroups(4);
    g = setSkipped(g, 0, true);
    g = updateGridGroup(g, 1, (x) => ({ ...x, selection: sel }));
    g = applyGridTo(g, 1, [3]); // page 3 becomes its own group, then gets its own grid
    g = updateGridGroup(g, 3, (x) => ({
      ...x,
      grid: patchGrid(x.grid, { rows: 2, columns: 2 }),
      selection: { ...sel, width: 0.3 },
    }));
    const { jobs } = buildExportPlan(g, settings);
    expect(jobs.map((j) => [j.page_index, j.grid.rows, j.grid.columns])).toEqual([
      [1, 3, 3],
      [2, 3, 3],
      [3, 2, 2],
    ]);
    expect(jobs[2].grid.bounds.width).toBe(0.3);
    expect(jobs[0].grid.bounds).toEqual(sel);
  });

  it("carries the global output settings into every job", () => {
    const g = updateGridGroup(defaultGroups(2), 0, (x) => ({ ...x, selection: sel }));
    const [job] = buildExportPlan(g, settings).jobs;
    expect(job.grid.gap_x_mm).toBe(3);
    expect(job.grid.gap_y_mm).toBe(4);
    expect(job.grid.margin_left_mm).toBe(4);
    // A4 landscape, in points.
    expect(job.grid.output_page?.width_pt).toBeCloseTo((297 / 25.4) * 72, 6);
    expect(job.grid.fit_page).toBe(false);
  });

  it("reports pages without a card region instead of exporting them", () => {
    const g = setSkipped(defaultGroups(3), 1, true);
    const { jobs, issues } = buildExportPlan(g, settings);
    expect(jobs).toEqual([]);
    expect(issues.map((i) => i.page_index)).toEqual([0, 2]);
  });

  it("has no jobs and no issues when every page is skipped", () => {
    const g = setSkipped(defaultGroups(1), 0, true);
    expect(buildExportPlan(g, settings)).toEqual({ jobs: [], issues: [] });
  });

  it("sends a page with only freeform cards to the Print stage instead of exporting it empty", () => {
    const own = { 0: [{ center: { x: 0.5, y: 0.5 }, width: 0.2, height: 0.3, angle_deg: 4 }] };
    const { jobs, issues } = buildExportPlan(defaultGroups(1), settings, own);
    expect(jobs).toEqual([]);
    expect(issues).toEqual([{ page_index: 0, message: expect.stringContaining("Print stage") }]);
  });

  it("re-spaces the grid of a page that also has freeform cards, and leaves those cards to the Print stage", () => {
    const g = updateGridGroup(defaultGroups(1), 0, (x) => ({ ...x, selection: sel }));
    const own = { 0: [{ center: { x: 0.5, y: 0.5 }, width: 0.2, height: 0.3, angle_deg: 4 }] };
    const { jobs, issues } = buildExportPlan(g, settings, own);
    expect(issues).toEqual([]);
    expect(jobs).toHaveLength(1);
  });
});

describe("mergeIssues", () => {
  it("lists a page once, in page order", () => {
    const a = { page_index: 4, message: "a" };
    const b = { page_index: 1, message: "b" };
    const c = { page_index: 4, message: "c" };
    expect(mergeIssues([a, b], [c])).toEqual([b, a]);
  });
});
