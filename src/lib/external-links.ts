import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "../i18n";

/**
 * The web addresses the app opens, exactly as written. Together with the bug report address below they are the
 * whole scope of the opener permission in `src-tauri/capabilities/default.json`, so even code that asked for
 * another address could not open it.
 */
export const EXTERNAL_LINKS = {
  linkedin: "https://www.linkedin.com/in/joaquinarruiz",
  github: "https://github.com/JoaquinArruiz",
} as const;

/**
 * The GitHub issue form for a bug. Its address changes with the version and system the app fills in, so this one
 * is allowed by its start: `BUG_REPORT_URL` followed by `&` and the fields. The ids (`version`, `os`) are those of
 * `.github/ISSUE_TEMPLATE/bug_report.yml`.
 */
export const BUG_REPORT_URL = "https://github.com/JoaquinArruiz/Gutterberg/issues/new?template=bug_report.yml";

/** The community's Discord invitation; null until there is one, and the button stays off. */
export const DISCORD_URL: string | null = null;

/** The issue form's address with the version and the system filled in. */
export const bugReportUrl = (fields: { version: string; os: string }): string =>
  `${BUG_REPORT_URL}&version=${encodeURIComponent(fields.version)}&os=${encodeURIComponent(fields.os)}`;

const EXACT: readonly string[] = [...Object.values(EXTERNAL_LINKS), ...(DISCORD_URL ? [DISCORD_URL] : [])];

/** Whether the app may open `url`: one of the exact addresses, or the bug report form with fields after it. */
export function isAllowedLink(url: string): boolean {
  if (EXACT.includes(url)) return true;
  if (!url.startsWith(`${BUG_REPORT_URL}&`)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.host === "github.com" && !parsed.hash;
  } catch {
    return false;
  }
}

/** What `openExternalLink` did: opened it, the user said Cancel, or the address is not one the app may open. */
export type OpenOutcome = "opened" | "cancelled" | "refused";

/**
 * Opens one of the allowed links in the web browser, but only after a native dialog has shown the exact
 * address and the user has pressed Open. An address that is not in the list is refused without asking.
 */
export async function openExternalLink(url: string): Promise<OpenOutcome> {
  if (!isAllowedLink(url)) return "refused";
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
