import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useUiStore } from "../stores/ui-store";
import { openProjectDialog } from "./project-actions";

/**
 * Opens the project the system asked for: the file the app was started with (double-clicked, or passed as an
 * argument), and later ones that macOS sends to the running app. The welcome tour waits while the question is
 * answered, so it never opens over a project that is about to load. Call it before `useWelcomeAutoOpen`.
 */
export function useOpenedFiles() {
  useEffect(() => {
    const ui = useUiStore.getState();
    ui.deferWelcome(true);
    let stop: (() => void) | undefined;
    let live = true;
    (async () => {
      try {
        // Listening starts before asking: the app only sends events once it has been asked, so no file is lost.
        const off = await listen<string>("opened-file", (e) => void openProjectDialog(e.payload));
        if (live) stop = off;
        else off();
        const first = await invoke<string | null>("take_opened_file");
        if (first) await openProjectDialog(first);
      } catch {
        /* outside the app window there is no file to open */
      } finally {
        if (live) ui.deferWelcome(false);
      }
    })();
    return () => {
      live = false;
      stop?.();
    };
  }, []);
}
