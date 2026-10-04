import { RefreshCw } from "lucide-react";
import { useLayoutStore } from "../../stores/layout-store";

/**
 * Manual preview refresh. Only shown when Live Preview is off; a dot marks that
 * the settings changed since the preview was last generated.
 */
export function RefreshPreviewButton({ className = "" }: { className?: string }) {
  const live = useLayoutStore((s) => s.live);
  const result = useLayoutStore((s) => s.result);
  const snapshot = useLayoutStore((s) => s.snapshot);
  const updatePreview = useLayoutStore((s) => s.updatePreview);
  if (live) return null;
  const stale = !!result && snapshot !== result;
  return (
    <button
      type="button"
      aria-label="Refresh preview"
      title={stale ? "Refresh preview (out of date)" : "Refresh preview"}
      disabled={!result}
      onClick={updatePreview}
      className={`relative flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-black shadow-lg shadow-black/40 hover:brightness-110 active:scale-95 disabled:opacity-40 ${className}`}
    >
      <RefreshCw size={18} />
      {stale && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[var(--panel)] bg-amber-400" />}
    </button>
  );
}
