import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AppInfo, formatAppInfo, loadAppInfo } from "../../lib/app-info";
import { bugReportUrl, DISCORD_URL, openExternalLink } from "../../lib/external-links";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { DiscordIcon, GitHubIcon } from "../ui/BrandIcons";
import { Button } from "../ui/Button";
import { ShortcutsList } from "../ui/ShortcutsList";
import { Field } from "./Field";

const COPIED_FOR_MS = 2000;

/**
 * Preferences › Help: everything about learning the app and asking for help. The welcome tour, the help tips that
 * were closed, the keyboard shortcuts, and how to report a bug (the version and system are copied or sent in the
 * address of the GitHub issue form, which asks before it opens).
 */
export function HelpSection() {
  const { t, i18n } = useTranslation();
  const hiddenTips = usePreferencesStore((s) => Object.keys(s.prefs.help.dismissedHints).length);
  const resetHints = usePreferencesStore((s) => s.resetHints);
  const setPrefsOpen = useUiStore((s) => s.setPrefsOpen);
  const setWelcomeOpen = useUiStore((s) => s.setWelcomeOpen);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState<"copy" | "open" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const language = i18n.resolvedLanguage ?? i18n.language;

  useEffect(() => {
    let live = true;
    loadAppInfo(language)
      .then((i) => live && setInfo(i))
      .catch(() => {}); // outside the app window there is no version or system to read
    return () => {
      live = false;
      clearTimeout(timer.current);
    };
  }, [language]);

  const copy = async () => {
    if (!info) return;
    setFailed(null);
    try {
      await navigator.clipboard.writeText(formatAppInfo(info));
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    } catch {
      setFailed("copy");
    }
  };

  const report = async () => {
    if (!info) return;
    setFailed(null);
    try {
      if ((await openExternalLink(bugReportUrl({ version: info.version, os: info.os }))) === "refused")
        setFailed("open");
    } catch {
      setFailed("open");
    }
  };

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

      <Field label={t("preferences.help.tips")}>
        <div>
          <Button size="md" disabled={hiddenTips === 0} onClick={resetHints}>
            {t("preferences.help.enableTips")}
          </Button>
        </div>
        <p className="text-[var(--muted)]">
          {hiddenTips === 0 ? t("preferences.help.allTipsOn") : t("preferences.help.tipsHidden", { count: hiddenTips })}
        </p>
      </Field>

      <Field label={t("preferences.help.shortcuts")}>
        <p className="text-[var(--muted)]">{t("shortcuts.hint")}</p>
        <div className="rounded border border-[var(--border)] px-3 py-2" data-testid="help-shortcuts">
          <ShortcutsList />
        </div>
      </Field>

      <Field label={t("preferences.help.bug")}>
        <p>{t("preferences.help.bugIntro")}</p>
        <ul className="list-disc pl-5 text-[var(--muted)]">
          <li>{t("preferences.help.bugVersion")}</li>
          <li>{t("preferences.help.bugSteps")}</li>
          <li>{t("preferences.help.bugExpected")}</li>
          <li>{t("preferences.help.bugWorkaround")}</li>
        </ul>
        <p
          className="mt-1 select-text break-words rounded bg-[var(--bg)] px-2 py-1.5 font-mono text-[11px]"
          data-testid="app-info"
        >
          {info ? formatAppInfo(info) : t("preferences.help.infoUnavailable")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="md" className="flex items-center gap-2" disabled={!info} onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t("preferences.help.copied") : t("preferences.help.copyInfo")}
          </Button>
          <Button size="md" className="flex items-center gap-2" disabled={!info} onClick={() => void report()}>
            <GitHubIcon />
            {t("preferences.help.report")}
          </Button>
          <Button
            size="md"
            className="flex items-center gap-2"
            disabled={DISCORD_URL === null}
            title={DISCORD_URL === null ? t("preferences.help.discordSoon") : undefined}
            onClick={() => DISCORD_URL && void openExternalLink(DISCORD_URL)}
          >
            <DiscordIcon />
            {t("preferences.help.discord")}
            {DISCORD_URL === null && (
              <span className="font-normal opacity-70">{t("preferences.help.discordSoon")}</span>
            )}
          </Button>
        </div>
        {failed && (
          <p className="text-red-300" role="alert">
            ⚠ {failed === "copy" ? t("preferences.help.copyFailed") : t("preferences.about.openFailed")}
          </p>
        )}
      </Field>
    </>
  );
}
