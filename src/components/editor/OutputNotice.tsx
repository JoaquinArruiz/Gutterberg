import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { formatMeasurement } from "../../lib/measurement";
import { useUnit } from "../../stores/preferences-store";
import { usePreviewResult } from "../../lib/view-page";

/** Why the output view may be empty or wrong: no selection, invalid grid, no manual preview yet, overflow. */
export function OutputNotice() {
  const selection = useEditorStore((s) => s.selection);
  const { layoutError, live, result, snapshot } = useLayoutStore();
  const shown = usePreviewResult();
  const unit = useUnit();
  // Manual mode: the settings changed since the preview was generated.
  const stale = !live && !!snapshot && !!result && snapshot !== result;
  const msg = layoutError
    ? layoutError
    : !selection && !shown
      ? "Select the card region on the page to preview the output."
      : !shown && !live
        ? "Live preview is off. Press “Update preview” in the Preview panel."
        : shown?.overflow
          ? `Layout exceeds the page by ${formatMeasurement(shown.overflow.width_mm, unit)} horizontally and ${formatMeasurement(shown.overflow.height_mm, unit)} vertically. Cards are never scaled: change the page size or orientation, or reduce spacing or margins.`
          : null;
  const bad = !!layoutError || !!shown?.overflow;
  return (
    <>
      {stale && (
        <span className="pointer-events-none absolute right-2 top-2 z-10 rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
          Preview out of date
        </span>
      )}
      {msg && <p
      className={`pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-fit max-w-[80%] rounded bg-black/75 px-3 py-1.5 text-center ${bad ? "text-red-300" : "text-[var(--muted)]"}`}
    >
      {bad ? "⚠ " : ""}{msg}
    </p>}
    </>
  );
}
