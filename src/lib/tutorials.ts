// The catalog of tutorials: walkthroughs of one task that the user starts from the Tutorials list (Help menu, or
// Preferences › Help). Unlike a help tip (`hints.ts`), a tutorial is never shown on its own: it ignores "Show help
// tips" and the tips that were closed, no tip shows while it runs, and nothing about it is saved.
//
// A tutorial's steps are `HintStep`s, so they use the same targets, events and actions as a tip, and are drawn by
// the same code (`HintCard.tsx`). `TutorialHost` runs one.
//
// To add a tutorial:
//   1. Add an entry to `TUTORIALS` below. The key is its id; the order is the order of the list inside its group.
//      The title and the one-line summary are `tutorials.<id>.title|summary` in `locales/en.json` and `es.json`; a
//      step holds the keys of its text there (`tutorials.<id>.<step>.title|text|action`).
//   2. Give it what it `needs` before it starts. If that is missing, the first thing the user sees says so and
//      offers the way there; a tutorial never loads a sample or changes the project by itself.
//   3. New targets, events and actions are added as for a tip (see the notes in `hints.ts`).

import { HINTS, type HintStep, type TextKey } from "./hints";

/** Where the Tutorials list puts a tutorial: the tab it is about, Duplex (also in the Print tab) or the app itself. */
export const TUTORIAL_GROUPS = ["source", "print", "duplex", "app"] as const;
export type TutorialGroup = (typeof TUTORIAL_GROUPS)[number];

/** What a tutorial needs before it starts: nothing, a PDF (or images) open, or pieces to work with. */
export type TutorialNeed = "nothing" | "document" | "pieces";

/** A condition a step can be skipped for, because the user is already where the step takes them. */
export type TutorialSkip = "on-print-tab" | "on-source-tab";

export type TutorialStep = HintStep & { skipWhen?: TutorialSkip };

export type TutorialDef = {
  group: TutorialGroup;
  needs: TutorialNeed;
  steps: readonly [TutorialStep, ...TutorialStep[]];
};

/** Brings the user to the Print tab, unless they are on it. */
const goPrint = {
  title: "tutorials.steps.goPrint.title",
  text: "tutorials.steps.goPrint.text",
  action: { label: "tutorials.steps.goPrint.action", run: "go-stage:print" },
  target: "stage-tabs",
  placement: "bottom",
  advanceOn: "stage-changed:print",
  skipWhen: "on-print-tab",
} as const satisfies TutorialStep;

/** Brings the user to the Source tab, unless they are on it. */
const goSource = {
  title: "tutorials.steps.goSource.title",
  text: "tutorials.steps.goSource.text",
  action: { label: "tutorials.steps.goSource.action", run: "go-stage:cards" },
  target: "stage-tabs",
  placement: "bottom",
  advanceOn: "stage-changed:cards",
  skipWhen: "on-source-tab",
} as const satisfies TutorialStep;

export const TUTORIALS = {
  "resize-pieces": {
    group: "print",
    needs: "pieces",
    steps: [
      goPrint,
      {
        title: "tutorials.resize-pieces.pick.title",
        text: "tutorials.resize-pieces.pick.text",
        target: "card-library",
        placement: "right",
        advanceOn: "library-selection-changed",
      },
      {
        title: "tutorials.resize-pieces.size.title",
        text: "tutorials.resize-pieces.size.text",
        target: "piece-size",
        placement: "left",
        advanceOn: "piece-size-changed",
      },
      {
        title: "tutorials.resize-pieces.sheet.title",
        text: "tutorials.resize-pieces.sheet.text",
        target: "sheet-preview",
        placement: "top",
      },
    ],
  },
  "align-backs": {
    group: "duplex",
    needs: "pieces",
    steps: [
      goPrint,
      {
        title: "tutorials.align-backs.duplex.title",
        text: "tutorials.align-backs.duplex.text",
        action: { label: "tutorials.align-backs.duplex.action", run: "open-section:print.duplex" },
        target: "duplex-section",
        placement: "left",
        advanceOn: "duplex-changed",
      },
      {
        title: "tutorials.align-backs.calibrate.title",
        text: "tutorials.align-backs.calibrate.text",
        target: "calibrate-button",
        placement: "left",
        advanceOn: "calibration-opened",
      },
      {
        title: "tutorials.align-backs.read.title",
        text: "tutorials.align-backs.read.text",
      },
      {
        title: "tutorials.align-backs.offset.title",
        text: "tutorials.align-backs.offset.text",
        target: "back-offset",
        placement: "left",
      },
    ],
  },
  gutterfold: {
    group: "duplex",
    needs: "pieces",
    steps: [
      goPrint,
      {
        title: "tutorials.gutterfold.backs.title",
        text: "tutorials.gutterfold.backs.text",
        action: { label: "tutorials.gutterfold.backs.action", run: "open-section:print.duplex" },
        target: "duplex-section",
        placement: "left",
        advanceOn: "duplex-changed",
      },
      {
        title: "tutorials.gutterfold.pairs.title",
        text: "tutorials.gutterfold.pairs.text",
        target: "gutterfold-pairs",
        placement: "left",
      },
      {
        title: "tutorials.gutterfold.double.title",
        text: "tutorials.gutterfold.double.text",
        target: "pair-backs-button",
        placement: "left",
      },
    ],
  },
  "pair-backs": {
    group: "duplex",
    needs: "pieces",
    steps: [
      goPrint,
      {
        title: "tutorials.pair-backs.open.title",
        text: "tutorials.pair-backs.open.text",
        action: { label: "tutorials.pair-backs.open.action", run: "open-section:print.duplex" },
        target: "pair-backs-button",
        placement: "left",
        advanceOn: "pairing-opened",
      },
      {
        title: "tutorials.pair-backs.rule.title",
        text: "tutorials.pair-backs.rule.text",
        advanceOn: "pairing-applied",
      },
      {
        title: "tutorials.pair-backs.check.title",
        text: "tutorials.pair-backs.check.text",
        target: "card-library",
        placement: "right",
      },
    ],
  },
  "paper-size": {
    group: "print",
    needs: "document",
    steps: [
      goPrint,
      {
        title: "tutorials.paper-size.size.title",
        text: "tutorials.paper-size.size.text",
        action: { label: "tutorials.paper-size.size.action", run: "open-section:print.sheet" },
        target: "sheet-size",
        placement: "left",
        advanceOn: "sheet-size-changed",
      },
      {
        title: "tutorials.paper-size.orientation.title",
        text: "tutorials.paper-size.orientation.text",
        action: { label: "tutorials.paper-size.orientation.action", run: "open-section:print.page" },
        target: "sheet-orientation",
        placement: "left",
      },
    ],
  },
  "find-piece": {
    group: "print",
    needs: "pieces",
    steps: [
      goPrint,
      {
        title: "tutorials.find-piece.show.title",
        text: "tutorials.find-piece.show.text",
        target: "references-button",
        placement: "bottom",
        advanceOn: "references-shown",
      },
      {
        title: "tutorials.find-piece.library.title",
        text: "tutorials.find-piece.library.text",
        target: "card-library",
        placement: "right",
      },
    ],
  },
  "several-grids": {
    group: "source",
    needs: "document",
    steps: [
      goSource,
      {
        title: "tutorials.several-grids.first.title",
        text: "tutorials.several-grids.first.text",
        target: "grid-tool-button",
        placement: "bottom",
        advanceOn: "selection-created",
      },
      {
        title: "tutorials.several-grids.add.title",
        text: "tutorials.several-grids.add.text",
        target: "add-grid-button",
        placement: "left",
        advanceOn: "grid-added",
      },
      {
        title: "tutorials.several-grids.name.title",
        text: "tutorials.several-grids.name.text",
        target: "grid-list",
        placement: "left",
      },
      {
        title: "tutorials.several-grids.pick.title",
        text: "tutorials.several-grids.pick.text",
        target: "select-tool-button",
        placement: "bottom",
      },
    ],
  },
  "images-as-pieces": {
    group: "app",
    needs: "nothing",
    steps: [
      {
        title: "tutorials.images-as-pieces.open.title",
        text: "tutorials.images-as-pieces.open.text",
        target: "file-menu",
        placement: "bottom",
        advanceOn: "images-dialog-opened",
      },
      {
        title: "tutorials.images-as-pieces.size.title",
        text: "tutorials.images-as-pieces.size.text",
        advanceOn: "images-added",
      },
      {
        title: "tutorials.images-as-pieces.library.title",
        text: "tutorials.images-as-pieces.library.text",
        action: { label: "tutorials.steps.goPrint.action", run: "go-stage:print" },
        target: "card-library",
        placement: "right",
      },
    ],
  },
  // The first-PDF tour and the Print tab's introduction, run again on request; their texts are the tips' own.
  "mark-and-export": {
    group: "source",
    needs: "document",
    steps: [goSource, ...HINTS["first-pdf-tour"].steps, ...HINTS["print-stage-intro"].steps],
  },
  update: {
    group: "app",
    needs: "nothing",
    steps: [
      {
        title: "tutorials.update.open.title",
        text: "tutorials.update.open.text",
        action: { label: "tutorials.update.open.action", run: "open-preferences:updates" },
        advanceOn: "prefs-opened:updates",
      },
      {
        title: "tutorials.update.check.title",
        text: "tutorials.update.check.text",
        advanceOn: "update-check-started",
      },
      {
        title: "tutorials.update.install.title",
        text: "tutorials.update.install.text",
      },
    ],
  },
  "report-problem": {
    group: "app",
    needs: "nothing",
    steps: [
      {
        title: "tutorials.report-problem.menu.title",
        text: "tutorials.report-problem.menu.text",
        action: { label: "tutorials.report-problem.menu.action", run: "open-bug-report" },
        target: "help-menu",
        placement: "bottom",
        advanceOn: "prefs-opened:about",
      },
      {
        title: "tutorials.report-problem.log.title",
        text: "tutorials.report-problem.log.text",
        advanceOn: "log-copied",
      },
      {
        title: "tutorials.report-problem.form.title",
        text: "tutorials.report-problem.form.text",
      },
    ],
  },
} as const satisfies Record<string, TutorialDef>;

export type TutorialId = keyof typeof TUTORIALS;

/** Catalog order, which is also the order inside each group of the list. */
export const TUTORIAL_IDS = Object.keys(TUTORIALS) as TutorialId[];

export const isTutorialId = (v: unknown): v is TutorialId => typeof v === "string" && Object.hasOwn(TUTORIALS, v);

export const tutorialDef = (id: TutorialId): TutorialDef => TUTORIALS[id];

/** What is missing for a tutorial to start, if anything: no PDF open, or a PDF with no pieces marked yet. */
export type UnmetNeed = "document" | "pieces";

export function unmetNeed(needs: TutorialNeed, state: { hasDocument: boolean; hasPieces: boolean }): UnmetNeed | null {
  if (needs === "nothing") return null;
  if (!state.hasDocument) return "document";
  return needs === "pieces" && !state.hasPieces ? "pieces" : null;
}

/** The step shown instead of the tutorial's own while its need is not met: what is missing, and the way to get it. */
export const NEEDS_STEPS = {
  document: {
    title: "tutorials.needs.document.title",
    text: "tutorials.needs.document.text",
    action: { label: "tutorials.needs.document.action", run: "open-pdf" },
  },
  pieces: {
    title: "tutorials.needs.pieces.title",
    text: "tutorials.needs.pieces.text",
    action: { label: "tutorials.needs.pieces.action", run: "start-tutorial:mark-and-export" },
  },
} as const satisfies Record<UnmetNeed, HintStep>;

/** The keys of a tutorial's title and one-line summary. */
export const tutorialTitleKey = (id: TutorialId): TextKey => `tutorials.${id}.title` as TextKey;
export const tutorialSummaryKey = (id: TutorialId): TextKey => `tutorials.${id}.summary` as TextKey;
export const tutorialGroupKey = (group: TutorialGroup): TextKey => `tutorials.groups.${group}` as TextKey;
