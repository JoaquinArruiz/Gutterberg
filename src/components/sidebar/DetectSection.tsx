import { useTranslation } from "react-i18next";
import { askDetect } from "../../lib/ai-actions";
import { runDetect } from "../../lib/detect-actions";
import { isSkipped } from "../../lib/document-layout";
import { formatError } from "../../lib/errors";
import { type DetectEngine, useAiStore } from "../../stores/ai-store";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { CollapsibleSection } from "../ui/CollapsibleSection";

const smallBtn = "rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--hover)] disabled:opacity-40";

/**
 * "Detect pieces": proposes where the pieces are on the viewed page, found locally. The proposal is a
 * draft on the page (see `DetectDraftBar`); nothing changes until the user applies it. With AI Mode on there
 * is a second engine to choose, AI; Local stays the default and never touches the network.
 */
export function DetectSection() {
  const { t } = useTranslation();
  const currentPage = useDocumentStore((s) => s.currentPage);
  const activeId = useDocumentStore((s) => s.activeId);
  const skipped = useLayoutStore((s) => isSkipped(s.groups, currentPage));
  const detecting = useEditorStore((s) => s.detecting);
  const error = useEditorStore((s) => s.detectError);
  const draft = useEditorStore((s) => s.draft);
  const aiOn = usePreferencesStore((s) => s.prefs.ai.enabled);
  const engine = useAiStore((s) => (aiOn ? s.engine : "local"));
  const setEngine = useAiStore((s) => s.setEngine);
  const aiBusy = useAiStore((s) => s.estimating || s.running);
  const aiError = useAiStore((s) => (s.error?.task === "detect" ? s.error.error : null));
  const usage = useAiStore((s) => (s.usage?.task === "detect" ? s.usage.tokens : null));

  const here = draft && draft.page === currentPage && draft.documentId === activeId ? draft : null;
  const none = here !== null && here.detection.proposals.length === 0;
  const ai = engine === "ai";
  const shownError = ai ? aiError : error;
  const busy = ai ? aiBusy : detecting;
  return (
    <CollapsibleSection id="cards.detect" title={t("detect.title")}>
      <p className="text-[var(--muted)]">{ai ? t("ai.detect.note") : t("detect.note")}</p>
      {aiOn && (
        <fieldset className="flex items-center gap-3" data-ai="engine">
          <legend className="sr-only">{t("ai.detect.engine")}</legend>
          {(["local", "ai"] as DetectEngine[]).map((e) => (
            <label key={e} className="flex items-center gap-1">
              <input type="radio" name="detect-engine" checked={engine === e} onChange={() => setEngine(e)} />
              {t(`ai.detect.${e}`)}
            </label>
          ))}
        </fieldset>
      )}
      <div>
        <button
          type="button"
          className={smallBtn}
          disabled={busy || skipped}
          onClick={() => void (ai ? askDetect() : runDetect())}
        >
          {busy ? t("detect.running") : ai ? t("ai.detect.buttonAi") : t("detect.button")}
        </button>
      </div>
      {skipped && <p className="text-[var(--muted)]">{t("detect.skipped")}</p>}
      {shownError && (
        <p className="text-red-300" role="alert">
          ⚠ {formatError(shownError)}
        </p>
      )}
      {none && (
        <div data-testid="detect-none">
          <p>{t("detect.none")}</p>
          {here.detection.reasons.map((r) => (
            <p key={r} className="text-[var(--muted)]">
              {t(`detect.notes.${r}`)}
            </p>
          ))}
        </div>
      )}
      {here && !none && <p className="text-[var(--muted)]">{t("detect.onThePage")}</p>}
      {ai && usage && (
        <p className="text-[var(--muted)]" data-ai="usage">
          {t("ai.usage", { input: usage.input_tokens, output: usage.output_tokens })}
        </p>
      )}
    </CollapsibleSection>
  );
}
