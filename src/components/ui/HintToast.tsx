import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HINTS, type HintDef, type HintId } from "../../lib/hints";
import { useHint } from "../../stores/hint-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useToastStore } from "../../stores/toast-store";
import { useUiStore } from "../../stores/ui-store";
import { HintStepView, useAdvanceOn } from "./HintCard";

/**
 * A dismissible help tip from the catalog (`src/lib/hints.ts`). The caller decides when and where it
 * shows; the catalog decides what it says. A hint with several steps gets Back / Next. A step with a
 * `target` is shown next to that element with a spotlight (React Joyride); if the element is not on
 * screen it falls back to a toast at the caller's position. Closing it is remembered (saved in
 * preferences) and "Show closed tips again" in Preferences brings every tip back; "Show help tips" there
 * (or "Don't show tips" on a tip) turns them all off. Renders nothing once dismissed, with tips off or
 * while another hint is showing, so callers can mount it unconditionally wherever the
 * tip applies.
 */
export function HintToast({ hint, className = "" }: { hint: HintId; className?: string }) {
  const { t } = useTranslation();
  const { visible, dismiss, register } = useHint(hint);
  const setTipsOn = usePreferencesStore((s) => s.setTipsOn);
  const showToast = useToastStore((s) => s.show);
  const setPrefsOpen = useUiStore((s) => s.setPrefsOpen);
  // The tip disappears with the switch, so a toast says where to turn tips on again.
  const turnOff = () => {
    setTipsOn(false);
    showToast({
      title: t("hintUi.offTitle"),
      text: t("hintUi.offText"),
      actions: [{ label: t("hintUi.offOpen"), onClick: () => setPrefsOpen(true, "Help", "helpTips") }],
      autoCloseMs: 12000,
    });
  };
  const [index, setIndex] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: register is a fresh closure each render; only the id matters
  useEffect(register, [hint]);

  const { steps } = HINTS[hint] as HintDef;
  const step = steps[index];
  const last = index === steps.length - 1;
  const go = (to: number) => setIndex(Math.min(Math.max(to, 0), steps.length - 1));
  useAdvanceOn(step.advanceOn, visible, () => (last ? dismiss() : go(index + 1)));

  if (!visible) return null;
  return (
    <HintStepView
      testId={`hint-${hint}`}
      steps={steps}
      index={index}
      onGo={go}
      onEnd={dismiss}
      onTurnOff={turnOff}
      className={className}
    />
  );
}
