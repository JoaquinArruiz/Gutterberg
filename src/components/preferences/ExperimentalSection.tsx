import { useTranslation } from "react-i18next";
import { EXPERIMENTAL, type ExperimentalDef } from "../../lib/experimental";
import { usePreferencesStore } from "../../stores/preferences-store";
import { Switch } from "../ui/Switch";
import { Field } from "./Field";

/** Preferences › Experimental: one switch per unfinished feature in `src/lib/experimental.ts`, all off until set. */
export function ExperimentalSection({ features = EXPERIMENTAL }: { features?: readonly ExperimentalDef[] }) {
  const { t } = useTranslation();
  const flags = usePreferencesStore((s) => s.prefs.experimental.flags);
  const setExperimental = usePreferencesStore((s) => s.setExperimental);
  return (
    <Field label={t("preferences.experimental.title")}>
      <p className="text-[var(--muted)]">{t("preferences.experimental.note")}</p>
      {features.map((f) => (
        <div key={f.id} className="flex flex-col gap-0.5">
          <Switch
            checked={flags[f.id] === true}
            onChange={(on) => setExperimental(f.id, on)}
            // The catalog's keys are typed, but a feature's own texts are added with it.
            label={(t as (key: string) => string)(f.title)}
          />
          <p className="pl-1 text-[var(--muted)]">{(t as (key: string) => string)(f.text)}</p>
        </div>
      ))}
    </Field>
  );
}
