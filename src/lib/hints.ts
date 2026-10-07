// The catalog of help tips ("hints"): every hint's text lives here and nowhere else.
//
// A hint is one step (a plain tip) or several (a short walkthrough with Back / Next). Once the
// user closes one it stays closed (saved in preferences as id -> version) until "Reset help
// tips" in Preferences.
//
// To add a hint:
//   1. Add an entry to `HINTS` below. The key is its id; keep the entries in the order they
//      should win when two want to show at once. A step holds the keys of its text in the
//      translation catalogs (`hints.<id>.<step>.title|text|action` in `locales/en.json` and
//      `es.json`), not the text itself.
//   2. Render `<HintToast hint="your-id" className="…" />` where the hint applies. The
//      component decides when (only render it in the right situation) and where (className).
//   3. For a button, add its name to `HintActionId` and its behaviour to `hint-actions.ts`.
//   4. To point a step at the UI, give it a `target` (an element marked `data-hint-target="…"`;
//      add the name to `HintTargetId`). A step can also `advanceOn` an app event (add its name to
//      `HintEventId` and call `emitHintEvent` from where it happens, see `hint-events.ts`).
//   5. To show a hint again after you reword it, raise its `version`.

import type { ParseKeys } from "i18next";

/** The key of a piece of text in the translation catalogs. */
export type TextKey = ParseKeys;

/** Things a hint button can do; implemented in `hint-actions.ts`. */
export type HintActionId = "open-preferences:preview";

/** Elements a step can point at; each is marked `data-hint-target="<id>"` in the UI. */
export type HintTargetId =
  | "page-canvas"
  | "page-canvas-tip"
  | "grid-fields"
  | "stage-tabs"
  | "card-library"
  | "copies"
  | "sheet-inspector"
  | "export-button";

/** App events that can move a step forward, fired with `emitHintEvent`. */
export type HintEventId =
  | "pdf-opened"
  | "selection-created"
  | "grid-changed"
  | "stage-changed:print"
  | "copies-changed"
  | "export-started";

export type HintStep = {
  title?: TextKey;
  text: TextKey;
  action?: { label: TextKey; run: HintActionId };
  /** Element to point at. If it is not on screen the step shows as a plain toast instead. */
  target?: HintTargetId;
  /** Put the tip next to this element instead of the target, for a target too big to sit beside. */
  tipAt?: HintTargetId;
  /** Where the tip sits relative to its target (default: below, flipping when there is no room). */
  placement?: "top" | "bottom" | "left" | "right" | "center";
  /** App event that moves to the next step (on the last step it finishes the hint). Next always works too. */
  advanceOn?: HintEventId;
};

export type HintDef = {
  steps: readonly [HintStep, ...HintStep[]];
  /** Raise it to show the hint again to people who closed an older wording. Default 1. */
  version?: number;
};

export const HINTS = {
  "first-pdf-tour": {
    steps: [
      {
        title: "hints.first-pdf-tour.mark.title",
        text: "hints.first-pdf-tour.mark.text",
        target: "page-canvas",
        tipAt: "page-canvas-tip",
        placement: "top",
        advanceOn: "selection-created",
      },
      {
        title: "hints.first-pdf-tour.grid.title",
        text: "hints.first-pdf-tour.grid.text",
        target: "grid-fields",
        placement: "left",
        advanceOn: "grid-changed",
      },
      {
        title: "hints.first-pdf-tour.overlay.title",
        text: "hints.first-pdf-tour.overlay.text",
        target: "page-canvas",
        tipAt: "page-canvas-tip",
        placement: "top",
      },
      {
        title: "hints.first-pdf-tour.goPrint.title",
        text: "hints.first-pdf-tour.goPrint.text",
        target: "stage-tabs",
        placement: "bottom",
        advanceOn: "stage-changed:print",
      },
    ],
  },
  "freeform-tool": {
    steps: [
      {
        title: "hints.freeform-tool.one.title",
        text: "hints.freeform-tool.one.text",
      },
    ],
  },
  "live-preview-output": {
    steps: [
      {
        text: "hints.live-preview-output.main.text",
        action: { label: "hints.live-preview-output.main.action", run: "open-preferences:preview" },
      },
    ],
  },
  "live-preview-sheets": {
    steps: [
      {
        text: "hints.live-preview-sheets.main.text",
        action: { label: "hints.live-preview-sheets.main.action", run: "open-preferences:preview" },
      },
    ],
  },
  "print-stage-intro": {
    steps: [
      {
        title: "hints.print-stage-intro.library.title",
        text: "hints.print-stage-intro.library.text",
        target: "card-library",
        placement: "right",
      },
      {
        title: "hints.print-stage-intro.copies.title",
        text: "hints.print-stage-intro.copies.text",
        target: "copies",
        placement: "right",
      },
      {
        title: "hints.print-stage-intro.sheet.title",
        text: "hints.print-stage-intro.sheet.text",
        target: "sheet-inspector",
        placement: "left",
      },
      {
        title: "hints.print-stage-intro.export.title",
        text: "hints.print-stage-intro.export.text",
        target: "export-button",
        placement: "bottom",
        advanceOn: "export-started",
      },
    ],
  },
} as const satisfies Record<string, HintDef>;

export type HintId = keyof typeof HINTS;

/** Catalog order, which is also the priority when several hints want to show. */
export const HINT_IDS = Object.keys(HINTS) as HintId[];

export const isHintId = (v: unknown): v is HintId => typeof v === "string" && Object.hasOwn(HINTS, v);

/** The version a dismissal must have reached to keep the hint hidden. */
export const hintVersion = (id: HintId): number => (HINTS[id] as HintDef).version ?? 1;
