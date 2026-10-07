import { useShallow } from "zustand/react/shallow";
import { MAX_MARGIN_MM, type PageMode, useLayoutStore } from "../../stores/layout-store";
import { GapFields } from "../ui/GapFields";
import { MeasurementInput } from "../ui/MeasurementInput";
import { Select } from "../ui/Select";

const PAGE_MODES: { id: PageMode; label: string }[] = [
  { id: "same", label: "Same as source" },
  { id: "a4", label: "A4" },
  { id: "letter", label: "Letter" },
  { id: "legal", label: "Legal" },
  { id: "custom", label: "Custom" },
  { id: "fit", label: "Auto-fit to cards" },
];

/** The gap between cards on the sheet. Independent of the gap the PDF already has. */
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
    <>
      <GapFields
        linked={L.gapLinked}
        onLink={L.setGapLinked}
        x={L.gapXMm}
        y={L.gapYMm}
        onX={L.setGapX}
        onY={L.setGapY}
      />
      <p className="text-[var(--muted)]">Final gap between cards. Independent of the source gap.</p>
    </>
  );
}

/** Page size, orientation and margins of the output sheet. */
export function OutputPageFields() {
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-[var(--muted)]">Size</span>
        <Select
          label="Page size"
          value={L.pageMode}
          onChange={L.setPageMode}
          options={PAGE_MODES.map((m) => ({ value: m.id, label: m.label }))}
        />
      </div>
      {L.pageMode === "custom" && (
        <>
          <MeasurementInput
            label="Width"
            min={10}
            value={L.customWidthMm}
            onChange={(w) => L.setCustomSize(w, undefined)}
          />
          <MeasurementInput
            label="Height"
            min={10}
            value={L.customHeightMm}
            onChange={(h) => L.setCustomSize(undefined, h)}
          />
        </>
      )}
      {L.pageMode !== "same" && L.pageMode !== "fit" && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--muted)]">Orientation</span>
          <Select
            label="Orientation"
            value={L.orientation}
            onChange={L.setOrientation}
            options={[
              { value: "portrait", label: "Portrait" },
              { value: "landscape", label: "Landscape" },
            ]}
          />
        </div>
      )}
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <MeasurementInput
          key={side}
          label={`Margin ${side}`}
          min={0}
          max={MAX_MARGIN_MM}
          value={L.margins[side]}
          onChange={(v) => L.setMargin(side, v)}
        />
      ))}
    </>
  );
}
