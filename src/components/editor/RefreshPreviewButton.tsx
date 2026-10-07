import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  return (
    <RefreshButton
      className={className}
      stale={!!result && snapshot !== result}
      disabled={!result}
      onClick={updatePreview}
    />
  );
}

/** The refresh button itself, for any preview that can be frozen. `stale`: what is shown is out of date. */
export function RefreshButton({
  className = "",
  stale,
  disabled,
  onClick,
}: {
  className?: string;
  stale: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={className}>
      <button
        type="button"
        aria-label={t("preview.refresh")}
        title={stale ? t("preview.refreshStale") : t("preview.refresh")}
        disabled={disabled}
        onClick={onClick}
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
