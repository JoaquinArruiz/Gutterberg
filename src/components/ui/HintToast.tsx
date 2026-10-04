import { Info, X } from "lucide-react";
import type { HintId } from "../../lib/hints";
import { useHint } from "../../stores/preferences-store";

/**
 * A dismissible help tip. Closing it is remembered (saved in preferences), and
 * "Reset help tips" in Preferences brings every tip back. Renders nothing once
 * dismissed, so callers can mount it unconditionally wherever the tip applies.
 */
export function HintToast({
  id, children, action, className = "",
}: {
  id: HintId;
  children: React.ReactNode;
  /** Optional button after the text, e.g. a shortcut to the relevant setting. */
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  const { visible, dismiss } = useHint(id);
  if (!visible) return null;
  return (
    <div
      role="status"
      data-testid={`hint-${id}`}
      className={`flex max-w-sm items-start gap-2.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 shadow-xl shadow-black/40 ${className}`}
    >
      <Info size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" />
      <div className="min-w-0 flex-1">
        <p>{children}</p>
        {action && (
          <button onClick={action.onClick} className="mt-1.5 text-[var(--accent)] hover:underline">
            {action.label}
          </button>
        )}
      </div>
      <button
        aria-label="Dismiss tip"
        title="Dismiss (won't show again)"
        onClick={dismiss}
        className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
      >
        <X size={13} />
      </button>
    </div>
  );
}
