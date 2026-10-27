import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { confirmClose } from "./project-actions";

/**
 * Closing the window with unsaved changes asks first (`confirmClose`): Save, Don't save or Cancel. Cancel, or a
 * cancelled save, keeps the window open. Outside the app window (tests, a browser) there is nothing to guard.
 */
export function useCloseGuard() {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let live = true;
    try {
      getCurrentWindow()
        .onCloseRequested(async (event) => {
          if (!(await confirmClose())) event.preventDefault();
        })
        .then((stop) => {
          if (live) unlisten = stop;
          else stop();
        })
        .catch(() => {});
    } catch {
      // not in the app window
    }
    return () => {
      live = false;
      unlisten?.();
    };
  }, []);
}
