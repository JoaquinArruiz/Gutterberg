import { X } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { type Chord, isWordKey, keyCap, SHORTCUT_AREAS, SHORTCUTS } from "../../lib/shortcuts";
import { useUiStore } from "../../stores/ui-store";
import { Button } from "./Button";

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

/** Every keyboard shortcut by area, opened with `?` or from the File menu. */
export function ShortcutsDialog() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={t("shortcuts.title")}
      onClose={() => setOpen(false)}
      onMouseDown={(e) => e.target === ref.current && setOpen(false)}
      className="m-auto w-[640px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <h2 className="text-sm font-semibold">{t("shortcuts.title")}</h2>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={() => setOpen(false)}
          className="rounded p-1 hover:bg-[var(--hover)]"
        >
          <X size={14} />
        </button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-4 py-3" data-testid="shortcuts-list">
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
      </div>
      <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5">
        <span className="text-[var(--muted)]">{t("shortcuts.hint")}</span>
        <Button size="md" onClick={() => setOpen(false)}>
          {t("common.close")}
        </Button>
      </div>
    </dialog>
  );
}
