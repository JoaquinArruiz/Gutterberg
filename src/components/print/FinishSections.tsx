import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { cardIdKey } from "../../lib/card";
import {
  BLEED_SOURCES,
  type BleedSource,
  FLIPS,
  type Flip,
  MARK_LENGTH_RANGE,
  MARK_OFFSET_RANGE,
  MARK_STYLES,
  MARK_WIDTH_RANGE,
  MAX_BLEED_MM,
  MAX_DUPLEX_OFFSET_MM,
  type MarkStyle,
  type SheetWarning,
} from "../../lib/finish";
import { useLibraryCards } from "../../lib/use-library-cards";
import { usePrintStore } from "../../stores/print-store";
import { Button } from "../ui/Button";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { InfoTip } from "../ui/InfoTip";
import { MeasurementInput } from "../ui/MeasurementInput";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { CardThumb } from "./CardThumb";

/** The warnings of every sheet, once each: what the plan as a whole needs the user to look at. */
export function useSheetWarnings(): Set<SheetWarning> {
  const sheets = usePrintStore((s) => s.sheets);
  const found = new Set<SheetWarning>();
  for (const sheet of sheets ?? []) for (const w of sheet.warnings ?? []) found.add(w);
  return found;
}

/** The warnings in `codes` that the plan has, worded for the section they belong to. */
export function WarningList({ codes }: { codes: SheetWarning[] }) {
  const { t } = useTranslation();
  const have = useSheetWarnings();
  const shown = codes.filter((c) => have.has(c));
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-1 text-amber-400" data-testid="finish-warnings">
      {shown.map((c) => (
        <li key={c}>⚠ {t(`print.warnings.${c}`)}</li>
      ))}
    </ul>
  );
}

/** Cut marks: lines on the front sheets that show where to cut. */
export function MarksSection() {
  const { t } = useTranslation();
  const marks = usePrintStore((s) => s.finish.marks);
  const setMarks = usePrintStore((s) => s.setMarks);
  const on = marks.style !== "off";
  return (
    <CollapsibleSection
      id="print.marks"
      title={t("print.sections.marks")}
      defaultOpen={false}
      info={t("print.marks.note")}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="text-[var(--muted)]">{t("print.marks.style")}</span>
        <Select<MarkStyle>
          label={t("print.marks.style")}
          value={marks.style}
          onChange={(style) => setMarks({ style })}
          options={MARK_STYLES.map((value) => ({ value, label: t(`print.marks.styles.${value}`) }))}
        />
      </div>
      {on && (
        <>
          <MeasurementInput
            label={t("print.marks.width")}
            precise
            min={MARK_WIDTH_RANGE[0]}
            max={MARK_WIDTH_RANGE[1]}
            value={marks.widthMm}
            onChange={(widthMm) => setMarks({ widthMm })}
          />
          <label className="flex items-center justify-between gap-2">
            <span className="text-[var(--muted)]">{t("print.marks.color")}</span>
            <input
              type="color"
              aria-label={t("print.marks.color")}
              value={marks.color}
              onChange={(e) => setMarks({ color: e.target.value })}
              className="h-6 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent"
            />
          </label>
          {marks.style === "ticks" && (
            <>
              <MeasurementInput
                label={t("print.marks.length")}
                precise
                min={MARK_LENGTH_RANGE[0]}
                max={MARK_LENGTH_RANGE[1]}
                value={marks.lengthMm}
                onChange={(lengthMm) => setMarks({ lengthMm })}
              />
              <MeasurementInput
                label={t("print.marks.offset")}
                precise
                min={MARK_OFFSET_RANGE[0]}
                max={MARK_OFFSET_RANGE[1]}
                value={marks.offsetMm}
                onChange={(offsetMm) => setMarks({ offsetMm })}
              />
            </>
          )}
        </>
      )}
      <WarningList codes={["marks_off_page", "gap_too_narrow_for_line"]} />
    </CollapsibleSection>
  );
}

/** Bleed: extra art past each piece's edge, so a slightly off cut shows no white. */
export function BleedSection() {
  const { t } = useTranslation();
  const bleed = usePrintStore((s) => s.finish.bleed);
  const setBleed = usePrintStore((s) => s.setBleed);
  return (
    <CollapsibleSection
      id="print.bleed"
      title={t("print.sections.bleed")}
      defaultOpen={false}
      info={t("print.bleed.note")}
    >
      <MeasurementInput
        label={t("print.bleed.amount")}
        precise
        min={0}
        max={MAX_BLEED_MM}
        value={bleed.mm}
        onChange={(mm) => setBleed({ mm })}
      />
      {bleed.mm > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="flex items-center gap-1 text-[var(--muted)]">
            {t("print.bleed.source")}
            <InfoTip text={bleed.source === "mirror" ? t("print.bleed.mirrorNote") : t("print.bleed.sourceNote")} />
          </span>
          <Segmented<BleedSource>
            label={t("print.bleed.source")}
            value={bleed.source}
            onChange={(source) => setBleed({ source })}
            options={BLEED_SOURCES.map((value) => ({ value, label: t(`print.bleed.sources.${value}`) }))}
          />
        </div>
      )}
      <WarningList codes={["bleed_overlaps_neighbour", "bleed_off_page", "bleed_exceeds_source_gap"]} />
    </CollapsibleSection>
  );
}

/** Duplex: a back sheet after every front sheet, mirrored so the backs line up when the paper is turned. */
export function DuplexSection() {
  const { t } = useTranslation();
  const duplex = usePrintStore((s) => s.finish.duplex);
  const setDuplex = usePrintStore((s) => s.setDuplex);
  const selected = usePrintStore(useShallow((s) => s.selection.selected));
  const cards = useLibraryCards();
  const common = duplex.commonBack ? cards.find((c) => cardIdKey(c.id) === duplex.commonBack) : undefined;
  return (
    <CollapsibleSection id="print.duplex" title={t("print.sections.duplex")} defaultOpen={false}>
      <Switch
        checked={duplex.on}
        onChange={(on) => setDuplex({ on })}
        label={t("print.duplex.on")}
        info={t("print.duplex.onHint")}
      />
      {duplex.on && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-[var(--muted)]">{t("print.duplex.flip")}</span>
            <Segmented<Flip>
              label={t("print.duplex.flip")}
              value={duplex.flip}
              onChange={(flip) => setDuplex({ flip })}
              options={FLIPS.map((value) => ({ value, label: t(`print.duplex.flips.${value}`) }))}
            />
          </div>
          <MeasurementInput
            label={t("print.duplex.offsetX")}
            info={t("print.duplex.offsetNote")}
            precise
            min={-MAX_DUPLEX_OFFSET_MM}
            max={MAX_DUPLEX_OFFSET_MM}
            value={duplex.offsetXMm}
            onChange={(offsetXMm) => setDuplex({ offsetXMm })}
          />
          <MeasurementInput
            label={t("print.duplex.offsetY")}
            precise
            min={-MAX_DUPLEX_OFFSET_MM}
            max={MAX_DUPLEX_OFFSET_MM}
            value={duplex.offsetYMm}
            onChange={(offsetYMm) => setDuplex({ offsetYMm })}
          />
          <div className="mt-1 flex items-center gap-1 text-[var(--muted)]">
            {t("print.duplex.commonBack")}
            <InfoTip text={t("print.duplex.backNote")} />
          </div>
          <div className="flex items-start gap-2">
            {common ? (
              <div className="shrink-0" data-testid="common-back">
                <CardThumb card={common} width={64} height={92} selected={false} copies={null} onClick={() => {}} />
              </div>
            ) : (
              <span className="text-[var(--muted)]" data-testid="common-back-none">
                {t("print.duplex.none")}
              </span>
            )}
            <div className="flex flex-col items-start gap-1">
              <Button disabled={selected.length !== 1} onClick={() => setDuplex({ commonBack: selected[0] ?? null })}>
                {t("print.duplex.useSelected")}
              </Button>
              <Button disabled={duplex.commonBack === null} onClick={() => setDuplex({ commonBack: null })}>
                {t("print.duplex.remove")}
              </Button>
            </div>
          </div>
          <WarningList codes={["back_size_differs"]} />
        </>
      )}
    </CollapsibleSection>
  );
}
