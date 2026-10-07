import { describe, expect, it } from "vitest";
import fixtureText from "../../crates/card-core/tests/data/print_request_freeform.json?raw";
import type { OutputSettings } from "../stores/layout-store";
import { freeformCardId, gridCardId } from "./card";
import type { CardEdits } from "./card-edits";
import type { PageGroup } from "./document-layout";
import { buildPrintRequest, DEFAULT_PLAN } from "./print-request";
import type { Card } from "./sheet-api";

describe("the IPC contract with the Rust planner: freeform and edited cards", () => {
  // Read by crates/card-core/tests/sheets.rs too: a page with a 1 x 2 grid and two tilted freeform
  // cards, one of them turned and one set to a real size, the freeform pair printed first.
  const a4 = { width_pt: 595.2756, height_pt: 841.8898 };
  const groups: PageGroup[] = [
    {
      kind: "grid",
      pages: { first: 0, last: 0 },
      grid: { rows: 1, columns: 2, sourceGapXMm: 0, sourceGapYMm: 0, sourceGapLinked: true },
      selection: { x: 0.1, y: 0.1, width: 0.6, height: 0.2 },
    },
  ];
  const freeform = {
    0: [
      { center: { x: 0.3, y: 0.6 }, width: 64 / 210, height: 89.4 / 297, angle_deg: 7 },
      { center: { x: 0.7, y: 0.6 }, width: 63 / 210, height: 88 / 297, angle_deg: -3.5 },
    ],
  };
  const grid = [0, 1].map(
    (c): Card => ({
      id: gridCardId(0, 0, 0, c),
      source: { center: { x: 100 + c * 150, y: 120 }, width: 150, height: 150, angle_deg: 0 },
      scale: 1,
      turn: 0,
    }),
  );
  const free = [0, 1].map(
    (i): Card => ({
      id: freeformCardId(0, 0, i),
      source: {
        center: { x: a4.width_pt * (i ? 0.7 : 0.3), y: a4.height_pt * 0.6 },
        width: freeform[0][i].width * a4.width_pt,
        height: freeform[0][i].height * a4.height_pt,
        angle_deg: freeform[0][i].angle_deg,
      },
      scale: 1,
      turn: 0,
    }),
  );
  const edits: CardEdits = {
    turns: { "f:0:0:1": 90 },
    scales: { "f:0:0:0": 63 / 64 },
    order: ["f:0:0:1", "f:0:0:0", "g:0:0:0:0", "g:0:0:0:1"],
  };
  const settings: OutputSettings = {
    gapXMm: 2,
    gapYMm: 2,
    gapLinked: true,
    pageMode: "a4",
    orientation: "portrait",
    customWidthMm: 210,
    customHeightMm: 297,
    margins: { top: 5, right: 5, bottom: 5, left: 5 },
  };

  it("builds exactly the request the Rust test reads", () => {
    const req = buildPrintRequest({ ...DEFAULT_PLAN, groupBySize: false }, [...grid, ...free], groups, [a4], settings, {
      freeform,
      edits,
    });
    expect(JSON.parse(JSON.stringify(req))).toEqual(JSON.parse(fixtureText));
  });
});
