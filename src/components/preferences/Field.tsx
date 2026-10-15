import { useEffect, useRef } from "react";
import { type PrefsTarget, useUiStore } from "../../stores/ui-store";
import { InfoTip } from "../ui/InfoTip";

/**
 * A titled group of settings in the Preferences window. `info` puts the longer explanation behind an InfoTip after
 * the title. `target` names it for links (a help tip's "Open Preferences"): when a link points at it, it scrolls
 * into view and pulses twice.
 */
export function Field({
  label,
  info,
  target,
  children,
}: {
  label: string;
  info?: React.ReactNode;
  target?: PrefsTarget;
  children: React.ReactNode;
}) {
  const pulse = useUiStore((s) => target !== undefined && s.prefsPulse === target);
  const clearPulse = useUiStore((s) => s.clearPrefsPulse);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pulse) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [pulse]);
  return (
    <div
      ref={ref}
      data-pulse={pulse || undefined}
      onAnimationEnd={() => pulse && clearPulse()}
      className={`mb-5 rounded-sm ${pulse ? "prefs-pulse" : ""}`}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        {label}
        {info && <InfoTip text={info} />}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}
