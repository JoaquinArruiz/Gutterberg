import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { MAX_MARGIN_MM, type PageMode, useLayoutStore } from "../../stores/layout-store";
import { GapFields } from "../ui/GapFields";
import { MeasurementInput } from "../ui/MeasurementInput";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";

const PAGE_MODES: PageMode[] = ["same", "a4", "letter", "legal", "custom", "fit"];

/** The gap between pieces on the sheet. Independent of the gap the PDF already has. */
export function OutputSpacingFields() {
  const L = useLayoutStore(
    useShallow((s) => ({
      gapXMm: s.gapXMm,
      gapYMm: s.gapYMm,
      gapLinked: s.gapLinked,
      setGapX: s.setGapX,
      setGapY: s.setGapY,
      setGapLinked: s.setGapLinked,
    })),
  );
  return (
    <GapFields linked={L.gapLinked} onLink={L.setGapLinked} x={L.gapXMm} y={L.gapYMm} onX={L.setGapX} onY={L.setGapY} />
  );
}

/** Page size, orientation and margins of the output sheet. */
export function OutputPageFields() {
  const { t } = useTranslation();
  const L = useLayoutStore(
    useShallow((s) => ({
      pageMode: s.pageMode,
      orientation: s.orientation,
      customWidthMm: s.customWidthMm,
      customHeightMm: s.customHeightMm,
      margins: s.margins,
      setPageMode: s.setPageMode,
      setOrientation: s.setOrientation,
      setCustomSize: s.setCustomSize,
      setMargin: s.setMargin,
    })),
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="text-[var(--muted)]">{t("print.page.sizeLabel")}</span>
        <Select
          label={t("print.page.sizeAria")}
          value={L.pageMode}
          onChange={L.setPageMode}
          options={PAGE_MODES.map((m) => ({ value: m, label: t(`print.page.modes.${m}`) }))}
        />
      </div>
      {L.pageMode === "custom" && (
        <>
          <MeasurementInput
            label={t("common.width")}
            min={10}
            value={L.customWidthMm}
            onChange={(w) => L.setCustomSize(w, undefined)}
          />
          <MeasurementInput
            label={t("common.height")}
            min={10}
            value={L.customHeightMm}
            onChange={(h) => L.setCustomSize(undefined, h)}
          />
        </>
      )}
      {L.pageMode !== "same" && L.pageMode !== "fit" && (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-[var(--muted)]">{t("print.page.orientation")}</span>
          <Segmented
            label={t("print.page.orientation")}
            value={L.orientation}
            onChange={L.setOrientation}
            options={[
              { value: "portrait", label: t("print.page.portrait") },
              { value: "landscape", label: t("print.page.landscape") },
            ]}
          />
        </div>
      )}
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <MeasurementInput
          key={side}
          label={t(`print.page.margin.${side}`)}
          min={0}
          max={MAX_MARGIN_MM}
          value={L.margins[side]}
          onChange={(v) => L.setMargin(side, v)}
        />
      ))}
    </>
  );
}
