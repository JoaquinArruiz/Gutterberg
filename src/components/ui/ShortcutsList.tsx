import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { type Chord, isWordKey, keyCap, SHORTCUT_AREAS, SHORTCUTS } from "../../lib/shortcuts";

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

/** Every keyboard shortcut by area: the shortcuts sheet's content, also shown in Preferences › Help. */
export function ShortcutsList() {
  const { t } = useTranslation();
  return (
    <>
      {SHORTCUT_AREAS.map((area) => (
        <section key={area} className="mb-4 last:mb-0" aria-label={t(`shortcuts.areas.${area}`)}>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            {t(`shortcuts.areas.${area}`)}
          </h3>
          <ul>
            {SHORTCUTS[area].map((s) => (
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
