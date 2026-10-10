import { Link, Unlink } from "lucide-react";

/**
 * A chain icon that links two values (a width and a height, two gaps): pressed when they are linked, so one
 * follows the other. Sits beside the fields it links. `label` names what it links ("Link the gaps"); the tooltip
 * says whether they are linked now.
 */
export function ChainToggle({
  linked,
  onChange,
  label,
  linkedHint,
  unlinkedHint,
}: {
  linked: boolean;
  onChange: (linked: boolean) => void;
  label: string;
  linkedHint: string;
  unlinkedHint: string;
}) {
  const Icon = linked ? Link : Unlink;
  return (
    <button
      type="button"
      aria-pressed={linked}
      aria-label={label}
      title={linked ? linkedHint : unlinkedHint}
      onClick={() => onChange(!linked)}
      className={`grid size-6 shrink-0 place-items-center rounded outline-none hover:bg-[var(--hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${linked ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}
    >
      <Icon size={13} aria-hidden />
    </button>
  );
}

/** Two fields with a chain icon beside them (one field while linked), the chain centred on the pair. */
export function ChainedFields({ chain, children }: { chain: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">{children}</div>
      {chain}
    </div>
  );
}
