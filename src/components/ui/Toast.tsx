import { Info, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToastStore } from "../../stores/toast-store";
import { Button } from "./Button";

/**
 * The toast on screen, bottom right, one at a time (see `useToastStore`). Screen readers are told when one
 * appears (`role="status"`), and Esc closes it unless a dialog is open and wants the key.
 */
export function Toast() {
  const { t } = useTranslation();
  const toast = useToastStore((s) => s.queue[0]);
  const dismiss = useToastStore((s) => s.dismiss);
  const id = toast?.id;
  const autoCloseMs = toast?.autoCloseMs;

  useEffect(() => {
    if (id === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open]")) dismiss(id);
    };
    window.addEventListener("keydown", onKey);
    const timer = autoCloseMs ? setTimeout(() => dismiss(id), autoCloseMs) : undefined;
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [id, autoCloseMs, dismiss]);

  if (!toast) return null;
  return (
    <div
      role="status"
      data-testid="toast"
      className="fixed right-4 bottom-10 z-50 flex w-[22rem] max-w-[90vw] items-start gap-2.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 text-[var(--fg)] shadow-xl shadow-black/40"
    >
      <Info size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{toast.title}</p>
        {toast.text && <p className="text-[var(--muted)]">{toast.text}</p>}
        {toast.actions && toast.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {toast.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className="text-[var(--accent)] hover:underline"
                onClick={() => {
                  if (!a.keep) dismiss(toast.id);
                  a.onClick();
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        className="-mr-1 -mt-0.5 shrink-0"
        aria-label={t("toast.close")}
        onClick={() => dismiss(toast.id)}
      >
        <X size={13} />
      </Button>
    </div>
  );
}
