// The recovery copy (card_core::recovery): while the project has unsaved changes it is written every half minute to
// the app's data folder, never over the user's file, so a crash loses little. A save, or closing on purpose,
// removes it; the next start offers whatever an earlier run left (`offerRecovery` in project-actions.ts).

import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { useProjectStore } from "../stores/project-store";
import { toProject } from "./project";
import { currentProjectState, hasUnsavedChanges } from "./project-state";

/** How often the copy is written while there are unsaved changes. */
export const RECOVERY_INTERVAL_MS = 30_000;

/** This run's copy: each running app writes its own, so two windows never overwrite each other's. */
const RUN_ID = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let written = false;

/** A copy found at start: its id, where its project was saved, and the project file's content. */
export type Recovered = { id: string; info: { path: string | null; written: number }; project: unknown };

/**
 * Writes the copy while the project has unsaved changes (every time, so it stays young while this run lives),
 * and removes it once there are none.
 */
export async function keepRecoveryCopy(): Promise<void> {
  const state = hasUnsavedChanges() ? currentProjectState() : null;
  if (!state) return dropRecoveryCopy();
  const path = useProjectStore.getState().path;
  await invoke("write_recovery", { id: RUN_ID, project: toProject(state), path });
  written = true;
}

/** Removes this run's copy, if it wrote one. */
export async function dropRecoveryCopy(): Promise<void> {
  if (!written) return;
  written = false;
  await clearRecovery(RUN_ID);
}

export const clearRecovery = (id: string): Promise<void> => invoke("clear_recovery", { id });

/** The newest copy an earlier run left, or null. */
export const findRecovery = (): Promise<Recovered | null> => invoke<Recovered | null>("find_recovery");

/** Keeps the copy up to date while the app runs. A failed write is tried again at the next tick. */
export function useRecoveryCopy() {
  useEffect(() => {
    const timer = setInterval(() => void keepRecoveryCopy().catch(() => {}), RECOVERY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
