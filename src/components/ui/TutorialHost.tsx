import { useEffect, useRef } from "react";
import { hasRegion } from "../../lib/document-layout";
import { useLayoutDocuments } from "../../lib/documents";
import { NEEDS_STEPS, type TutorialSkip, tutorialDef, unmetNeed } from "../../lib/tutorials";
import { useDocumentStore } from "../../stores/document-store";
import { type Stage, useUiStore } from "../../stores/ui-store";
import { HintStepView, useAdvanceOn } from "./HintCard";

const skipped = (skip: TutorialSkip, stage: Stage) => (skip === "on-print-tab" ? stage === "print" : stage === "cards");

/**
 * Runs the tutorial the user started (`ui-store.tutorial`), mounted once in the app. It draws the current step like a
 * help tip, but ignores the tip settings: it shows with tips off and for tips that were closed. If what the tutorial
 * needs is missing (no PDF, no pieces), it shows that instead, with the way to get it, and goes on by itself once it
 * is there. Done, the × and Escape end it; nothing about it is saved.
 */
export function TutorialHost() {
  const running = useUiStore((s) => s.tutorial);
  const stage = useUiStore((s) => s.stage);
  const setStep = useUiStore((s) => s.setTutorialStep);
  const end = useUiStore((s) => s.endTutorial);
  const hasDocument = useDocumentStore((s) => s.pages.length > 0);
  // From the page groups, not the piece library: the library is only worked out while the Print tab is open.
  const documents = useLayoutDocuments();
  const hasPieces = documents.some(
    (d) =>
      d.groups.some((g) => g.kind === "grid" && hasRegion(g)) || Object.values(d.freeform).some((c) => c.length > 0),
  );
  // Which way the user was going, so a step that is skipped is skipped in that direction.
  const direction = useRef(1);

  const def = running ? tutorialDef(running.id) : null;
  const steps = def?.steps ?? [];
  const index = running ? Math.min(running.step, steps.length - 1) : 0;
  const step = steps[index];
  const unmet = def ? unmetNeed(def.needs, { hasDocument, hasPieces }) : null;
  const last = index === steps.length - 1;
  const go = (to: number) => {
    direction.current = to >= index ? 1 : -1;
    setStep(Math.min(Math.max(to, 0), steps.length - 1));
  };

  // A step for a place the user is already in has nothing to do.
  const skip = !unmet && step?.skipWhen && skipped(step.skipWhen, stage);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of step or tab matters
  useEffect(() => {
    if (!skip) return;
    const next = index + direction.current;
    go(next >= 0 && next < steps.length ? next : index - direction.current);
  }, [skip, index]);

  useAdvanceOn(step?.advanceOn, !!running && !unmet, () => (last ? end() : go(index + 1)));

  if (!running || !def) return null;
  const needs = unmet ? [NEEDS_STEPS[unmet]] : null;
  return (
    <HintStepView
      // A new step is a new card; the needs card is not one of the steps.
      key={needs ? "needs" : index}
      testId={`tutorial-${running.id}`}
      steps={needs ?? steps}
      index={needs ? 0 : index}
      onGo={go}
      onEnd={end}
      dismissLabel="tutorials.close"
      dismissTitle="tutorials.closeTitle"
      className="fixed bottom-10 left-1/2 z-50 w-[22rem] max-w-[90vw] -translate-x-1/2"
      inDialogs
    />
  );
}
