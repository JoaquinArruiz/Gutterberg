import { ChevronLeft, ChevronRight, Info, X } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Joyride, type Options } from "react-joyride";
import { runHintAction } from "../../lib/hint-actions";
import { onHintEvent } from "../../lib/hint-events";
import { HINTS, type HintDef, type HintId, type HintStep, type HintTargetId } from "../../lib/hints";
import { useHint } from "../../stores/hint-store";

const iconBtn = "shrink-0 rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]";

type CardProps = {
  hint: HintId;
  step: HintStep;
  index: number;
  total: number;
  onGo: (to: number) => void;
  onDismiss: () => void;
  className?: string;
  onKeyDown?: React.KeyboardEventHandler;
};

/** The tip itself: the same look whether it floats where the caller put it or sits next to its target. */
function HintCard({ hint, step, index, total, onGo, onDismiss, className = "", onKeyDown }: CardProps) {
  const last = index === total - 1;
  const stepped = total > 1;
  return (
    <div
      role="status"
      tabIndex={-1}
      data-testid={`hint-${hint}`}
      onKeyDown={onKeyDown}
      className={`flex max-w-sm items-start gap-2.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 text-[var(--fg)] shadow-xl shadow-black/40 outline-none ${className}`}
    >
      <Info size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" />
      <div className="min-w-0 flex-1">
        {step.title && <p className="font-semibold">{step.title}</p>}
        <p>{step.text}</p>
        {step.action && (
          <button
            type="button"
            onClick={() => step.action && runHintAction(step.action.run)}
            className="mt-1.5 text-[var(--accent)] hover:underline"
          >
            {step.action.label}
          </button>
        )}
        {stepped && (
          <div className="mt-2 flex items-center gap-1.5 text-[var(--muted)]">
            <button
              type="button"
              aria-label="Previous tip"
              disabled={index === 0}
              onClick={() => onGo(index - 1)}
              className={`${iconBtn} disabled:opacity-40`}
            >
              <ChevronLeft size={13} />
            </button>
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
                Skip
              </button>
            )}
            {last ? (
              <button type="button" onClick={onDismiss} className="ml-auto text-[var(--accent)] hover:underline">
                Done
              </button>
            ) : (
              <button type="button" aria-label="Next tip" onClick={() => onGo(index + 1)} className={iconBtn}>
                <ChevronRight size={13} />
              </button>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss tip"
        title="Dismiss (won't show again)"
        onClick={onDismiss}
        className={`${iconBtn} -mr-1 -mt-0.5`}
      >
        <X size={13} />
      </button>
    </div>
  );
}

// Joyride renders this in its own floating layer; the state lives in HintToast, handed over by context.
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

/**
 * A dismissible help tip from the catalog (`src/lib/hints.ts`). The caller decides when and where it
 * shows; the catalog decides what it says. A hint with several steps gets Back / Next. A step with a
 * `target` is shown next to that element with a spotlight (React Joyride); if the element is not on
 * screen it falls back to a toast at the caller's position. Closing it is remembered (saved in
 * preferences) and "Reset help tips" in Preferences brings every tip back. Renders nothing once
 * dismissed or while another hint is showing, so callers can mount it unconditionally wherever the
 * tip applies.
 */
export function HintToast({ hint, className = "" }: { hint: HintId; className?: string }) {
  const { visible, dismiss, register } = useHint(hint);
  const [index, setIndex] = useState(0);
  const [anchor, setAnchor] = useState<Found | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: register is a fresh closure each render; only the id matters
  useEffect(register, [hint]);

  const { steps } = HINTS[hint] as HintDef;
  const step = steps[index];
  const last = index === steps.length - 1;
  const go = (to: number) => setIndex(Math.min(Math.max(to, 0), steps.length - 1));

  // A step with `advanceOn` moves on when that app event fires, however the user caused it.
  const advance = useRef(() => {});
  advance.current = () => (last ? dismiss() : go(index + 1));
  const advanceOn = visible ? step.advanceOn : undefined;
  useEffect(() => (advanceOn ? onHintEvent(advanceOn, () => advance.current()) : undefined), [advanceOn]);

  // Track whether the step's target is on screen (a panel may open or close while the tip is up).
  useEffect(() => {
    if (!visible || !step.target) return setAnchor(null);
    const update = () =>
      setAnchor((prev) => {
        const next = findTarget(step);
        return next?.spot === prev?.spot && next?.tip === prev?.tip ? prev : next;
      });
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
    });
    return () => observer.disconnect();
  }, [visible, step]);

  // Next to a target there is no focused toast to receive Escape, so listen on the window.
  const anchored = visible && anchor !== null;
  useEffect(() => {
    if (!anchored) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anchored, dismiss]);

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

  if (!visible) return null;
  const card: CardProps = { hint, step, index, total: steps.length, onGo: go, onDismiss: dismiss };

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
  return (
    <HintCard
      {...card}
      className={className}
      onKeyDown={(e) => {
        // Arrow keys also page through the document, so a handled one must not reach the window.
        const arrow = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (e.key === "Escape") dismiss();
        else if (arrow && steps.length > 1) {
          e.stopPropagation();
          go(index + arrow);
        }
      }}
    />
  );
}
