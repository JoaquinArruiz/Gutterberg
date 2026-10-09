import { useTranslation } from "react-i18next";
import { applySort, askSort, discardSort } from "../../lib/ai-actions";
import { PAGE_LABELS, type PageLabel } from "../../lib/ai-api";
import { isSkipped } from "../../lib/document-layout";
import { formatError } from "../../lib/errors";
import { usePageImage } from "../../lib/use-page-image";
import { useAiStore } from "../../stores/ai-store";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { Select } from "../ui/Select";

function Thumb({ page }: { page: number }) {
  const path = useDocumentStore((s) => s.path);
  const url = usePageImage(path, page, 40, 0, "thumbnail");
  return url ? (
    <img src={url} alt="" className="h-12 w-9 shrink-0 rounded-sm object-contain bg-white/5" />
  ) : (
    <span className="h-12 w-9 shrink-0 rounded-sm bg-white/5" />
  );
}

/**
 * "Sort pages with AI": labels every page from small pictures (or, text only, from a description) and shows
 * the proposal as a list the user can change before applying. Applying sets the pages' skip states, in one
 * undo step, and nothing else.
 */
export function AiSortSection() {
  const { t } = useTranslation();
  const enabled = usePreferencesStore((s) => s.prefs.ai.enabled);
  const provider = usePreferencesStore((s) => s.prefs.ai.provider);
  const estimating = useAiStore((s) => s.estimating);
  const running = useAiStore((s) => s.running);
  const error = useAiStore((s) => (s.error?.task === "sort" ? s.error.error : null));
  const usage = useAiStore((s) => (s.usage?.task === "sort" ? s.usage.tokens : null));
  const sort = useAiStore((s) => s.sort);
  const updateRow = useAiStore((s) => s.updateRow);
  const groups = useLayoutStore((s) => s.groups);
  const activeId = useDocumentStore((s) => s.activeId);

  if (!enabled) return null;
  const busy = estimating || running;
  const changing = sort ? sort.rows.filter((r) => isSkipped(groups, r.page) !== r.skip).length : 0;
  return (
    <CollapsibleSection id="cards.sort" title={t("ai.sort.title")} info={t("ai.sort.note")}>
      <div data-ai="sort" className="flex flex-col gap-1.5">
        <div>
          <Button
            variant="ai"
            busy={busy}
            disabled={busy}
            title={t("ai.sort.sends", { provider: t(`ai.providers.${provider}`) })}
            onClick={() => void askSort()}
          >
            {running ? t("ai.sort.running") : estimating ? t("ai.sort.estimating") : t("ai.sort.button")}
          </Button>
        </div>
        {error && (
          <p className="text-red-300" role="alert">
            ⚠ {formatError(error)}
          </p>
        )}
        {sort && sort.documentId === activeId && (
          <>
            <ul className="max-h-72 overflow-y-auto" data-testid="ai-sort-rows">
              {sort.rows.map((r) => (
                <li key={r.page} className="flex items-center gap-2 py-1" data-testid="ai-sort-row">
                  <Thumb page={r.page} />
                  <span className="w-14 shrink-0 tabular-nums">{t("ai.sort.page", { n: r.page + 1 })}</span>
                  <Select<PageLabel>
                    className="min-w-0 flex-1 [&>button]:min-w-0"
                    label={t("ai.sort.labelFor", { n: r.page + 1 })}
                    value={r.label}
                    onChange={(label) => updateRow(r.page, { label })}
                    options={PAGE_LABELS.map((l) => ({ value: l, label: t(`ai.sort.labels.${l}`) }))}
                  />
                  <Checkbox
                    className="shrink-0"
                    aria-label={t("ai.sort.skipFor", { n: r.page + 1 })}
                    label={t("ai.sort.skip")}
                    checked={r.skip}
                    onChange={(skip) => updateRow(r.page, { skip })}
                  />
                </li>
              ))}
            </ul>
            <p className="text-[var(--muted)]" data-testid="ai-sort-changes">
              {changing === 0 ? t("ai.sort.noChanges") : t("ai.sort.changes", { count: changing })}
            </p>
            <div className="flex gap-1.5">
              <Button variant="primary" disabled={changing === 0} onClick={applySort}>
                {t("ai.sort.apply")}
              </Button>
              <Button onClick={discardSort}>{t("ai.sort.cancel")}</Button>
            </div>
          </>
        )}
        {usage && (
          <p className="text-[var(--muted)]">
            {t("ai.usage", { input: usage.input_tokens, output: usage.output_tokens })}
          </p>
        )}
      </div>
    </CollapsibleSection>
  );
}
