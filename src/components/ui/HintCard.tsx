import { ChevronLeft, ChevronRight, Info, X } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Joyride, type Options } from "react-joyride";
import { runHintAction } from "../../lib/hint-actions";
import { onHintEvent } from "../../lib/hint-events";
import type { HintEventId, HintStep, HintTargetId, TextKey } from "../../lib/hints";
import { Button } from "./Button";

type CardProps = {
  /** The card's `data-testid`. */
  testId: string;
  step: HintStep;
  index: number;
  total: number;
  onGo: (to: number) => void;
  /** Done, the ×, or Escape. */
  onDismiss: () => void;
  /** "Don't show tips": turns every help tip off. Only a tip has it. */
  onTurnOff?: () => void;
  /** The tooltip and accessible name of the ×. */
  dismissLabel?: TextKey;
  dismissTitle?: TextKey;
  className?: string;
  onKeyDown?: React.KeyboardEventHandler;
};

/** The card itself: the same look for a help tip and a tutorial step, whether it floats where the caller put it or sits next to its target. */
function HintCard({
  testId,
  step,
  index,
  total,
  onGo,
  onDismiss,
  onTurnOff,
  dismissLabel = "hintUi.dismiss",
  dismissTitle = "hintUi.dismissTitle",
  className = "",
  onKeyDown,
}: CardProps) {
  const { t } = useTranslation();
  const last = index === total - 1;
  const stepped = total > 1;
  return (
    <div
      role="status"
      tabIndex={-1}
      data-testid={testId}
      onKeyDown={onKeyDown}
      className={`flex max-w-sm items-start gap-2.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 text-[var(--fg)] shadow-xl shadow-black/40 outline-none ${className}`}
    >
      <Info size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" />
      <div className="min-w-0 flex-1">
        {step.title && <p className="font-semibold">{t(step.title)}</p>}
        <p>{t(step.text)}</p>
        {step.action && (
          <button
            type="button"
            onClick={() => step.action && runHintAction(step.action.run)}
            className="mt-1.5 text-[var(--accent)] hover:underline"
          >
            {t(step.action.label)}
          </button>
        )}
        {stepped && (
          <div className="mt-2 flex items-center gap-1.5 text-[var(--muted)]">
            <Button
              variant="ghost"
              className="shrink-0"
              aria-label={t("hintUi.previous")}
              disabled={index === 0}
              onClick={() => onGo(index - 1)}
            >
              <ChevronLeft size={13} />
            </Button>
            <span>
              {index + 1} / {total}
            </span>
            <span aria-hidden className="flex gap-1">
              {Array.from({ length: total }, (_, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: the dots are positional and never reorder
                  key={i}
                  className={`size-1.5 rounded-full ${i === index ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`}
                />
              ))}
            </span>
            {!last && (
              <button type="button" onClick={onDismiss} className="ml-auto hover:text-[var(--fg)] hover:underline">
                {t("hintUi.skip")}
              </button>
            )}
            {last ? (
              <button type="button" onClick={onDismiss} className="ml-auto text-[var(--accent)] hover:underline">
                {t("hintUi.done")}
              </button>
            ) : (
              <Button
                variant="ghost"
                className="shrink-0"
                aria-label={t("hintUi.next")}
                onClick={() => onGo(index + 1)}
              >
                <ChevronRight size={13} />
              </Button>
            )}
          </div>
        )}
        {onTurnOff && (
          <button
            type="button"
            onClick={onTurnOff}
            className="mt-2 block text-[11px] text-[var(--muted)] hover:text-[var(--fg)] hover:underline"
          >
            {t("hintUi.turnOff")}
          </button>
        )}
      </div>
      <Button
        variant="ghost"
        className="-mr-1 -mt-0.5 shrink-0"
        aria-label={t(dismissLabel)}
        title={t(dismissTitle)}
        onClick={onDismiss}
      >
        <X size={13} />
      </Button>
    </div>
  );
}

// Joyride renders this in its own floating layer; the state lives in HintStepView, handed over by context.
const AnchoredCard = createContext<CardProps | null>(null);
function AnchoredTooltip() {
  const props = useContext(AnchoredCard);
  return props ? <HintCard {...props} className="w-[22rem] max-w-[90vw]" /> : null;
}

const onScreen = (id: HintTargetId): HTMLElement | null => {
  const el = document.querySelector<HTMLElement>(`[data-hint-target="${id}"]`);
  return el?.isConnected && el.getClientRects().length > 0 ? el : null;
};

type Found = { spot: HTMLElement; tip: HTMLElement };

/** The elements a step points at (the spotlight, and what the tip sits next to), if both are on screen. */
function findTarget(step: HintStep): Found | null {
  if (!step.target) return null;
  const spot = onScreen(step.target);
  const tip = step.tipAt ? onScreen(step.tipAt) : spot;
  return spot && tip ? { spot, tip } : null;
}

/** The modal dialog that is open, if any: it covers the page, so a step cannot point at anything behind it. */
const openDialog = (): HTMLDialogElement | null => document.querySelector<HTMLDialogElement>("dialog[open]");

// The overlay and tooltip follow the app's theme variables, so light and dark both work.
const TOUR_OPTIONS: Partial<Options> = {
  overlayColor: "rgba(0, 0, 0, 0.4)",
  backgroundColor: "var(--panel)",
  textColor: "var(--fg)",
  primaryColor: "var(--accent)",
  zIndex: 60,
  skipBeacon: true,
  buttons: [],
  overlayClickAction: false,
  dismissKeyAction: false,
  disableFocusTrap: true,
  spotlightPadding: 4,
  spotlightRadius: 6,
};

/** A step with `advanceOn` moves on when that app event fires, however the user caused it. */
export function useAdvanceOn(event: HintEventId | undefined, active: boolean, advance: () => void) {
  const latest = useRef(advance);
  latest.current = advance;
  const on = active ? event : undefined;
  useEffect(() => (on ? onHintEvent(on, () => latest.current()) : undefined), [on]);
}

/**
 * One step of a tip or a tutorial, drawn the same way for both. A step with a `target` is shown next to that element
 * with a spotlight (React Joyride); if the element is not on screen it falls back to a card at the caller's position
 * (`className`). With `inDialogs` (tutorials), a dialog that is open takes the card into itself, since it would
 * otherwise sit behind it, and Escape ends the tutorial from anywhere on the page. Mount it only while the step is
 * shown.
 */
export function HintStepView({
  testId,
  steps,
  index,
  onGo,
  onEnd,
  onTurnOff,
  dismissLabel,
  dismissTitle,
  className = "",
  inDialogs = false,
}: {
  testId: string;
  steps: readonly HintStep[];
  index: number;
  onGo: (to: number) => void;
  onEnd: () => void;
  onTurnOff?: () => void;
  dismissLabel?: TextKey;
  dismissTitle?: TextKey;
  className?: string;
  inDialogs?: boolean;
}) {
  const step = steps[index];
  const [anchor, setAnchor] = useState<Found | null>(null);
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);

  // Track whether the step's target is on screen (a panel may open or close while the card is up).
  useEffect(() => {
    const update = () => {
      const modal = inDialogs ? openDialog() : null;
      setDialog((prev) => (prev === modal ? prev : modal));
      setAnchor((prev) => {
        const next = modal || !step.target ? null : findTarget(step);
        return next?.spot === prev?.spot && next?.tip === prev?.tip ? prev : next;
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "open"],
    });
    return () => observer.disconnect();
  }, [step, inDialogs]);

  // Next to a target there is no focused card to receive Escape, so listen on the window.
  const anchored = anchor !== null;
  useEffect(() => {
    if (!anchored && !inDialogs) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A dialog that is open closes with Escape on its own; the tutorial goes on.
      if (inDialogs && openDialog()) return;
      onEnd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anchored, inDialogs, onEnd]);

  const joyrideSteps = useMemo(
    () => [
      {
        target: anchor?.tip as HTMLElement,
        spotlightTarget: anchor?.spot,
        content: "",
        placement: step.placement ?? "bottom",
      },
    ],
    [anchor, step.placement],
  );

  const card: CardProps = {
    testId,
    step,
    index,
    total: steps.length,
    onGo,
    onDismiss: onEnd,
    onTurnOff,
    dismissLabel,
    dismissTitle,
  };

  if (anchor) {
    return (
      <AnchoredCard.Provider value={card}>
        <Joyride
          key={index}
          run
          continuous
          steps={joyrideSteps}
          options={TOUR_OPTIONS}
          floatingOptions={{ hideArrow: true }}
          tooltipComponent={AnchoredTooltip}
        />
      </AnchoredCard.Provider>
    );
  }
  const plain = (
    <HintCard
      {...card}
      className={dialog ? "fixed bottom-4 left-1/2 z-50 w-[22rem] max-w-[90vw] -translate-x-1/2" : className}
      onKeyDown={(e) => {
        // Arrow keys also page through the document, so a handled one must not reach the window.
        const arrow = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (e.key === "Escape") {
          // In a dialog, Escape would close it as well; here it only ends the tutorial.
          if (dialog) e.preventDefault();
          onEnd();
        } else if (arrow && steps.length > 1) {
          e.stopPropagation();
          onGo(index + arrow);
        }
      }}
    />
  );
  return dialog ? createPortal(plain, dialog) : plain;
}
