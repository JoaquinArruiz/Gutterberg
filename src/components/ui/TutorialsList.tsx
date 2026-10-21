import { Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  TUTORIAL_GROUPS,
  TUTORIAL_IDS,
  TUTORIALS,
  tutorialGroupKey,
  tutorialSummaryKey,
  tutorialTitleKey,
} from "../../lib/tutorials";
import { useUiStore } from "../../stores/ui-store";
import { useUpdateStore } from "../../stores/update-store";

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Every tutorial by group (the Source tab, the Print tab, Duplex, the app): the Tutorials dialog's content, also shown
 * in Preferences › Help. A search field stays at the top while the list scrolls and keeps the tutorials whose title
 * or summary contain every word typed, in the app's language and ignoring case and accents. Picking one closes the
 * dialog and Preferences, and starts it.
 */
export function TutorialsList() {
  const { t } = useTranslation();
  const startTutorial = useUiStore((s) => s.startTutorial);
  // The Store updates a Store copy, so Update Gutterberg has nothing to show there.
  const fromStore = useUpdateStore((s) => s.store);
  const [query, setQuery] = useState("");
  const words = fold(query).split(/\s+/).filter(Boolean);
  const groups = TUTORIAL_GROUPS.map((group) => ({
    group,
    ids: TUTORIAL_IDS.filter((id) => {
      if (TUTORIALS[id].group !== group) return false;
      if (id === "update" && fromStore) return false;
      const haystack = fold(`${t(tutorialTitleKey(id))} ${t(tutorialSummaryKey(id))}`);
      return words.every((w) => haystack.includes(w));
    }),
  })).filter((g) => g.ids.length > 0);
  return (
    <>
      <div className="sticky top-0 z-10 mb-2 bg-[var(--panel)] pt-2 pb-2">
        <label className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 focus-within:border-[var(--accent)]">
          <Search size={13} className="shrink-0 text-[var(--muted)]" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("tutorials.search")}
            aria-label={t("tutorials.search")}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--muted)]"
          />
        </label>
      </div>
      {groups.length === 0 && (
        <p className="py-4 text-center text-[var(--muted)]" role="status">
          {t("tutorials.noMatch")}
        </p>
      )}
      {groups.map(({ group, ids }) => (
        <section key={group} className="mb-4 last:mb-0" aria-label={t(tutorialGroupKey(group))}>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            {t(tutorialGroupKey(group))}
          </h3>
          <ul>
            {ids.map((id) => (
              <li key={id} className="border-b border-[var(--border)]/50 last:border-0">
                <button
                  type="button"
                  data-tutorial={id}
                  onClick={() => startTutorial(id)}
                  className="block w-full rounded px-1 py-1.5 text-left hover:bg-[var(--hover)]"
                >
                  <span className="block font-medium">{t(tutorialTitleKey(id))}</span>
                  <span className="block text-[var(--muted)]">{t(tutorialSummaryKey(id))}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
