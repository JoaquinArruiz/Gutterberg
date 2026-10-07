import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import { HINT_IDS, HINTS, type HintDef, hintVersion, isHintId } from "./hints";

describe("hint catalog", () => {
  it("gives every hint at least one step, and no empty text", () => {
    expect(HINT_IDS.length).toBeGreaterThan(0);
    for (const id of HINT_IDS) {
      const { steps } = HINTS[id] as HintDef;
      expect(steps.length, id).toBeGreaterThan(0);
      for (const step of steps) {
        // A step holds catalog keys; each must have text (a missing key shows the key itself).
        expect(t(step.text).trim(), id).not.toBe(step.text);
        if (step.title !== undefined) expect(t(step.title).trim(), id).not.toBe(step.title);
        if (step.action) expect(t(step.action.label).trim(), id).not.toBe(step.action.label);
      }
    }
  });

  it("recognises only catalog ids", () => {
    expect(isHintId("print-stage-intro")).toBe(true);
    expect(isHintId("live-preview-manual")).toBe(false);
    expect(isHintId("toString")).toBe(false);
    expect(isHintId(3)).toBe(false);
  });

  it("defaults a hint's version to 1", () => {
    expect(hintVersion("print-stage-intro")).toBe(1);
  });
});
