/** A titled group of settings in the Preferences window. */
export const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mb-5">
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{label}</div>
    <div className="flex flex-col gap-1.5">{children}</div>
  </div>
);
