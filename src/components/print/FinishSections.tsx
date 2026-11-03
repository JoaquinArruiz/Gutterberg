import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { cardIdKey } from "../../lib/card";
import {
  BACK_LAYOUTS,
  type BackLayout,
  BLEED_SOURCES,
  type BleedSource,
  FLIPS,
  type Flip,
  FOLDS,
  type Fold,
  MARK_LENGTH_RANGE,
  MARK_LINES,
  MARK_OFFSET_RANGE,
  MARK_STYLES,
  MARK_WIDTH_RANGE,
  MAX_BLEED_MM,
  MAX_DUPLEX_OFFSET_MM,
  MAX_FOLD_GAP_MM,
  type MarkLine,
  type MarkStyle,
  type SheetWarning,
} from "../../lib/finish";
import { useLibraryCards } from "../../lib/use-library-cards";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { Button } from "../ui/Button";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { FieldRow } from "../ui/FieldRow";
import { InfoTip } from "../ui/InfoTip";
import { MeasurementInput } from "../ui/MeasurementInput";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { CalibrationDialog } from "./CalibrationDialog";
import { CardThumb } from "./CardThumb";
import { FillWithAiDialog } from "./FillWithAiDialog";
import { PairBacksDialog } from "./PairBacksDialog";

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

/** Cut marks: lines on the front sheets (and, if asked, the back sheets) that show where to cut. */
export function MarksSection() {
  const { t } = useTranslation();
  const marks = usePrintStore((s) => s.finish.marks);
  const setMarks = usePrintStore((s) => s.setMarks);
  const backSheets = usePrintStore((s) => s.finish.duplex.on && s.finish.duplex.layout === "duplex");
  const on = marks.style !== "off";
  return (
    <CollapsibleSection
      id="print.marks"
      title={t("print.sections.marks")}
      hintTarget="marks-section"
      defaultOpen={false}
      info={t("print.marks.note")}
    >
      <FieldRow label={t("print.marks.style")}>
        <Select<MarkStyle>
          fill
          label={t("print.marks.style")}
          value={marks.style}
          onChange={(style) => setMarks({ style })}
          options={MARK_STYLES.map((value) => ({ value, label: t(`print.marks.styles.${value}`) }))}
        />
      </FieldRow>
      {on && (
        <>
          <div data-hint-target="mark-line">
            <FieldRow label={t("print.marks.line")}>
              <Segmented<MarkLine>
                fill
                label={t("print.marks.line")}
                value={marks.line}
                onChange={(line) => setMarks({ line })}
                options={MARK_LINES.map((value) => ({ value, label: t(`print.marks.lines.${value}`) }))}
              />
            </FieldRow>
          </div>
          <MeasurementInput
            label={t("print.marks.width")}
            precise
            min={MARK_WIDTH_RANGE[0]}
            max={MARK_WIDTH_RANGE[1]}
            value={marks.widthMm}
            onChange={(widthMm) => setMarks({ widthMm })}
          />
          <FieldRow label={t("print.marks.color")}>
            <input
              type="color"
              aria-label={t("print.marks.color")}
              value={marks.color}
              onChange={(e) => setMarks({ color: e.target.value })}
              className="h-6 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent"
            />
          </FieldRow>
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
              <Switch
                checked={marks.innerCrosses}
                onChange={(innerCrosses) => setMarks({ innerCrosses })}
                label={t("print.marks.innerCrosses")}
                info={t("print.marks.innerCrossesHint")}
              />
              <Switch
                checked={marks.gapTicks}
                onChange={(gapTicks) => setMarks({ gapTicks })}
                label={t("print.marks.gapTicks")}
                info={t("print.marks.gapTicksHint")}
              />
            </>
          )}
          {backSheets && (
            <Switch
              checked={marks.onBacks}
              onChange={(onBacks) => setMarks({ onBacks })}
              label={t("print.marks.onBacks")}
              info={t("print.marks.onBacksHint")}
            />
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
  const aiEnabled = usePreferencesStore((s) => s.prefs.ai.enabled);
  const selected = usePrintStore(useShallow((s) => s.selection.selected));
  const cards = useLibraryCards();
  const [filling, setFilling] = useState(false);
  // Fill with AI is offered with AI Mode on; a project that already uses it keeps showing it.
  const sources = BLEED_SOURCES.filter((s) => s !== "ai" || aiEnabled || bleed.source === "ai");
  // The pieces picked in the library, or every piece.
  const toFill = selected.length > 0 ? cards.filter((c) => selected.includes(cardIdKey(c.id))) : cards;
  const filled = cards.filter((c) => cardIdKey(c.id) in bleed.aiFills).length;
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
        <FieldRow label={t("print.bleed.source")} info={t(`print.bleed.${bleed.source}Note`)}>
          <Select<BleedSource>
            fill
            label={t("print.bleed.source")}
            value={bleed.source}
            onChange={(source) => setBleed({ source })}
            options={sources.map((value) => ({ value, label: t(`print.bleed.sources.${value}`) }))}
          />
        </FieldRow>
      )}
      {bleed.mm > 0 && bleed.source === "ai" && (
        <>
          <p className="text-[var(--muted)]" data-testid="ai-fill-count">
            {t("print.aiFill.count", { count: filled, total: cards.length })}
          </p>
          {aiEnabled && (
            <FieldRow label={null}>
              <Button variant="ai" onClick={() => setFilling(true)}>
                {selected.length > 0
                  ? t("print.aiFill.openSelected", { count: toFill.length })
                  : t("print.aiFill.open")}
              </Button>
            </FieldRow>
          )}
          <FillWithAiDialog open={filling} cards={toFill} onClose={() => setFilling(false)} />
        </>
      )}
      <WarningList codes={["bleed_overlaps_neighbour", "bleed_off_page", "bleed_exceeds_source_gap"]} />
    </CollapsibleSection>
  );
}

/** The colour a fill starts with when it is switched on: black paper for the sheet, white behind the pieces. */
const FIRST_FILL = { sheet: "#000000", pieces: "#ffffff" } as const;

/** Background: plain colours under the sheet and behind the pieces, for art that leaves corners or edges empty. */
export function BackgroundSection() {
  const { t } = useTranslation();
  const background = usePrintStore((s) => s.finish.background);
  const setBackground = usePrintStore((s) => s.setBackground);
  return (
    <CollapsibleSection
      id="print.background"
      title={t("print.sections.background")}
      defaultOpen={false}
      info={t("print.background.note")}
    >
      {(["sheet", "pieces"] as const).map((which) => {
        const color = background[which];
        return (
          <div key={which} className="space-y-1">
            <Switch
              checked={color !== null}
              onChange={(on) => setBackground({ [which]: on ? FIRST_FILL[which] : null })}
              label={t(`print.background.${which}`)}
              info={t(`print.background.${which}Hint`)}
            />
            {color !== null && (
              <FieldRow label={t(`print.background.${which}Color`)}>
                <input
                  type="color"
                  aria-label={t(`print.background.${which}Color`)}
                  value={color}
                  onChange={(e) => setBackground({ [which]: e.target.value })}
                  className="h-6 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent"
                />
              </FieldRow>
            )}
          </div>
        );
      })}
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
  const [pairing, setPairing] = useState(false);
  return (
    <CollapsibleSection
      id="print.duplex"
      title={t("print.sections.duplex")}
      defaultOpen={false}
      hintTarget="duplex-section"
    >
      <Switch
        checked={duplex.on}
        onChange={(on) => setDuplex({ on })}
        label={t("print.duplex.on")}
        info={t("print.duplex.onHint")}
      />
      {duplex.on && (
        <>
          <FieldRow label={t("print.duplex.layout")}>
            <Segmented<BackLayout>
              fill
              label={t("print.duplex.layout")}
              value={duplex.layout}
              onChange={(layout) => setDuplex({ layout })}
              options={BACK_LAYOUTS.map((value) => ({ value, label: t(`print.duplex.layouts.${value}`) }))}
            />
          </FieldRow>
          {duplex.layout === "gutterfold" ? <GutterfoldFields /> : <DuplexFields />}
          <FieldRow label={null} data-hint-target="pair-backs-button">
            <Button onClick={() => setPairing(true)}>{t("print.pairing.open")}</Button>
            <InfoTip text={t("print.pairing.openHint")} />
          </FieldRow>
          <PairBacksDialog open={pairing} onClose={() => setPairing(false)} />
          <FieldRow label={t("print.duplex.commonBack")} info={t("print.duplex.backNote")}>
            <div className="flex w-full flex-col items-stretch gap-1">
              {common ? (
                <div className="self-start" data-testid="common-back">
                  <CardThumb card={common} width={64} height={92} selected={false} copies={null} onClick={() => {}} />
                </div>
              ) : (
                <span className="text-[var(--muted)]" data-testid="common-back-none">
                  {t("print.duplex.none")}
                </span>
              )}
              <Button disabled={selected.length !== 1} onClick={() => setDuplex({ commonBack: selected[0] ?? null })}>
                {t("print.duplex.useSelected")}
              </Button>
              <Button disabled={duplex.commonBack === null} onClick={() => setDuplex({ commonBack: null })}>
                {t("print.duplex.remove")}
              </Button>
            </div>
          </FieldRow>
          <WarningList codes={["back_size_differs"]} />
        </>
      )}
    </CollapsibleSection>
  );
}

/** Duplex backs on their own sheets: how the paper is turned over, and the printer's drift between sides. */
function DuplexFields() {
  const { t } = useTranslation();
  const duplex = usePrintStore((s) => s.finish.duplex);
  const setDuplex = usePrintStore((s) => s.setDuplex);
  const [calibrating, setCalibrating] = useState(false);
  return (
    <>
      <FieldRow label={t("print.duplex.flip")}>
        <Segmented<Flip>
          fill
          label={t("print.duplex.flip")}
          value={duplex.flip}
          onChange={(flip) => setDuplex({ flip })}
          options={FLIPS.map((value) => ({ value, label: t(`print.duplex.flips.${value}`) }))}
        />
      </FieldRow>
      <div className="flex flex-col gap-1.5" data-hint-target="back-offset">
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
      </div>
      <FieldRow label={null} data-hint-target="calibrate-button">
        <Button onClick={() => setCalibrating(true)}>{t("print.duplex.calibrate")}</Button>
      </FieldRow>
      <CalibrationDialog open={calibrating} onClose={() => setCalibrating(false)} />
    </>
  );
}

const BACK_TURNS = ["fold", "upright", "upsideDown"] as const;
type BackTurn = (typeof BACK_TURNS)[number];
const backTurnOf = (upsideDown: boolean | null): BackTurn =>
  upsideDown === null ? "fold" : upsideDown ? "upsideDown" : "upright";
const upsideDownOf = (turn: BackTurn): boolean | null => (turn === "fold" ? null : turn === "upsideDown");
/** Pairs cut apart have no fold to follow: a back is as printed unless it is turned upside down. */
const APART_TURNS = ["upright", "upsideDown"] as const;

const PAIR_CUTS = ["fold", "apart"] as const;
type PairCut = (typeof PAIR_CUTS)[number];

/**
 * Gutterfold backs beside their fronts: whether the pairs are folded or cut apart, where the back goes, how it is
 * turned, and the gap between front and back.
 */
function GutterfoldFields() {
  const { t } = useTranslation();
  const duplex = usePrintStore((s) => s.finish.duplex);
  const setDuplex = usePrintStore((s) => s.setDuplex);
  const apart = duplex.cutApart;
  return (
    <>
      <FieldRow label={t("print.duplex.pairs")} info={t("print.duplex.pairsNote")} data-hint-target="gutterfold-pairs">
        <Segmented<PairCut>
          fill
          label={t("print.duplex.pairs")}
          value={apart ? "apart" : "fold"}
          onChange={(cut) => setDuplex({ cutApart: cut === "apart" })}
          options={PAIR_CUTS.map((value) => ({ value, label: t(`print.duplex.pairCuts.${value}`) }))}
        />
      </FieldRow>
      <FieldRow
        label={apart ? t("print.duplex.backPlace") : t("print.duplex.fold")}
        info={apart ? t("print.duplex.backPlaceNote") : t("print.duplex.foldNote")}
      >
        <Segmented<Fold>
          fill
          label={apart ? t("print.duplex.backPlace") : t("print.duplex.fold")}
          value={duplex.fold}
          onChange={(fold) => setDuplex({ fold })}
          options={FOLDS.map((value) => ({ value, label: t(`print.duplex.folds.${value}`) }))}
        />
      </FieldRow>
      {apart ? (
        <FieldRow label={t("print.duplex.backTurn")} info={t("print.duplex.backTurnApartNote")}>
          <Segmented<(typeof APART_TURNS)[number]>
            fill
            label={t("print.duplex.backTurn")}
            value={duplex.backUpsideDown === true ? "upsideDown" : "upright"}
            onChange={(turn) => setDuplex({ backUpsideDown: turn === "upsideDown" })}
            options={APART_TURNS.map((value) => ({ value, label: t(`print.duplex.backTurns.${value}`) }))}
          />
        </FieldRow>
      ) : (
        <FieldRow label={t("print.duplex.backTurn")} info={t("print.duplex.backTurnNote")}>
          <Segmented<BackTurn>
            fill
            label={t("print.duplex.backTurn")}
            value={backTurnOf(duplex.backUpsideDown)}
            onChange={(turn) => setDuplex({ backUpsideDown: upsideDownOf(turn) })}
            options={BACK_TURNS.map((value) => ({ value, label: t(`print.duplex.backTurns.${value}`) }))}
          />
        </FieldRow>
      )}
      <MeasurementInput
        label={apart ? t("print.duplex.apartGap") : t("print.duplex.foldGap")}
        info={apart ? t("print.duplex.apartGapNote") : t("print.duplex.foldGapNote")}
        precise
        min={0}
        max={MAX_FOLD_GAP_MM}
        value={duplex.foldGapMm}
        onChange={(foldGapMm) => setDuplex({ foldGapMm })}
      />
    </>
  );
}
