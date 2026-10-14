import { useTranslation } from "react-i18next";
import { LANGUAGE_NAME, LANGUAGES, type LanguagePreference } from "../../lib/locale";
import { MEASUREMENT_UNITS, type MeasurementUnit } from "../../lib/measurement";
import { THEMES, type ThemePreference } from "../../lib/preferences";
import { usePreferencesStore } from "../../stores/preferences-store";
import { Segmented } from "../ui/Segmented";

/** The unit people around the user measure in: inches in the United States, millimetres elsewhere. */
export function usualUnit(locale: string): MeasurementUnit {
  return locale.split(/[-_]/)[1]?.toUpperCase() === "US" ? "in" : "mm";
}

/**
 * The welcome's first step, on the first start only: language, theme and units, before the tour so the tour is
 * already in the chosen language and colours. Each choice applies at once and is saved like any preference; all of
 * them stay in Preferences.
 */
export function WelcomeSetup() {
  const { t } = useTranslation();
  const language = usePreferencesStore((s) => s.prefs.locale.language);
  const theme = usePreferencesStore((s) => s.prefs.appearance.theme);
  const unit = usePreferencesStore((s) => s.prefs.measurement.unit);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const setUnit = usePreferencesStore((s) => s.setUnit);
  const row = "flex flex-col items-start gap-1.5";
  return (
    <div className="flex flex-col gap-4 px-6 py-6" data-testid="welcome-setup">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{t("welcome.setup.title")}</h2>
        <p className="max-w-[65ch] text-[var(--muted)]">{t("welcome.setup.text")}</p>
      </div>
      <div className={row}>
        <span className="text-[var(--muted)]">{t("welcome.setup.language")}</span>
        <Segmented<LanguagePreference>
          label={t("welcome.setup.language")}
          value={language}
          onChange={setLanguage}
          options={[
            { value: "system", label: t("preferences.general.languageSystem") },
            ...LANGUAGES.map((l) => ({ value: l as LanguagePreference, label: LANGUAGE_NAME[l] })),
          ]}
        />
      </div>
      <div className={row}>
        <span className="text-[var(--muted)]">{t("welcome.setup.theme")}</span>
        <Segmented<ThemePreference>
          label={t("welcome.setup.theme")}
          value={theme}
          onChange={setTheme}
          options={THEMES.map((v) => ({ value: v, label: t(`preferences.appearance.${v}`) }))}
        />
      </div>
      <div className={row}>
        <span className="text-[var(--muted)]">{t("welcome.setup.units")}</span>
        <Segmented<MeasurementUnit>
          label={t("welcome.setup.units")}
          value={unit}
          onChange={setUnit}
          options={MEASUREMENT_UNITS.map((u) => ({ value: u, label: t(`preferences.units.${u}`) }))}
        />
      </div>
      <p className="text-[var(--muted)]">{t("welcome.setup.note")}</p>
    </div>
  );
}
