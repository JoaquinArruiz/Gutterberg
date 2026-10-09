import { ChevronDown, ChevronRight } from "lucide-react";
import { usePreferencesStore } from "../../stores/preferences-store";
import { InfoTip } from "./InfoTip";

/**
 * An inspector section the user can fold. Whether it is open is remembered per section `id` (a
 * per-viewer preference, like the panel layout); until the user touches it, `defaultOpen` applies.
 */
export function CollapsibleSection({
  id,
  title,
  defaultOpen = true,
  info,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  /** One-line explanation of the section, behind an InfoTip after the title. */
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  const stored = usePreferencesStore((s) => s.prefs.inspector.sections[id]);
  const setSectionOpen = usePreferencesStore((s) => s.setSectionOpen);
  const open = stored ?? defaultOpen;
  return (
    <section className="mb-3 border-b border-[var(--border)] pb-2 last:border-b-0" data-testid={`section-${id}`}>
      <div className="mb-1.5 flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`section-body-${id}`}
          onClick={() => setSectionOpen(id, !open)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] hover:text-[var(--fg)]"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
        </button>
        {info && <InfoTip text={info} />}
      </div>
      {open && (
        <div id={`section-body-${id}`} className="flex flex-col gap-1.5">
          {children}
        </div>
      )}
    </section>
  );
}
