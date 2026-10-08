import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cancelRun, confirmRun } from "../../lib/ai-actions";
import { formatDecimal } from "../../lib/measurement";
import { useAiStore } from "../../stores/ai-store";
import { usePreferencesStore } from "../../stores/preferences-store";

const btn = "rounded border border-[var(--border)] px-3 py-1 hover:bg-[var(--hover)] disabled:opacity-40";

/** `[2, 3, 4, 7]` as "3–5, 8" (1-based, as the user counts pages). */
export function pageRanges(pages: number[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < pages.length) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(j > i ? `${pages[i] + 1}–${pages[j] + 1}` : `${pages[i] + 1}`);
    i = j + 1;
  }
  return out.join(", ");
}

/**
 * The notice every AI action stops at: which server gets what (which pages, as pictures or as text), what it
 * will roughly cost, and Send or Cancel. Nothing has been sent when this is on screen.
 */
export function AiConfirmDialog() {
  const { t } = useTranslation();
  const enabled = usePreferencesStore((s) => s.prefs.ai.enabled);
  const run = useAiStore((s) => s.confirm);
  const skip = useAiStore((s) => s.skipDetectConfirm);
  const setSkip = useAiStore((s) => s.setSkipDetectConfirm);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (run && !d.open) d.showModal();
    if (!run && d.open) d.close();
  }, [run]);

  // With AI Mode off there is nothing of this in the page at all.
  if (!enabled) return null;
  const e = run?.estimate;
  return (
    <dialog
      ref={ref}
      data-ai="confirm"
      aria-label={t("ai.confirm.title", { provider: run ? t(`ai.providers.${run.provider}`) : "" })}
      onClose={cancelRun}
      className="m-auto w-[460px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/50"
    >
      {run && e && (
        <div className="flex flex-col gap-2.5 p-4">
          <h2 className="text-sm font-semibold">
            {t("ai.confirm.title", { provider: t(`ai.providers.${run.provider}`) })}
          </h2>
          <p>
            <span className="text-[var(--muted)]">{t("ai.confirm.server")}: </span>
            <span className="font-mono" data-testid="ai-host">
              {e.host}
            </span>
          </p>
          <p data-testid="ai-what">
            {run.task === "detect"
              ? e.sends_images
                ? t("ai.confirm.detectImage", { page: run.pages[0] + 1, size: 1000 })
                : t("ai.confirm.detectText")
              : e.sends_images
                ? t("ai.confirm.sortImages", {
                    count: run.pages.length,
                    range: pageRanges(run.pages),
                    size: 320,
                    requests: e.requests,
                  })
                : t("ai.confirm.sortText", {
                    count: run.pages.length,
                    range: pageRanges(run.pages),
                    requests: e.requests,
                  })}
          </p>
          <p className="text-[var(--muted)]" data-testid="ai-estimate">
            {t("ai.confirm.estimate", {
              input: e.input_tokens.toLocaleString(),
              output: e.output_tokens.toLocaleString(),
            })}{" "}
            {e.cost_usd === null
              ? t("ai.confirm.noCost")
              : t("ai.confirm.cost", { cost: formatDecimal(Math.max(e.cost_usd, 0.01), 2) })}
          </p>
          {run.task === "detect" && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={skip} onChange={(ev) => setSkip(ev.target.checked)} />
              <span>{t("ai.confirm.dontAsk")}</span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={btn} onClick={cancelRun}>
              {t("ai.confirm.cancel")}
            </button>
            <button type="button" className={`${btn} border-[var(--accent)]`} onClick={() => void confirmRun()}>
              {t("ai.confirm.send")}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
