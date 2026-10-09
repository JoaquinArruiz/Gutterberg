import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "../i18n";

/**
 * The only web addresses the app opens. The same two are the whole scope of the opener permission in
 * `src-tauri/capabilities/default.json`, so even code that asked for another address could not open it.
 */
export const ABOUT_LINKS = {
  linkedin: "https://www.linkedin.com/in/joaquinarruiz",
  github: "https://github.com/JoaquinArruiz",
} as const;

const ALLOWED: readonly string[] = Object.values(ABOUT_LINKS);

/** What `openExternalLink` did: opened it, the user said Cancel, or the address is not one the app may open. */
export type OpenOutcome = "opened" | "cancelled" | "refused";

/**
 * Opens one of the About links in the web browser, but only after a native dialog has shown the exact
 * address and the user has pressed Open. An address that is not in the list is refused without asking.
 */
export async function openExternalLink(url: string): Promise<OpenOutcome> {
  if (!ALLOWED.includes(url)) return "refused";
  const ok = await ask(`${t("preferences.about.openBrowser")}\n${url}`, {
    title: t("preferences.about.openTitle"),
    kind: "info",
    okLabel: t("preferences.about.open"),
    cancelLabel: t("common.cancel"),
  });
  if (!ok) return "cancelled";
  await openUrl(url);
  return "opened";
}
