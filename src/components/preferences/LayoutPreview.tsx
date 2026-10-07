import { useTranslation } from "react-i18next";
import { type PanelConfig, type RegionPosition, regionsOf } from "../../lib/workspace-layout";

const BLOCK =
  "flex items-center justify-center overflow-hidden rounded-sm border border-[var(--accent)]/60 bg-[var(--accent)]/20 text-[8px] font-semibold uppercase tracking-wide";

/** Tiny schematic of the panel arrangement (no real content), driven by the same config as the editor. */
export function LayoutPreview({ panels }: { panels: PanelConfig[] }) {
  const { t } = useTranslation();
  const regions = regionsOf(panels);
  const stack = (pos: RegionPosition, style: React.CSSProperties) =>
    regions[pos].length === 0 ? null : (
      <div data-testid={`layout-preview-${pos}`} className="flex gap-0.5" style={{ flexDirection: "column", ...style }}>
        {regions[pos].map((p) => (
          <div key={p.id} className={`${BLOCK} flex-1`}>
            {t(`panels.titles.${p.id}`).slice(0, 4)}
          </div>
        ))}
      </div>
    );
  return (
    <div
      role="img"
      aria-label={t("preferences.layoutPreview.label")}
      className="flex h-28 w-48 flex-col gap-0.5 rounded border border-[var(--border)] bg-[var(--bg)] p-1"
    >
      {stack("top", { height: 22 })}
      <div className="flex min-h-0 flex-1 gap-0.5">
        {stack("left", { width: 44 })}
        <div className="flex flex-1 items-center justify-center rounded-sm border border-[var(--border)] bg-[var(--canvas)] text-[8px] font-semibold uppercase text-[var(--muted)]">
          {t("preferences.layoutPreview.editor")}
        </div>
        {stack("right", { width: 44 })}
      </div>
      {stack("bottom", { height: 22 })}
    </div>
  );
}
