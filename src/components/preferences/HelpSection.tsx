import { useTranslation } from "react-i18next";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { Button } from "../ui/Button";
import { ShortcutsList } from "../ui/ShortcutsList";
import { Switch } from "../ui/Switch";
import { Field } from "./Field";

/**
 * Preferences › Help: everything about learning the app. The welcome tour, the help tips that were closed, and the
 * keyboard shortcuts. How to report a bug is in About (`BugReportField`).
 */
export function HelpSection() {
  const { t } = useTranslation();
  const hiddenTips = usePreferencesStore((s) => Object.keys(s.prefs.help.dismissedHints).length);
  const tipsOn = usePreferencesStore((s) => s.prefs.help.tipsOn);
  const setTipsOn = usePreferencesStore((s) => s.setTipsOn);
  const resetHints = usePreferencesStore((s) => s.resetHints);
  const setPrefsOpen = useUiStore((s) => s.setPrefsOpen);
  const setWelcomeOpen = useUiStore((s) => s.setWelcomeOpen);
  const replay = () => {
    // The tour opens over everything, so Preferences steps aside first.
    setPrefsOpen(false);
    setWelcomeOpen(true);
  };

  return (
    <>
      <Field label={t("preferences.help.welcome")}>
        <p className="text-[var(--muted)]">{t("preferences.help.welcomeNote")}</p>
        <div>
          <Button size="md" onClick={replay}>
            {t("preferences.help.replayWelcome")}
          </Button>
        </div>
      </Field>

      <Field label={t("preferences.help.tips")} target="helpTips">
        <Switch checked={tipsOn} onChange={setTipsOn} label={t("preferences.help.showTips")} />
        <div>
          <Button size="md" disabled={!tipsOn || hiddenTips === 0} onClick={resetHints}>
            {t("preferences.help.enableTips")}
          </Button>
        </div>
        <p className="text-[var(--muted)]">
          {!tipsOn
            ? t("preferences.help.tipsOff")
            : hiddenTips === 0
              ? t("preferences.help.allTipsOn")
              : t("preferences.help.tipsHidden", { count: hiddenTips })}
        </p>
      </Field>

      <Field label={t("preferences.help.shortcuts")}>
        <p className="text-[var(--muted)]">{t("shortcuts.hint")}</p>
        <div className="rounded border border-[var(--border)] px-3 py-2" data-testid="help-shortcuts">
          <ShortcutsList />
        </div>
      </Field>
    </>
  );
}
