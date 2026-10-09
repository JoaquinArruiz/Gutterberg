import { useTranslation } from "react-i18next";
import { askDetect } from "../../lib/ai-actions";
import { runDetect } from "../../lib/detect-actions";
import { isSkipped } from "../../lib/document-layout";
import { formatError } from "../../lib/errors";
import { useAiStore } from "../../stores/ai-store";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { Button } from "../ui/Button";
import { CollapsibleSection } from "../ui/CollapsibleSection";

/**
 * "Detect pieces": proposes where the pieces are on the viewed page, found locally. The proposal is a
 * draft on the page (see `DetectDraftBar`); nothing changes until the user applies it. With AI Mode on there
 * is a second button, Detect with AI, next to the local one; the local one never touches the network.
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
  const provider = usePreferencesStore((s) => s.prefs.ai.provider);
  const aiBusy = useAiStore((s) => s.estimating || s.running);
  const aiError = useAiStore((s) => (s.error?.task === "detect" ? s.error.error : null));
  const usage = useAiStore((s) => (s.usage?.task === "detect" ? s.usage.tokens : null));

  const here = draft && draft.page === currentPage && draft.documentId === activeId ? draft : null;
  const none = here !== null && here.detection.proposals.length === 0;
  const busy = detecting || aiBusy;
  return (
    <CollapsibleSection
      id="cards.detect"
      title={t("detect.title")}
      info={
        aiOn ? (
          <>
            <span className="block">{t("detect.note")}</span>
            <span className="mt-1 block">{t("ai.detect.note")}</span>
          </>
        ) : (
          t("detect.note")
        )
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Button disabled={busy || skipped} onClick={() => void runDetect()}>
          {detecting ? t("detect.running") : t("detect.button")}
        </Button>
        {aiOn && (
          <Button
            variant="ai"
            busy={aiBusy}
            disabled={busy || skipped}
            title={t("ai.detect.sends", { provider: t(`ai.providers.${provider}`) })}
            onClick={() => void askDetect()}
          >
            {t("ai.detect.buttonAi")}
          </Button>
        )}
      </div>
      {skipped && <p className="text-[var(--muted)]">{t("detect.skipped")}</p>}
      {[error, aiError].map(
        (e) =>
          e && (
            <p key={e.code} className="text-red-300" role="alert">
              ⚠ {formatError(e)}
            </p>
          ),
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
      {usage && (
        <p className="text-[var(--muted)]" data-ai="usage">
          {t("ai.usage", { input: usage.input_tokens, output: usage.output_tokens })}
        </p>
      )}
    </CollapsibleSection>
  );
}
