import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AppInfo, formatAppInfo, loadAppInfo, loadLog } from "../../lib/app-info";
import { bugReportUrl, DISCORD_URL, openExternalLink } from "../../lib/external-links";
import { emitHintEvent } from "../../lib/hint-events";
import { DiscordIcon, GitHubIcon } from "../ui/BrandIcons";
import { Button } from "../ui/Button";
import { Field } from "./Field";

const COPIED_FOR_MS = 2000;

/**
 * Preferences › About › Found a bug?: what to put in a report, and buttons that copy the app info and the log or open
 * the GitHub issue form with the version and system in its address (the link asks before it opens).
 */
export function BugReportField() {
  const { t, i18n } = useTranslation();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState<"copy" | "open" | null>(null);
  // "Copy log": what the last press did (the log may not exist yet, or may not be readable).
  const [log, setLog] = useState<"copied" | "empty" | "failed" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const logTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const language = i18n.resolvedLanguage ?? i18n.language;

  useEffect(() => {
    let live = true;
    loadAppInfo(language)
      .then((i) => live && setInfo(i))
      .catch(() => {}); // outside the app window there is no version or system to read
    return () => {
      live = false;
      clearTimeout(timer.current);
      clearTimeout(logTimer.current);
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

  const copyLog = async () => {
    setLog(null);
    try {
      const text = await loadLog();
      if (!text.trim()) return setLog("empty");
      await navigator.clipboard.writeText(text);
      setLog("copied");
      emitHintEvent("log-copied");
      clearTimeout(logTimer.current);
      logTimer.current = setTimeout(() => setLog(null), COPIED_FOR_MS);
    } catch {
      setLog("failed");
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

  return (
    <Field label={t("preferences.help.bug")} info={t("preferences.help.logNote")} target="bugReport">
      <p>{t("preferences.help.bugIntro")}</p>
      <ul className="list-disc pl-5 text-[var(--muted)]">
        <li>{t("preferences.help.bugVersion")}</li>
        <li>{t("preferences.help.bugSteps")}</li>
        <li>{t("preferences.help.bugExpected")}</li>
        <li>{t("preferences.help.bugWorkaround")}</li>
        <li>{t("preferences.help.bugLog")}</li>
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
        <Button size="md" className="flex items-center gap-2" onClick={() => void copyLog()}>
          {log === "copied" ? <Check size={14} /> : <Copy size={14} />}
          {log === "copied" ? t("preferences.help.copied") : t("preferences.help.copyLog")}
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
          {DISCORD_URL === null && <span className="font-normal opacity-70">{t("preferences.help.discordSoon")}</span>}
        </Button>
      </div>
      {log === "empty" && <p className="text-[var(--muted)]">{t("preferences.help.logEmpty")}</p>}
      {log === "failed" && (
        <p className="text-red-300" role="alert">
          {t("preferences.help.logFailed")}
        </p>
      )}
      {failed && (
        <p className="text-red-300" role="alert">
          ⚠ {failed === "copy" ? t("preferences.help.copyFailed") : t("preferences.about.openFailed")}
        </p>
      )}
    </Field>
  );
}
