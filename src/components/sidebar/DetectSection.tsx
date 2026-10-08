import { useTranslation } from "react-i18next";
import { runDetect } from "../../lib/detect-actions";
import { isSkipped } from "../../lib/document-layout";
import { formatError } from "../../lib/errors";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { CollapsibleSection } from "../ui/CollapsibleSection";

const smallBtn = "rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--hover)] disabled:opacity-40";

/**
 * "Detect pieces": proposes where the pieces are on the viewed page, found locally. The proposal is a
 * draft on the page (see `DetectDraftBar`); nothing changes until the user applies it.
 */
export function DetectSection() {
  const { t } = useTranslation();
  const currentPage = useDocumentStore((s) => s.currentPage);
  const activeId = useDocumentStore((s) => s.activeId);
  const skipped = useLayoutStore((s) => isSkipped(s.groups, currentPage));
  const detecting = useEditorStore((s) => s.detecting);
  const error = useEditorStore((s) => s.detectError);
  const draft = useEditorStore((s) => s.draft);

  const here = draft && draft.page === currentPage && draft.documentId === activeId ? draft : null;
  const none = here !== null && here.detection.proposals.length === 0;
  return (
    <CollapsibleSection id="cards.detect" title={t("detect.title")}>
      <p className="text-[var(--muted)]">{t("detect.note")}</p>
      <div>
        <button type="button" className={smallBtn} disabled={detecting || skipped} onClick={() => void runDetect()}>
          {detecting ? t("detect.running") : t("detect.button")}
        </button>
      </div>
      {skipped && <p className="text-[var(--muted)]">{t("detect.skipped")}</p>}
      {error && (
        <p className="text-red-300" role="alert">
          ⚠ {formatError(error)}
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
    </CollapsibleSection>
  );
}
