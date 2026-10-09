import { create } from "zustand";

/** A newer version the updater found. */
export type AvailableUpdate = { version: string; notes: string };

export type UpdateStatus =
  | "idle"
  /** A check is running. */
  | "checking"
  /** The last check found nothing newer. */
  | "upToDate"
  | "available"
  | "downloading"
  /** Installed; the app has to restart to run it. */
  | "ready"
  /** The last check or install failed. Offline checks never show this unless the user asked for them. */
  | "error";

type UpdateState = {
  status: UpdateStatus;
  update: AvailableUpdate | null;
  /** Bytes downloaded and the total, when the server says. */
  progress: { done: number; total: number | null } | null;
  /** The notes of the update the app just started on, for "What's new". */
  whatsNew: AvailableUpdate | null;
  /** The last check was asked for by the user (so a failure is shown), not by the timer. */
  manual: boolean;
  set: (patch: Partial<Omit<UpdateState, "set">>) => void;
};

/** What Preferences › Updates shows. Not persisted (the preferences keep what has to survive a restart). */
export const useUpdateStore = create<UpdateState>((set) => ({
  status: "idle",
  update: null,
  progress: null,
  whatsNew: null,
  manual: false,
  set: (patch) => set(patch),
}));
