import { RefreshCw } from "lucide-react";
import { useLayoutStore } from "../../stores/layout-store";

/**
 * Manual preview refresh. Only shown when Live Preview is off. `className`
 * positions a wrapper (the button itself is `relative` for its badge, so it must
 * not be the element that is absolutely positioned). The icon and dot turn
 * accent-coloured when the settings changed since the preview was generated.
 */
export function RefreshPreviewButton({ className = "" }: { className?: string }) {
  const live = useLayoutStore((s) => s.live);
  const result = useLayoutStore((s) => s.result);
  const snapshot = useLayoutStore((s) => s.snapshot);
  const updatePreview = useLayoutStore((s) => s.updatePreview);
  if (live) return null;
  const stale = !!result && snapshot !== result;
  return (
    <div className={className}>
      <button
        type="button"
        aria-label="Refresh preview"
        title={stale ? "Refresh preview (out of date)" : "Refresh preview"}
        disabled={!result}
        onClick={updatePreview}
        className="relative flex h-8 w-8 items-center justify-center rounded border border-[var(--border)] bg-[var(--panel)] text-[var(--fg)] shadow-md shadow-black/30 hover:bg-[var(--hover)] disabled:opacity-40"
      >
        <RefreshCw size={15} className={stale ? "text-[var(--accent)]" : ""} />
        {stale && (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--panel)] bg-[var(--accent)]" />
        )}
      </button>
    </div>
  );
}
