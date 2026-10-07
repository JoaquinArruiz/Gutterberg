// The catalog of help tips ("hints"): every hint's text lives here and nowhere else.
//
// A hint is one step (a plain tip) or several (a short walkthrough with Back / Next). Once the
// user closes one it stays closed (saved in preferences as id -> version) until "Reset help
// tips" in Preferences.
//
// To add a hint:
//   1. Add an entry to `HINTS` below. The key is its id; keep the entries in the order they
//      should win when two want to show at once. Text is a plain string (no JSX).
//   2. Render `<HintToast hint="your-id" className="…" />` where the hint applies. The
//      component decides when (only render it in the right situation) and where (className).
//   3. For a button, add its name to `HintActionId` and its behaviour to `hint-actions.ts`.
//   4. To point a step at the UI, give it a `target` (an element marked `data-hint-target="…"`;
//      add the name to `HintTargetId`). A step can also `advanceOn` an app event (add its name to
//      `HintEventId` and call `emitHintEvent` from where it happens, see `hint-events.ts`).
//   5. To show a hint again after you reword it, raise its `version`.

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
  title?: string;
  text: string;
  action?: { label: string; run: HintActionId };
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
        title: "Mark the cards",
        text: "Drag a rectangle around all the cards on the page.",
        target: "page-canvas",
        tipAt: "page-canvas-tip",
        placement: "top",
        advanceOn: "selection-created",
      },
      {
        title: "Set the grid",
        text: "Enter how many columns and rows of cards there are.",
        target: "grid-fields",
        placement: "left",
        advanceOn: "grid-changed",
      },
      {
        title: "Check the overlay",
        text: "The grid lines should sit on the cards. If not, drag the rectangle's handles to adjust it.",
        target: "page-canvas",
        tipAt: "page-canvas-tip",
        placement: "top",
      },
      {
        title: "Go to Print",
        text: "Open the Print tab to choose which cards go on which sheet.",
        target: "stage-tabs",
        placement: "bottom",
        advanceOn: "stage-changed:print",
      },
    ],
  },
  "freeform-tool": {
    steps: [
      {
        title: "One card at a time",
        text: "Drag on the page to draw a card, and click a card to edit it: drag its body to move it, its handles to resize it and the dot above it to rotate it (Shift snaps to 15°). These cards are printed from the Print stage.",
      },
    ],
  },
  "live-preview-output": {
    steps: [
      {
        text: "Live preview is off, so this preview isn't generated automatically. Press the refresh button (bottom right) to generate it. You can change this in Preferences > Preview.",
        action: { label: "Open Preferences", run: "open-preferences:preview" },
      },
    ],
  },
  "live-preview-sheets": {
    steps: [
      {
        text: "Live preview is off, so the row of sheet previews above is not redrawn as you change the plan. Press the refresh button (top right) to update it. The large sheet always follows the plan. You can change this in Preferences > Preview.",
        action: { label: "Open Preferences", run: "open-preferences:preview" },
      },
    ],
  },
  "print-stage-intro": {
    steps: [
      {
        title: "Choose cards",
        text: "Pick the cards you want in the card library on the left.",
        target: "card-library",
        placement: "right",
      },
      {
        title: "Set copies",
        text: "Give each card the number of copies you need, or keep “All cards in order” to print every card once.",
        target: "copies",
        placement: "right",
      },
      {
        title: "Sheet and page",
        text: "Adjust the sheet layout, spacing and page in the inspector on the right.",
        target: "sheet-inspector",
        placement: "left",
      },
      {
        title: "Export",
        text: "When the sheets look right, export the PDF.",
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
