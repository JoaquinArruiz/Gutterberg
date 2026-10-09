import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { t } from "../i18n";
import { usePreferencesStore } from "../stores/preferences-store";
import { useToastStore } from "../stores/toast-store";
import { useUiStore } from "../stores/ui-store";
import { useUpdateStore } from "../stores/update-store";
import { saveBeforeRestart } from "./project-actions";
import { afterUpdate, CHECK_DELAY_MS, CHECK_EVERY_MS, shouldNotify } from "./updates";

/** The updater's handle on the version found, kept to install it (it is not plain data, so it stays out of the store). */
let found: Update | null = null;

const prefs = () => usePreferencesStore.getState();
const state = () => useUpdateStore.getState();
const toast = () => useToastStore.getState();

/** Opens Preferences › Updates. */
export const showUpdates = () => useUiStore.getState().setPrefsOpen(true, "Updates");

/**
 * Asks whether a newer version exists. `manual` is the button in Preferences: it shows the result either way,
 * including a failure. The automatic check (`manual: false`) stays silent when it fails or finds nothing, and
 * only a version the user wants to hear about (see `shouldNotify`) gets a toast.
 */
export async function checkForUpdates(manual: boolean): Promise<void> {
  const busy = state().status;
  if (busy === "checking" || busy === "downloading") return;
  state().set({ status: "checking", manual, progress: null });
  try {
    const update = await check();
    prefs().setLastCheck(Date.now());
    if (!update) {
      found = null;
      state().set({ status: "upToDate", update: null });
      return;
    }
    found = update;
    state().set({ status: "available", update: { version: update.version, notes: update.body ?? "" } });
    const current = await getVersion();
    if (!manual && shouldNotify(current, update.version, prefs().prefs.updates)) announce(update.version);
  } catch {
    found = null;
    state().set({ status: manual ? "error" : "idle", update: null });
  }
}

/** The "update available" toast. */
function announce(version: string) {
  toast().show({
    title: t("updates.toast.available", { version }),
    actions: [
      { label: t("updates.toast.whatsNew"), onClick: showUpdates },
      {
        label: t("updates.toast.update"),
        onClick: () => {
          showUpdates();
          void installUpdate();
        },
      },
      { label: t("updates.toast.skip"), onClick: () => prefs().skipVersion(version) },
    ],
  });
}

/**
 * Downloads and installs the version found. The project is saved first if it has unsaved changes (on Windows the
 * installer closes the app), and the version is written down so the next start can say whether it worked.
 */
export async function installUpdate(): Promise<void> {
  const { update, status } = state();
  if (!found || !update || status === "downloading") return;
  if (!(await saveBeforeRestart())) return;
  const handle = found;
  prefs().setPendingUpdate({ version: update.version, notes: update.notes });
  state().set({ status: "downloading", progress: { done: 0, total: null } });
  try {
    await handle.downloadAndInstall((event) => {
      const { progress } = state();
      if (event.event === "Started") state().set({ progress: { done: 0, total: event.data.contentLength ?? null } });
      else if (event.event === "Progress" && progress)
        state().set({ progress: { ...progress, done: progress.done + event.data.chunkLength } });
    });
    state().set({ status: "ready", progress: null });
  } catch {
    prefs().setPendingUpdate(null);
    state().set({ status: "error", progress: null });
  }
}

/** Restarts into the installed version, after saving the project if it changed since. */
export async function restartNow(): Promise<void> {
  if (!(await saveBeforeRestart())) return;
  await relaunch();
}

/** "Try again" after an update that did not finish: look again and install what is found. */
export async function retryUpdate(): Promise<void> {
  showUpdates();
  await checkForUpdates(true);
  if (state().status === "available") await installUpdate();
}

/** Tells the user how the last update went, once, then remembers the version that is running. */
export async function reportLastUpdate(): Promise<void> {
  let current: string;
  try {
    current = await getVersion();
  } catch {
    return; // outside the app window there is no version to compare
  }
  const outcome = afterUpdate(current, prefs().prefs.updates);
  if (outcome.kind === "updated") {
    state().set({ whatsNew: { version: outcome.version, notes: outcome.notes } });
    toast().show({
      title: t("updates.toast.updated", { version: outcome.version }),
      actions: [{ label: t("updates.toast.whatsNew"), onClick: showUpdates }],
    });
  } else if (outcome.kind === "failed") {
    toast().show({
      title: t("updates.toast.failed", { version: outcome.version }),
      actions: [{ label: t("updates.toast.tryAgain"), onClick: () => void retryUpdate() }],
    });
  }
  if (prefs().prefs.updates.pending) prefs().setPendingUpdate(null);
  prefs().setLastRunVersion(current);
}

/** How soon the automatic check tries again when an export is running. */
const EXPORT_RETRY_MS = 60_000;

/**
 * At start: tell how the last update went, then check for a new version about 10 seconds in, at most once a
 * day and never during an export. Returns what stops it.
 */
export function startUpdateChecks(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  void reportLastUpdate();
  const attempt = () => {
    if (Date.now() - prefs().prefs.updates.lastCheck < CHECK_EVERY_MS) return;
    if (useUiStore.getState().exporting) {
      timer = setTimeout(attempt, EXPORT_RETRY_MS);
      return;
    }
    void checkForUpdates(false);
  };
  timer = setTimeout(attempt, CHECK_DELAY_MS);
  return () => clearTimeout(timer);
}
