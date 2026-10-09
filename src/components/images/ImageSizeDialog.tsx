import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toAppError } from "../../lib/errors";
import {
  DEFAULT_BLEED_MM,
  formatBytes,
  type ImagePlacement,
  type ImagePlan,
  type ImageProbe,
  planImages,
  SIZE_PRESETS,
  type SizePreset,
} from "../../lib/images";
import { formatDecimal } from "../../lib/measurement";
import { useImageImportStore } from "../../stores/image-import-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { MeasurementInput } from "../ui/MeasurementInput";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";

const round1 = (mm: number) => Math.round(mm * 10) / 10;
/** A size in mm without a needless ".0": 63 and 63.5. */
const mmText = (mm: number) => formatDecimal(mm, Number.isInteger(mm) ? 0 : 1);

/**
 * "Add images": shown once per import, for all its images. Piece size (a preset, the size the image says it
 * is, or a custom one), whether the images already include bleed, what to do with an image whose proportions
 * do not match (Fit or Fill, never stretched), and the resolution each one will print at. Nothing is built
 * until Add images; the numbers shown come from the engine (`plan_images`).
 */
export function ImageSizeDialog() {
  const { t } = useTranslation();
  const pending = useImageImportStore((s) => s.pending);
  const answer = useImageImportStore((s) => s.answer);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (pending && !d.open) d.showModal();
    if (!pending && d.open) d.close();
  }, [pending]);

  return (
    <dialog
      ref={ref}
      aria-label={t("images.dialog.label")}
      onClose={() => answer(null)}
      className="m-auto w-[520px] max-w-[94vw] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/50"
    >
      {pending && <ImageSizeForm probes={pending.probes} onDone={answer} />}
    </dialog>
  );
}

function ImageSizeForm({
  probes,
  onDone,
}: {
  probes: ImageProbe[];
  onDone: (choice: { placements: ImagePlacement[] } | null) => void;
}) {
  const { t } = useTranslation();
  const saved = usePreferencesStore((s) => s.prefs.images.size);
  const setImageSize = usePreferencesStore((s) => s.setImageSize);
  const first = probes[0];
  const hasNative = probes.every((p) => p.nativeWidthMm !== null && p.nativeHeightMm !== null);

  const [preset, setPreset] = useState<SizePreset>(saved.preset === "image" && !hasNative ? "standard" : saved.preset);
  const [custom, setCustom] = useState({ widthMm: saved.widthMm, heightMm: saved.heightMm });
  const [lock, setLock] = useState(false);
  const [bleedOn, setBleedOn] = useState(saved.bleed);
  const [bleedMm, setBleedMm] = useState(saved.bleedMm || DEFAULT_BLEED_MM);
  const [fits, setFits] = useState<Record<string, "fit" | "fill">>({});
  const [reduce, setReduce] = useState(false);
  const [plans, setPlans] = useState<ImagePlan[] | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const bleed = bleedOn ? bleedMm : 0;
  // The piece, without its bleed. "From the image" is the size its file says; when that includes bleed, the
  // piece is what is left inside it.
  const size = useMemo(() => {
    if (preset === "image" && hasNative)
      return {
        widthMm: round1((first.nativeWidthMm ?? 0) - 2 * bleed),
        heightMm: round1((first.nativeHeightMm ?? 0) - 2 * bleed),
      };
    if (preset === "custom") return custom;
    if (preset === "image") return SIZE_PRESETS.standard;
    return SIZE_PRESETS[preset];
  }, [preset, custom, hasNative, first, bleed]);
  const valid = size.widthMm >= 5 && size.heightMm >= 5;

  const placements: ImagePlacement[] = useMemo(
    () =>
      probes.map((p) => ({
        widthMm: Math.max(size.widthMm, 5),
        heightMm: Math.max(size.heightMm, 5),
        bleedMm: bleed,
        fit: fits[p.path] ?? "fit",
        reduceLarge: reduce,
      })),
    [probes, size, bleed, fits, reduce],
  );

  // The engine's numbers for the current choice. A slow answer for an older choice is dropped.
  const latest = useRef(0);
  useEffect(() => {
    if (!valid) return;
    const n = ++latest.current;
    planImages(probes.map((probe, i) => ({ probe, placement: placements[i] })))
      .then((p) => {
        if (n !== latest.current) return;
        setPlans(p);
        setPlanError(null);
      })
      .catch((e) => n === latest.current && setPlanError(toAppError(e).message));
  }, [probes, placements, valid]);

  const differing = plans ? probes.filter((_, i) => plans[i]?.proportionsDiffer) : [];
  const attention = plans
    ? probes.flatMap((p, i) => (plans[i] && plans[i].quality !== "good" ? [{ probe: p, plan: plans[i] }] : []))
    : [];
  const large = plans ? probes.flatMap((p, i) => (plans[i]?.veryLarge ? [{ probe: p, plan: plans[i] }] : [])) : [];
  const total = plans ? plans.reduce((n, p) => n + p.storedBytes, 0) : 0;

  const setWidth = (mm: number) =>
    setCustom({
      widthMm: mm,
      heightMm: lock ? round1((mm * first.heightPx) / first.widthPx) : custom.heightMm,
    });
  const setHeight = (mm: number) =>
    setCustom({
      heightMm: mm,
      widthMm: lock ? round1((mm * first.widthPx) / first.heightPx) : custom.widthMm,
    });

  const presetLabel = (id: keyof typeof SIZE_PRESETS) =>
    t(`images.dialog.presets.${id}`, {
      width: formatDecimal(SIZE_PRESETS[id].widthMm, 0),
      height: formatDecimal(SIZE_PRESETS[id].heightMm, 0),
    });

  const confirm = () => {
    if (!valid) return;
    setImageSize({
      preset,
      widthMm: preset === "custom" ? custom.widthMm : size.widthMm,
      heightMm: preset === "custom" ? custom.heightMm : size.heightMm,
      bleed: bleedOn,
      bleedMm,
    });
    onDone({ placements });
  };

  const qualityText = (plan: ImagePlan) =>
    t(plan.quality === "blurry" ? "images.dialog.blurry" : "images.dialog.soft", { dpi: Math.round(plan.dpi) });

  return (
    <div className="flex max-h-[92vh] flex-col">
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
        <h2 className="text-sm font-semibold">{t("images.dialog.title", { count: probes.length })}</h2>
        <p className="text-[var(--muted)]">{t("images.dialog.lead")}</p>

        <section className="flex flex-col gap-2" aria-label={t("images.dialog.sizeTitle")}>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            {t("images.dialog.sizeTitle")}
          </h3>
          <Select<SizePreset>
            label={t("images.dialog.sizeTitle")}
            value={preset}
            onChange={setPreset}
            options={[
              { value: "standard", label: presetLabel("standard") },
              { value: "small", label: presetLabel("small") },
              { value: "tarot", label: presetLabel("tarot") },
              {
                value: "image",
                label: hasNative ? t("images.dialog.fromImage") : t("images.dialog.fromImageOff"),
                disabled: !hasNative,
              },
              { value: "custom", label: t("images.dialog.custom") },
            ]}
          />
          {preset === "custom" && (
            <div className="flex flex-wrap items-end gap-3">
              <MeasurementInput
                label={t("common.width")}
                precise
                min={5}
                max={1000}
                value={custom.widthMm}
                onChange={setWidth}
              />
              <MeasurementInput
                label={t("common.height")}
                precise
                min={5}
                max={1000}
                value={custom.heightMm}
                onChange={setHeight}
              />
              <Checkbox checked={lock} onChange={setLock} label={t("images.dialog.lock")} className="pb-1" />
            </div>
          )}
          <p className="text-[var(--muted)]" data-testid="image-piece-size">
            {t("images.dialog.pieceSize", { width: mmText(size.widthMm), height: mmText(size.heightMm) })}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <Switch
            checked={bleedOn}
            onChange={setBleedOn}
            label={t("images.dialog.bleed")}
            info={t("images.dialog.bleedInfo")}
          />
          {bleedOn && (
            <MeasurementInput
              label={t("images.dialog.bleedAmount")}
              precise
              min={0}
              max={20}
              value={bleedMm}
              onChange={setBleedMm}
            />
          )}
        </section>

        {differing.length > 0 && (
          <section className="flex flex-col gap-1.5" aria-label={t("images.dialog.differTitle")}>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {t("images.dialog.differTitle")}
            </h3>
            <p className="text-[var(--muted)]">{t("images.dialog.differLead", { count: differing.length })}</p>
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {differing.map((p) => (
                <li key={p.path} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate" title={p.path}>
                    {p.name}
                  </span>
                  <Segmented<"fit" | "fill">
                    label={t("images.dialog.fitFor", { name: p.name })}
                    value={fits[p.path] ?? "fit"}
                    onChange={(v) => setFits((f) => ({ ...f, [p.path]: v }))}
                    options={[
                      { value: "fit", label: t("images.dialog.fit") },
                      { value: "fill", label: t("images.dialog.fill") },
                    ]}
                  />
                </li>
              ))}
            </ul>
            <p className="text-[var(--muted)]">{t("images.dialog.fitHint")}</p>
          </section>
        )}

        {attention.length > 0 && (
          <section className="flex flex-col gap-1" aria-label={t("images.dialog.resolutionTitle")}>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {t("images.dialog.resolutionTitle")}
            </h3>
            <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto">
              {attention.map(({ probe, plan }) => (
                <li key={probe.path} className={plan.quality === "blurry" ? "font-medium" : "text-[var(--muted)]"}>
                  <span title={probe.path}>{probe.name}</span>: {plan.quality === "blurry" ? "⚠ " : ""}
                  {qualityText(plan)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {plans && (
          <section className="flex flex-col gap-2" aria-label={t("images.dialog.exportTitle")}>
            <p data-testid="image-export-size">{t("images.dialog.exportSize", { size: formatBytes(total) })}</p>
            {large.length > 0 && (
              <>
                <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto text-[var(--muted)]">
                  {large.map(({ probe, plan }) => (
                    <li key={probe.path}>
                      <span title={probe.path}>{probe.name}</span>:{" "}
                      {t("images.dialog.veryLarge", {
                        dpi: Math.round(plan.dpi),
                        size: formatBytes(plan.storedBytes),
                      })}
                    </li>
                  ))}
                </ul>
                <Switch
                  checked={reduce}
                  onChange={setReduce}
                  label={t("images.dialog.reduce")}
                  hint={t("images.dialog.reduceHint")}
                />
              </>
            )}
          </section>
        )}
        {planError && (
          <p className="text-red-300" role="alert">
            ⚠ {planError}
          </p>
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
        <Button size="md" onClick={() => onDone(null)}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" size="md" disabled={!valid || plans === null} onClick={confirm}>
          {t("images.dialog.add", { count: probes.length })}
        </Button>
      </div>
    </div>
  );
}
