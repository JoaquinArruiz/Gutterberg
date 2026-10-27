import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { drawsPictures, providerHost } from "../../lib/ai";
import { aiFillEdge, type EdgeFill } from "../../lib/ai-api";
import { cardIdKey } from "../../lib/card";
import { type AppError, formatError, toAppError } from "../../lib/errors";
import { saveFills } from "../../lib/project-api";
import type { Card } from "../../lib/sheet-api";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { useProjectStore } from "../../stores/project-store";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";

/** Most pieces one run sends: each is a paid image request of its own. */
export const MAX_FILL_PIECES = 30;

/** Errors about one piece; any other (no key, no network, a refused key) stops the run. */
const PER_PIECE = new Set(["fill_reply", "fill_tilted", "ai_refused", "ai_invalid_reply", "ai_timeout"]);

type Row = { key: string; card: Card; fill: EdgeFill | null; error: AppError | null; keep: boolean };

type Step = { kind: "ask" } | { kind: "running"; done: number } | { kind: "review" };

const png = (b64: string) => `data:image/png;base64,${b64}`;

/** Why a run cannot start, as a catalog key under `print.aiFill`, or null when it can. */
function blocker(
  count: number,
  saved: boolean,
  ai: ReturnType<typeof usePreferencesStore.getState>["prefs"]["ai"],
  bleedMm: number,
) {
  if (bleedMm <= 0) return "needsBleed";
  if (!saved) return "saveFirst";
  if (!ai.sendImages) return "needsImages";
  if (!drawsPictures(ai.provider)) return "noProvider";
  if (ai.providers[ai.provider].imageModel.trim() === "") return "noModel";
  if (count === 0) return "noPieces";
  if (count > MAX_FILL_PIECES) return "tooMany";
  return null;
}

/**
 * Fill with AI: sends a picture of each of `cards` to the image model, one request per piece, and shows what came back
 * beside the piece as it was. Nothing is kept until Apply, which saves the ticked pictures beside the project and uses
 * them for the bleed, as one undo step. Only the band round the piece is ever kept of a picture (`card_core::fill`).
 */
export function FillWithAiDialog({ open, cards, onClose }: { open: boolean; cards: Card[]; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const ai = usePreferencesStore((s) => s.prefs.ai);
  const bleedMm = usePrintStore((s) => s.finish.bleed.mm);
  const path = useProjectStore((s) => s.path);
  const [step, setStep] = useState<Step>({ kind: "ask" });
  const [rows, setRows] = useState<Row[]>([]);
  const [stopped, setStopped] = useState<AppError | null>(null);
  const [failed, setFailed] = useState<AppError | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setStep({ kind: "ask" });
      setRows([]);
      setStopped(null);
      setFailed(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => {
    stop.current = true;
    onClose();
  };

  const why = blocker(cards.length, path !== null, ai, bleedMm);

  const send = async () => {
    stop.current = false;
    const made: Row[] = [];
    setStep({ kind: "running", done: 0 });
    for (const card of cards) {
      if (stop.current) break;
      const key = cardIdKey(card.id);
      try {
        const fill = await aiFillEdge(card.id.document_id, card.id.page_index, card.source, bleedMm);
        made.push({ key, card, fill, error: null, keep: true });
      } catch (e) {
        const error = toAppError(e);
        if (!PER_PIECE.has(error.code ?? "")) {
          setStopped(error);
          break;
        }
        made.push({ key, card, fill: null, error, keep: false });
      }
      setStep({ kind: "running", done: made.length });
    }
    setRows(made);
    setStep({ kind: "review" });
  };

  const kept = rows.filter((r) => r.fill && r.keep);

  const apply = async () => {
    if (!path || kept.length === 0) return;
    try {
      const names = await saveFills(
        path,
        kept.map((r) => ({ key: r.key, png: r.fill?.fill ?? "", hash: r.fill?.hash ?? "" })),
      );
      const print = usePrintStore.getState();
      const aiFills = { ...print.finish.bleed.aiFills };
      kept.forEach((r, i) => {
        aiFills[r.key] = { file: names[i], inset: r.fill?.inset ?? 0 };
      });
      print.setBleed({ source: "ai", aiFills });
      close();
    } catch (e) {
      setFailed(toAppError(e));
    }
  };

  const toggle = (key: string, keep: boolean) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, keep } : r)));

  return (
    <dialog
      ref={ref}
      data-ai="fill"
      aria-label={t("print.aiFill.title")}
      onClose={(e) => e.target === e.currentTarget && close()}
      className="m-auto w-[560px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/50"
    >
      <h2 className="mb-1 text-sm font-semibold">{t("print.aiFill.title")}</h2>
      {step.kind === "ask" && (
        <div className="flex flex-col gap-2.5">
          <p className="text-[var(--muted)]">{t("print.aiFill.text")}</p>
          {why ? (
            <p role="status" className="text-amber-200" data-testid="ai-fill-blocked">
              {t(`print.aiFill.blocked.${why}`, {
                max: MAX_FILL_PIECES,
                count: cards.length,
                provider: t(`ai.providers.${ai.provider}`),
              })}
            </p>
          ) : (
            <p data-testid="ai-fill-what">
              {t("print.aiFill.what", {
                count: cards.length,
                host: providerHost(ai),
                model: ai.providers[ai.provider].imageModel.trim(),
                size: 1024,
              })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="md" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button size="md" variant="ai" disabled={why !== null} onClick={() => void send()}>
              {t("print.aiFill.send", { count: cards.length })}
            </Button>
          </div>
        </div>
      )}
      {step.kind === "running" && (
        <div className="flex flex-col gap-2.5">
          <p role="status">{t("print.aiFill.running", { done: step.done, count: cards.length })}</p>
          <div className="flex justify-end">
            <Button
              size="md"
              onClick={() => {
                stop.current = true;
              }}
            >
              {t("print.aiFill.stop")}
            </Button>
          </div>
        </div>
      )}
      {step.kind === "review" && (
        <div className="flex flex-col gap-2.5">
          <p className="text-[var(--muted)]">{t("print.aiFill.review")}</p>
          {stopped && (
            <p role="alert" className="text-red-300">
              {t("print.aiFill.stopped", { error: formatError(stopped) })}
            </p>
          )}
          <ul className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
            {rows.map((r, i) => (
              <li key={r.key} className="flex items-center gap-3 rounded border border-[var(--border)] p-2">
                {r.fill ? (
                  <>
                    <Checkbox
                      checked={r.keep}
                      onChange={(keep) => toggle(r.key, keep)}
                      label={t("print.aiFill.piece", { n: i + 1 })}
                    />
                    <img src={png(r.fill.before)} alt={t("print.aiFill.before")} className="h-28 w-auto" />
                    <img src={png(r.fill.after)} alt={t("print.aiFill.after")} className="h-28 w-auto" />
                  </>
                ) : (
                  <span className="text-red-300">
                    {t("print.aiFill.pieceFailed", { n: i + 1, error: r.error ? formatError(r.error) : "" })}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {failed && (
            <p role="alert" className="text-red-300">
              {formatError(failed)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="md" onClick={close}>
              {t("print.aiFill.discard")}
            </Button>
            <Button size="md" variant="ai" disabled={kept.length === 0} onClick={() => void apply()}>
              {t("print.aiFill.apply", { count: kept.length })}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
