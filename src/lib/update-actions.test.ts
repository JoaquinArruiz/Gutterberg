import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "../stores/preferences-store";
import { useToastStore } from "../stores/toast-store";
import { useUiStore } from "../stores/ui-store";
import { useUpdateStore } from "../stores/update-store";
import { DEFAULT_PREFERENCES } from "./preferences";
import { CHECK_DELAY_MS, CHECK_EVERY_MS } from "./updates";

const { getVersion, check, relaunch, saveBeforeRestart } = vi.hoisted(() => ({
  getVersion: vi.fn(),
  check: vi.fn(),
  relaunch: vi.fn(),
  saveBeforeRestart: vi.fn(),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));
vi.mock("./project-actions", () => ({ saveBeforeRestart }));

import { checkForUpdates, installUpdate, reportLastUpdate, restartNow, startUpdateChecks } from "./update-actions";

const found = (version: string, body = "- Better") => ({
  version,
  body,
  downloadAndInstall: vi.fn().mockResolvedValue(undefined),
});
const toasts = () => useToastStore.getState().queue.map((t) => t.title);
const updates = () => usePreferencesStore.getState().prefs.updates;
const setUpdates = (patch: Partial<typeof DEFAULT_PREFERENCES.updates>) =>
  usePreferencesStore.setState({
    prefs: { ...DEFAULT_PREFERENCES, updates: { ...DEFAULT_PREFERENCES.updates, ...patch } },
  });

beforeEach(() => {
  getVersion.mockReset().mockResolvedValue("1.1.0");
  check.mockReset().mockResolvedValue(null);
  relaunch.mockReset().mockResolvedValue(undefined);
  saveBeforeRestart.mockReset().mockResolvedValue(true);
  usePreferencesStore.setState({ prefs: DEFAULT_PREFERENCES });
  useToastStore.setState({ queue: [] });
  useUiStore.setState({ exporting: false, prefsOpen: false, prefsSection: null });
  useUpdateStore.setState({ status: "idle", update: null, progress: null, whatsNew: null, manual: false });
});
afterEach(() => vi.useRealTimers());

describe("checking for updates", () => {
  it("announces a newer version with a toast that has What's new, Update and Skip", async () => {
    check.mockResolvedValue(found("1.2.0"));
    await checkForUpdates(false);
    expect(toasts()).toEqual(["Gutterberg 1.2.0 is available"]);
    expect(useToastStore.getState().queue[0].actions?.map((a) => a.label)).toEqual([
      "What's new",
      "Update",
      "Skip this version",
    ]);
    expect(useUpdateStore.getState()).toMatchObject({
      status: "available",
      update: { version: "1.2.0", notes: "- Better" },
    });
    expect(updates().lastCheck).toBeGreaterThan(0);
  });

  it("What's new opens Preferences › Updates, and Skip remembers the version", async () => {
    check.mockResolvedValue(found("1.2.0"));
    await checkForUpdates(false);
    const [whatsNew, , skip] = useToastStore.getState().queue[0].actions ?? [];
    whatsNew.onClick();
    expect(useUiStore.getState()).toMatchObject({ prefsOpen: true, prefsSection: "Updates" });
    skip.onClick();
    expect(updates().skippedVersion).toBe("1.2.0");
    useToastStore.setState({ queue: [] });
    await checkForUpdates(false);
    expect(toasts()).toEqual([]);
  });

  it("obeys Tell me about, but the section still has the update", async () => {
    setUpdates({ notify: "major" });
    check.mockResolvedValue(found("1.1.1"));
    await checkForUpdates(false);
    expect(toasts()).toEqual([]);
    expect(useUpdateStore.getState().update?.version).toBe("1.1.1");
  });

  it("never toasts for a check the user asked for", async () => {
    check.mockResolvedValue(found("1.2.0"));
    await checkForUpdates(true);
    expect(toasts()).toEqual([]);
    expect(useUpdateStore.getState().status).toBe("available");
  });

  it("says up to date when there is nothing newer", async () => {
    await checkForUpdates(true);
    expect(useUpdateStore.getState().status).toBe("upToDate");
  });

  it("stays silent when the automatic check fails, and shows the failure after a manual one", async () => {
    check.mockRejectedValue(new Error("offline"));
    await checkForUpdates(false);
    expect(useUpdateStore.getState().status).toBe("idle");
    expect(toasts()).toEqual([]);
    expect(updates().lastCheck).toBe(0);
    await checkForUpdates(true);
    expect(useUpdateStore.getState().status).toBe("error");
  });
});

describe("the automatic check", () => {
  it("runs about 10 seconds after start", async () => {
    vi.useFakeTimers();
    startUpdateChecks();
    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS - 1);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledOnce();
  });

  it("runs at most once a day", async () => {
    vi.useFakeTimers();
    setUpdates({ lastCheck: Date.now() - CHECK_EVERY_MS + 60_000 });
    startUpdateChecks();
    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 1);
    expect(check).not.toHaveBeenCalled();
  });

  it("waits while an export runs", async () => {
    vi.useFakeTimers();
    useUiStore.setState({ exporting: true });
    startUpdateChecks();
    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 1);
    expect(check).not.toHaveBeenCalled();
    useUiStore.setState({ exporting: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledOnce();
  });

  it("can be stopped", async () => {
    vi.useFakeTimers();
    startUpdateChecks()();
    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS * 2);
    expect(check).not.toHaveBeenCalled();
  });
});

describe("installing", () => {
  it("saves first, writes down the version being installed, downloads with progress and then waits for a restart", async () => {
    const update = found("1.2.0", "- Better");
    update.downloadAndInstall.mockImplementation(async (on: (e: unknown) => void) => {
      on({ event: "Started", data: { contentLength: 100 } });
      on({ event: "Progress", data: { chunkLength: 40 } });
      expect(useUpdateStore.getState().progress).toEqual({ done: 40, total: 100 });
      expect(updates().pending).toEqual({ version: "1.2.0", notes: "- Better" });
      on({ event: "Finished" });
    });
    check.mockResolvedValue(update);
    await checkForUpdates(true);
    await installUpdate();
    expect(saveBeforeRestart).toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe("ready");
    expect(relaunch).not.toHaveBeenCalled();
    await restartNow();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("does nothing when the user keeps unsaved changes", async () => {
    saveBeforeRestart.mockResolvedValue(false);
    const update = found("1.2.0");
    check.mockResolvedValue(update);
    await checkForUpdates(true);
    await installUpdate();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(updates().pending).toBeNull();
    await restartNow();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("forgets the record when the download fails", async () => {
    const update = found("1.2.0");
    update.downloadAndInstall.mockRejectedValue(new Error("cut"));
    check.mockResolvedValue(update);
    await checkForUpdates(true);
    await installUpdate();
    expect(useUpdateStore.getState().status).toBe("error");
    expect(updates().pending).toBeNull();
  });
});

describe("after an update", () => {
  it("says Updated to X with the saved notes, once", async () => {
    setUpdates({ pending: { version: "1.1.0", notes: "- Better" }, lastRunVersion: "1.0.0" });
    await reportLastUpdate();
    expect(toasts()).toEqual(["Updated to 1.1.0"]);
    expect(useUpdateStore.getState().whatsNew).toEqual({ version: "1.1.0", notes: "- Better" });
    expect(updates()).toMatchObject({ pending: null, lastRunVersion: "1.1.0" });
    useToastStore.setState({ queue: [] });
    await reportLastUpdate();
    expect(toasts()).toEqual([]);
  });

  it("says the update didn't finish, with Try again, when the old version is still running", async () => {
    setUpdates({ pending: { version: "1.2.0", notes: "" }, lastRunVersion: "1.1.0" });
    await reportLastUpdate();
    expect(toasts()).toEqual(["The update to 1.2.0 didn't finish"]);
    expect(useToastStore.getState().queue[0].actions?.map((a) => a.label)).toEqual(["Try again"]);
    expect(updates().pending).toBeNull();
  });

  it("says nothing on a first install, and remembers the version", async () => {
    await reportLastUpdate();
    expect(toasts()).toEqual([]);
    expect(updates().lastRunVersion).toBe("1.1.0");
  });

  it("says nothing outside the app window", async () => {
    getVersion.mockRejectedValue(new Error("no app"));
    setUpdates({ pending: { version: "1.1.0", notes: "" } });
    await reportLastUpdate();
    expect(toasts()).toEqual([]);
  });
});
