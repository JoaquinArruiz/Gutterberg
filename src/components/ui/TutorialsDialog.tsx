import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "../../stores/ui-store";
import { Button } from "./Button";
import { TutorialsList } from "./TutorialsList";

/** The tutorials by group, opened from the Help menu. Picking one closes it and starts the tutorial. */
export function TutorialsDialog() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.tutorialsOpen);
  const setOpen = useUiStore((s) => s.setTutorialsOpen);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Opened to look something up: the search is ready to type in.
      d.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={t("tutorials.title")}
      onClose={() => setOpen(false)}
      onMouseDown={(e) => e.target === ref.current && setOpen(false)}
      className="m-auto w-[520px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <h2 className="text-sm font-semibold">{t("tutorials.title")}</h2>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={() => setOpen(false)}
          className="rounded p-1 hover:bg-[var(--hover)]"
        >
          <X size={14} />
        </button>
      </div>
      <div className="h-[60vh] overflow-y-auto px-4 pb-3" data-testid="tutorials-list">
        {/* Only while open, so the search starts empty each time. */}
        {open && <TutorialsList />}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5">
        <span className="text-[var(--muted)]">{t("tutorials.hint")}</span>
        <Button size="md" onClick={() => setOpen(false)}>
          {t("common.close")}
        </Button>
      </div>
    </dialog>
  );
}
