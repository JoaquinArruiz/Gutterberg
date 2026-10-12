import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FALLBACK_SHEET, readingToOffset, saveCalibrationSheet } from "../../lib/calibration";
import { formatError, toAppError } from "../../lib/errors";
import { MAX_DUPLEX_OFFSET_MM } from "../../lib/finish";
import { usePrintStore } from "../../stores/print-store";
import { Button } from "../ui/Button";
import { MeasurementInput } from "../ui/MeasurementInput";

/**
 * The duplex calibration sheet: save a front and a back to print, then type the two numbers read on the rulers
 * (held to a light) into the back offset. The reading is the offset itself, see `readingToOffset`.
 */
export function CalibrationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const flip = usePrintStore((s) => s.finish.duplex.flip);
  const sheetPage = usePrintStore((s) => s.sheets?.[0]?.page);
  const setDuplex = usePrintStore((s) => s.setDuplex);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setX(0);
      setY(0);
      setStatus(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const saveSheet = async () => {
    try {
      const path = await saveCalibrationSheet(sheetPage ?? FALLBACK_SHEET, flip);
      if (path) setStatus({ ok: true, text: t("print.duplex.calibration.saved", { path }) });
    } catch (e) {
      setStatus({ ok: false, text: formatError(toAppError(e)) });
    }
  };

  return (
    <dialog
      ref={ref}
      aria-label={t("print.duplex.calibration.title")}
      onClose={onClose}
      onMouseDown={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[460px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/50"
    >
      <h2 className="mb-1 text-sm font-semibold">{t("print.duplex.calibration.title")}</h2>
      <p className="mb-2 text-[var(--muted)]">{t("print.duplex.calibration.intro")}</p>
      <ol className="mb-3 list-decimal space-y-1 pl-5">
        <li>{t("print.duplex.calibration.step1")}</li>
        <li>{t("print.duplex.calibration.step2")}</li>
        <li>{t("print.duplex.calibration.step3")}</li>
      </ol>
      <div className="mb-3 flex flex-col gap-1">
        <div>
          <Button size="md" onClick={saveSheet}>
            {t("print.duplex.calibration.save")}
          </Button>
        </div>
        {status && (
          <p role="status" className={status.ok ? "text-[var(--muted)]" : "text-red-400"}>
            {status.text}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <MeasurementInput
          label={t("print.duplex.calibration.readingX")}
          precise
          min={-MAX_DUPLEX_OFFSET_MM}
          max={MAX_DUPLEX_OFFSET_MM}
          value={x}
          onChange={setX}
        />
        <MeasurementInput
          label={t("print.duplex.calibration.readingY")}
          precise
          min={-MAX_DUPLEX_OFFSET_MM}
          max={MAX_DUPLEX_OFFSET_MM}
          value={y}
          onChange={setY}
        />
      </div>
      <p className="mt-2 text-[var(--muted)]">{t("print.duplex.calibration.cornersNote")}</p>
      <p className="text-[var(--muted)]">{t("print.duplex.calibration.replaces")}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button size="md" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          size="md"
          onClick={() => {
            setDuplex({ offsetXMm: readingToOffset(x), offsetYMm: readingToOffset(y) });
            onClose();
          }}
        >
          {t("common.apply")}
        </Button>
      </div>
    </dialog>
  );
}
