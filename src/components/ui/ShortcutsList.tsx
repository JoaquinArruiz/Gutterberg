import { Search } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Chord, isWordKey, keyCap, SHORTCUT_AREAS, SHORTCUTS, type Shortcut } from "../../lib/shortcuts";

/** A key as a small cap. The words of the user's language (Space, Click...) are translated; the rest are shown as is. */
function Key({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <kbd className="rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-px font-sans text-[11px] leading-snug">
      {isWordKey(name) ? t(`shortcuts.keys.${name}`) : keyCap(name)}
    </kbd>
  );
}

function ChordKeys({ chord }: { chord: Chord }) {
  return (
    <span className="inline-flex items-center gap-1">
      {chord.map((key, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a chord's keys are positional
        <Key key={i} name={key} />
      ))}
    </span>
  );
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Other names a user may type for a key: `Mod` is Ctrl or Command, `Alt` is also Option.
const KEY_ALIASES: Record<string, string> = { Mod: "ctrl cmd command", Alt: "alt option" };

/** Whether every word typed is in the shortcut's text or in the names of its keys. */
function matches(s: Shortcut, label: string, keyWord: (key: string) => string, query: string): boolean {
  const keys = s.keys.flat().map((k) => `${keyWord(k)} ${KEY_ALIASES[k] ?? ""}`);
  const haystack = fold([label, ...keys].join(" "));
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * Every keyboard shortcut by area: the shortcuts sheet's content, also shown in Preferences › Help. A search field
 * stays at the top while the list scrolls and keeps the shortcuts whose text or keys contain what is typed.
 */
export function ShortcutsList() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const keyWord = (key: string) => (isWordKey(key) ? t(`shortcuts.keys.${key}`) : keyCap(key));
  const areas = SHORTCUT_AREAS.map((area) => ({
    area,
    shortcuts: SHORTCUTS[area].filter((s) => matches(s, t(`shortcuts.items.${s.id}`), keyWord, query)),
  })).filter((a) => a.shortcuts.length > 0);
  return (
    <>
      <div className="sticky top-0 z-10 mb-2 bg-[var(--panel)] pt-2 pb-2">
        <label className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 focus-within:border-[var(--accent)]">
          <Search size={13} className="shrink-0 text-[var(--muted)]" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("shortcuts.search")}
            aria-label={t("shortcuts.search")}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--muted)]"
          />
        </label>
      </div>
      {areas.length === 0 && (
        <p className="py-4 text-center text-[var(--muted)]" role="status">
          {t("shortcuts.noMatch")}
        </p>
      )}
      {areas.map(({ area, shortcuts }) => (
        <section key={area} className="mb-4 last:mb-0" aria-label={t(`shortcuts.areas.${area}`)}>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            {t(`shortcuts.areas.${area}`)}
          </h3>
          <ul>
            {shortcuts.map((s) => (
              <li
                key={s.id}
                data-shortcut={s.id}
                className="flex items-center justify-between gap-4 border-b border-[var(--border)]/50 py-1 last:border-0"
              >
                <span>{t(`shortcuts.items.${s.id}`)}</span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {s.keys.map((chord, i) => (
                    <Fragment key={chord.join("+")}>
                      {i > 0 && <span className="text-[var(--muted)]">{t("shortcuts.or")}</span>}
                      <ChordKeys chord={chord} />
                    </Fragment>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
