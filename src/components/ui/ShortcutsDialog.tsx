import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "../../stores/ui-store";
import { Button } from "./Button";
import { ShortcutsList } from "./ShortcutsList";

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
        <ShortcutsList />
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
