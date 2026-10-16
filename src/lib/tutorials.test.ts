import { describe, expect, it } from "vitest";
import { applyLocale, t } from "../i18n";
import { HINTS, type HintStep } from "./hints";
import {
  isTutorialId,
  NEEDS_STEPS,
  TUTORIAL_GROUPS,
  TUTORIAL_IDS,
  TUTORIALS,
  tutorialGroupKey,
  tutorialSummaryKey,
  tutorialTitleKey,
  unmetNeed,
} from "./tutorials";

/** The source of the app (not its tests), to look for the targets and events the tutorials rely on. */
const files = import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const code = Object.values(files).join("\n");
/** Every string in a `data-hint-target=…` or `hintTarget=…` attribute, written as text or as an expression. */
const targetsInUi = new Set(
  [...code.matchAll(/(?:data-hint-target|hintTarget)=(?:"([^"]+)"|\{([^}]*)\})/g)].flatMap((m) =>
    m[1] ? [m[1]] : [...m[2].matchAll(/"([^"]+)"/g)].map((q) => q[1]),
  ),
);
/** Every event some code emits. */
const emitted = new Set(
  [...code.matchAll(/emitHintEvent\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((q) => q[1])),
);

const stepsOf = (id: (typeof TUTORIAL_IDS)[number]) => TUTORIALS[id].steps as readonly HintStep[];

describe("tutorial catalog", () => {
  it("has tutorials, each with a group, a need and at least one step", () => {
    expect(TUTORIAL_IDS.length).toBeGreaterThanOrEqual(11);
    for (const id of TUTORIAL_IDS) {
      expect(TUTORIAL_GROUPS, id).toContain(TUTORIALS[id].group);
      expect(["nothing", "document", "pieces"], id).toContain(TUTORIALS[id].needs);
      expect(stepsOf(id).length, id).toBeGreaterThan(0);
    }
  });

  it("has the tutorials of the plan, in order", () => {
    expect(TUTORIAL_IDS).toEqual([
      "resize-pieces",
      "align-backs",
      "gutterfold",
      "pair-backs",
      "paper-size",
      "find-piece",
      "several-grids",
      "images-as-pieces",
      "mark-and-export",
      "update",
      "report-problem",
    ]);
  });

  it("recognises only catalog ids", () => {
    expect(isTutorialId("update")).toBe(true);
    expect(isTutorialId("toString")).toBe(false);
    expect(isTutorialId(3)).toBe(false);
  });

  it("has the text of every title, summary, group and step in both languages", () => {
    for (const language of ["en", "es"] as const) {
      applyLocale({ language, decimal: "auto" });
      const keys = [
        ...TUTORIAL_GROUPS.map(tutorialGroupKey),
        ...TUTORIAL_IDS.flatMap((id) => [tutorialTitleKey(id), tutorialSummaryKey(id)]),
        ...Object.values(NEEDS_STEPS).flatMap((s) => [s.title, s.text, s.action.label]),
        ...TUTORIAL_IDS.flatMap((id) => stepsOf(id).flatMap((s) => [s.title, s.text, s.action?.label])),
      ];
      for (const key of keys) if (key) expect(t(key).trim(), `${language} ${key}`).not.toBe(key);
    }
    applyLocale({ language: "en", decimal: "auto" });
  });

  it("points only at targets that are marked in the UI", () => {
    for (const id of TUTORIAL_IDS) {
      for (const step of stepsOf(id)) {
        for (const target of [step.target, step.tipAt])
          if (target) expect(targetsInUi, `${id}: ${target}`).toContain(target);
      }
    }
  });

  it("advances only on events that the app emits", () => {
    for (const id of TUTORIAL_IDS) {
      for (const step of stepsOf(id))
        if (step.advanceOn) expect(emitted, `${id}: ${step.advanceOn}`).toContain(step.advanceOn);
    }
  });

  it("is not written twice: mark-and-export runs the first-PDF tour and the Print tab introduction", () => {
    const steps = stepsOf("mark-and-export");
    for (const step of [...HINTS["first-pdf-tour"].steps, ...HINTS["print-stage-intro"].steps])
      expect(steps).toContain(step);
  });

  it("starts the tab-bound tutorials by taking the user to their tab, unless they are there", () => {
    for (const id of ["resize-pieces", "align-backs", "gutterfold", "pair-backs", "paper-size", "find-piece"] as const)
      expect(stepsOf(id)[0], id).toMatchObject({ skipWhen: "on-print-tab", action: { run: "go-stage:print" } });
    for (const id of ["several-grids", "mark-and-export"] as const)
      expect(stepsOf(id)[0], id).toMatchObject({ skipWhen: "on-source-tab", action: { run: "go-stage:cards" } });
  });
});

describe("what a tutorial needs", () => {
  it("needs nothing, a PDF, or a PDF with pieces", () => {
    expect(unmetNeed("nothing", { hasDocument: false, hasPieces: false })).toBeNull();
    expect(unmetNeed("document", { hasDocument: false, hasPieces: false })).toBe("document");
    expect(unmetNeed("document", { hasDocument: true, hasPieces: false })).toBeNull();
    expect(unmetNeed("pieces", { hasDocument: false, hasPieces: false })).toBe("document");
    expect(unmetNeed("pieces", { hasDocument: true, hasPieces: false })).toBe("pieces");
    expect(unmetNeed("pieces", { hasDocument: true, hasPieces: true })).toBeNull();
  });

  it("offers Open PDF… when there is no PDF, and the first tutorial when nothing is marked", () => {
    expect(NEEDS_STEPS.document.action.run).toBe("open-pdf");
    expect(NEEDS_STEPS.pieces.action.run).toBe("start-tutorial:mark-and-export");
  });
});
