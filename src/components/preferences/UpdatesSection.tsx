import { useTranslation } from "react-i18next";
import { useAppVersion } from "../../lib/app-info";
import { checkForUpdates, installUpdate, restartNow } from "../../lib/update-actions";
import { UPDATE_NOTIFY, type UpdateNotify } from "../../lib/updates";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUpdateStore } from "../../stores/update-store";
import { Button } from "../ui/Button";
import { RadioCard, RadioCardGroup } from "../ui/RadioCard";
import { ReleaseNotes } from "../ui/ReleaseNotes";
import { Field } from "./Field";

const NOTIFY_KEY = {
  all: "notifyAll",
  features: "notifyFeatures",
  major: "notifyMajor",
  never: "notifyNever",
} as const satisfies Record<UpdateNotify, string>;

/**
 * Preferences › Updates: the version you have, a newer one when there is one (with its notes), the button to check
 * and to install, and what the toast should tell you about. This section always shows a newer version; "Tell me
 * about" only decides whether a toast says so.
 */
export function UpdatesSection() {
  const { t, i18n } = useTranslation();
  const version = useAppVersion();
  const notify = usePreferencesStore((s) => s.prefs.updates.notify);
  const lastCheck = usePreferencesStore((s) => s.prefs.updates.lastCheck);
  const setNotify = usePreferencesStore((s) => s.setUpdateNotify);
  const status = useUpdateStore((s) => s.status);
  const update = useUpdateStore((s) => s.update);
  const progress = useUpdateStore((s) => s.progress);
  const whatsNew = useUpdateStore((s) => s.whatsNew);

  const busy = status === "checking" || status === "downloading";
  const percent = progress?.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  const last = lastCheck
    ? new Date(lastCheck).toLocaleString(i18n.resolvedLanguage ?? i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : t("preferences.updates.never");

  return (
    <>
      <Field label={t("preferences.updates.current")}>
        <p data-testid="current-version">
          {version ? t("preferences.updates.youHave", { version }) : t("preferences.updates.versionUnknown")}
        </p>

        {status === "checking" && <p className="text-[var(--muted)]">{t("preferences.updates.checking")}</p>}
        {status === "upToDate" && <p className="text-[var(--muted)]">{t("preferences.updates.upToDate")}</p>}
        {status === "error" && (
          <p className="text-red-300" role="alert">
            ⚠ {t("preferences.updates.failed")}
          </p>
        )}

        {update && status !== "upToDate" && (
          <div className="flex flex-col gap-1.5 rounded border border-[var(--border)] px-3 py-2">
            <p className="font-semibold">{t("preferences.updates.available", { version: update.version })}</p>
            {update.notes.trim() && (
              <>
                <p className="text-[var(--muted)]">
                  {t("preferences.updates.whatsNewIn", { version: update.version })}
                </p>
                <ReleaseNotes notes={update.notes} />
              </>
            )}
          </div>
        )}

        {status === "downloading" && (
          <div className="flex flex-col gap-1">
            <progress
              className="w-full"
              max={100}
              value={percent ?? undefined}
              aria-label={t("preferences.updates.downloading")}
            />
            <p className="text-[var(--muted)]">
              {percent === null ? t("preferences.updates.downloading") : t("preferences.updates.progress", { percent })}
            </p>
          </div>
        )}

        {status === "ready" && (
          <p role="status">{t("preferences.updates.installed", { version: update?.version ?? "" })}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="md" disabled={busy} onClick={() => void checkForUpdates(true)}>
            {t("preferences.updates.check")}
          </Button>
          {(status === "available" || status === "downloading") && update && (
            <Button size="md" variant="primary" disabled={busy} onClick={() => void installUpdate()}>
              {t("preferences.updates.install")}
            </Button>
          )}
          {status === "ready" && (
            <>
              <Button size="md" variant="primary" onClick={() => void restartNow()}>
                {t("preferences.updates.restartNow")}
              </Button>
              <Button size="md" onClick={() => useUpdateStore.getState().set({ status: "idle" })}>
                {t("preferences.updates.later")}
              </Button>
            </>
          )}
        </div>
        <p className="text-[var(--muted)]">{t("preferences.updates.lastChecked", { when: last })}</p>
      </Field>

      {whatsNew && (
        <Field label={t("preferences.updates.whatsNewIn", { version: whatsNew.version })}>
          <ReleaseNotes notes={whatsNew.notes} />
        </Field>
      )}

      <Field label={t("preferences.updates.tellMe")}>
        <RadioCardGroup<UpdateNotify> label={t("preferences.updates.tellMe")} value={notify} onChange={setNotify}>
          {UPDATE_NOTIFY.map((n) => (
            <RadioCard
              key={n}
              value={n}
              title={t(`preferences.updates.${NOTIFY_KEY[n]}`)}
              description={t(`preferences.updates.${NOTIFY_KEY[n]}Hint`)}
            />
          ))}
        </RadioCardGroup>
        <p className="text-[var(--muted)]">{t("preferences.updates.tellMeNote")}</p>
      </Field>
    </>
  );
}
