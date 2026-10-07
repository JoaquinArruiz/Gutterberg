import { useTranslation } from "react-i18next";
import { formatError } from "../../lib/errors";
import { formatMeasurement } from "../../lib/measurement";
import { usePreviewResult } from "../../lib/view-page";
import { useCurrentGridGroup, useCurrentGroup, useLayoutStore } from "../../stores/layout-store";
import { useUnit } from "../../stores/preferences-store";
import { HintToast } from "../ui/HintToast";

/** Why the output view may be empty or wrong: no selection, invalid grid, no manual preview yet, overflow. */
export function OutputNotice() {
  const { t } = useTranslation();
  const selection = useCurrentGridGroup()?.selection ?? null;
  const skipped = useCurrentGroup()?.kind === "skip";
  const layoutError = useLayoutStore((s) => s.layoutError);
  const live = useLayoutStore((s) => s.live);
  const result = useLayoutStore((s) => s.result);
  const snapshot = useLayoutStore((s) => s.snapshot);
  const shown = usePreviewResult();
  const unit = useUnit();
  // Manual mode: the settings changed since the preview was generated.
  const stale = !live && !!snapshot && !!result && snapshot !== result;
  const msg = skipped
    ? t("viewport.pageSkipped")
    : layoutError
      ? formatError(layoutError)
      : !selection && !shown
        ? t("preview.selectRegion")
        : shown?.overflow
          ? t("preview.overflow", {
              width: formatMeasurement(shown.overflow.width_mm, unit),
              height: formatMeasurement(shown.overflow.height_mm, unit),
            })
          : null;
  const bad = !!layoutError || !!shown?.overflow;
  const showManualHint = !live && !shown && !!selection && !layoutError;
  return (
    <>
      {showManualHint && (
        <HintToast
          hint="live-preview-output"
          className="absolute left-1/2 top-3 z-30 w-[22rem] max-w-[90%] -translate-x-1/2"
        />
      )}
      {stale && (
        <span className="pointer-events-none absolute right-2 top-2 z-10 rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
          {t("preview.outOfDate")}
        </span>
      )}
      {msg && (
        <p
          className={`pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-fit max-w-[80%] rounded bg-black/75 px-3 py-1.5 text-center ${bad ? "text-red-300" : "text-[var(--muted)]"}`}
        >
          {bad ? "⚠ " : ""}
          {msg}
        </p>
      )}
    </>
  );
}
