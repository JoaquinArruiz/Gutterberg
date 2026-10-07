import { useEffect, useRef, useState } from "react";

/** Button + dropdown surface that closes on outside click or Escape. */
export function Popover({
  trigger,
  label,
  children,
  align = "right",
  triggerClassName,
  testId,
}: {
  trigger: React.ReactNode;
  label: string;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  triggerClassName?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative" data-testid={testId}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute top-full z-50 mt-1 min-w-44 rounded border border-[var(--border)] bg-[var(--panel)] p-1 shadow-xl shadow-black/40 ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export const menuItem =
  "flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-[var(--hover)] disabled:opacity-40";
