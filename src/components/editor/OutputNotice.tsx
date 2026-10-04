import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreviewResult } from "../../lib/view-page";

/** Why the output view may be empty or wrong: no selection, invalid grid, no manual preview yet, overflow. */
export function OutputNotice() {
  const selection = useEditorStore((s) => s.selection);
  const { layoutError, live } = useLayoutStore();
  const shown = usePreviewResult();
  const msg = layoutError
    ? layoutError
    : !selection && !shown
      ? "Select the card region on the page to preview the output."
      : !shown && !live
        ? "Live preview is off. Press “Update preview” in the Preview panel."
        : shown?.overflow
          ? `Layout exceeds the page by ${shown.overflow.width_mm.toFixed(1)} mm horizontally and ${shown.overflow.height_mm.toFixed(1)} mm vertically. Cards are never scaled: change the page size or orientation, or reduce spacing or margins.`
          : null;
  if (!msg) return null;
  const bad = !!layoutError || !!shown?.overflow;
  return (
    <p
      className={`pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-fit max-w-[80%] rounded bg-black/75 px-3 py-1.5 text-center ${bad ? "text-red-300" : "text-[var(--muted)]"}`}
    >
      {bad ? "⚠ " : ""}{msg}
    </p>
  );
}
