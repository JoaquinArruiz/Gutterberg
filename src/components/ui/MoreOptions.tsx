import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePreferencesStore } from "../../stores/preferences-store";

/**
 * The less used options of a section, folded behind "More options" so the section shows what most people change.
 * Whether it is open is remembered per `id`, like a section. Until the user touches it, it starts open when one of
 * its options is changed from its default (`changed` > 0), and folded it still says how many are, so a setting in
 * use is never out of sight without a word.
 */
export function MoreOptions({ id, changed, children }: { id: string; changed: number; children: React.ReactNode }) {
  const { t } = useTranslation();
  const key = `${id}.more`;
  const stored = usePreferencesStore((s) => s.prefs.inspector.sections[key]);
  const setSectionOpen = usePreferencesStore((s) => s.setSectionOpen);
  const open = stored ?? changed > 0;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setSectionOpen(key, !open)}
        className="flex items-center gap-1 self-start text-[11px] text-[var(--muted)] hover:text-[var(--fg)]"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {open ? t("common.fewerOptions") : t("common.moreOptions")}
        {!open && changed > 0 && <span>· {t("common.optionsChanged", { count: changed })}</span>}
      </button>
      {open && children}
    </>
  );
}

/** How many of `checks` are true: the options of a fold that differ from their defaults. */
export const countChanged = (...checks: boolean[]) => checks.filter(Boolean).length;
