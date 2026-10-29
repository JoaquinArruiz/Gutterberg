import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import appIcon from "../../../src-tauri/icons/128x128.png";
import { useAppName } from "../../lib/app-info";
import { versionNotes } from "../../lib/changelog";
import { EXTERNAL_LINKS, openExternalLink } from "../../lib/external-links";
import { type LicenseTexts, licenseTexts } from "../../lib/licenses";
import { useUpdateStore } from "../../stores/update-store";
import { GitHubIcon, LinkedInIcon, RefractionHubIcon } from "../ui/BrandIcons";
import { Button } from "../ui/Button";
import { ReleaseNotes } from "../ui/ReleaseNotes";
import { BugReportField } from "./BugReportField";
import { Field } from "./Field";

// The author's own pages.
const LINKS = [
  { id: "linkedin", url: EXTERNAL_LINKS.linkedin, Icon: LinkedInIcon },
  { id: "github", url: EXTERNAL_LINKS.github, Icon: GitHubIcon },
] as const;
// A link to an organization the author shares with friends, not a page of his own: shown apart, after a divider.
const ORG_LINK = { id: "refractionHub", url: EXTERNAL_LINKS.refractionHub, Icon: RefractionHubIcon } as const;

/**
 * The app's name and version, who made it, its links (his own, and one to an organization, each asking before it
 * opens the web browser), where to download it and what changed, how to report a bug, and the license.
 */
export function AboutSection() {
  const { t } = useTranslation();
  const name = useAppName();
  const [version, setVersion] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Which license text is open under "License", and the texts once they were asked for.
  const [shown, setShown] = useState<keyof LicenseTexts | null>(null);
  const [texts, setTexts] = useState<LicenseTexts | null>(null);
  const [textsFailed, setTextsFailed] = useState(false);
  const store = useUpdateStore((s) => s.store);
  const [notesOpen, setNotesOpen] = useState(false);
  const notes = version ? versionNotes(version) : null;

  useEffect(() => {
    let live = true;
    getVersion()
      .then((v) => live && setVersion(v))
      .catch(() => {}); // outside the app window there is no version to show
    return () => {
      live = false;
    };
  }, []);

  const open = async (url: string) => {
    setFailed(false);
    try {
      await openExternalLink(url);
    } catch {
      setFailed(true);
    }
  };

  const showLicense = async (which: keyof LicenseTexts) => {
    if (shown === which) return setShown(null);
    setTextsFailed(false);
    try {
      setTexts(texts ?? (await licenseTexts()));
      setShown(which);
    } catch {
      setTextsFailed(true);
    }
  };

  return (
    <>
      <Field label={t("preferences.about.title")}>
        <div className="flex items-center gap-3">
          <img src={appIcon} alt="" width={48} height={48} className="size-12 rounded-lg" draggable={false} />
          <div>
            {name && <div className="text-sm font-semibold">{name}</div>}
            {version && (
              <div className="text-[var(--muted)]" data-testid="app-version">
                {t("preferences.about.version", { version })}
              </div>
            )}
            <div>{t("preferences.about.createdBy")}</div>
          </div>
        </div>
      </Field>
      <Field label={t("preferences.about.links")}>
        <div className="flex flex-wrap items-center gap-2">
          {LINKS.map(({ id, url, Icon }) => (
            <Button key={id} size="md" className="flex items-center gap-2" title={url} onClick={() => void open(url)}>
              <Icon />
              {t(`preferences.about.${id}`)}
            </Button>
          ))}
          <div className="ml-1 flex items-center border-l border-[var(--border)] pl-3" data-testid="about-org-link">
            <Button
              size="md"
              className="flex items-center justify-center gap-2"
              title={ORG_LINK.url}
              onClick={() => void open(ORG_LINK.url)}
            >
              <ORG_LINK.Icon />
              {t(`preferences.about.${ORG_LINK.id}`)}
            </Button>
          </div>
        </div>
        {failed && (
          <p className="text-red-300" role="alert">
            ⚠ {t("preferences.about.openFailed")}
          </p>
        )}
      </Field>
      <Field label={t("preferences.about.updates")}>
        <p className="text-[var(--muted)]">{t("preferences.about.downloadPageNote")}</p>
        <div className="flex flex-wrap gap-2">
          <DownloadPageButton store={store} onOpen={(url) => void open(url)} />
          <Button size="md" title={EXTERNAL_LINKS.changelog} onClick={() => void open(EXTERNAL_LINKS.changelog)}>
            {t("preferences.about.changelog")}
          </Button>
          {version && notes && (
            <Button size="md" aria-pressed={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>
              {t("preferences.about.whatsNew", { version })}
            </Button>
          )}
        </div>
        {notesOpen && notes && <ReleaseNotes notes={notes} />}
      </Field>
      <BugReportField />
      <Field label={t("preferences.about.license")}>
        <p className="text-[var(--muted)]">{t("preferences.about.licenseNote")}</p>
        <div className="flex flex-wrap gap-2">
          {(["app", "third_party"] as const).map((which) => (
            <Button key={which} size="md" aria-pressed={shown === which} onClick={() => void showLicense(which)}>
              {t(which === "app" ? "preferences.about.appLicense" : "preferences.about.thirdParty")}
            </Button>
          ))}
        </div>
        {textsFailed && (
          <p className="text-red-300" role="alert">
            ⚠ {t("preferences.about.licenseFailed")}
          </p>
        )}
        {shown && texts && (
          // A read-only field scrolls, takes focus and lets the text be selected and copied, with no extra code.
          <textarea
            readOnly
            data-testid="license-text"
            aria-label={t(shown === "app" ? "preferences.about.appLicense" : "preferences.about.thirdParty")}
            value={texts[shown]}
            className="h-64 w-full resize-none rounded bg-[var(--bg)] px-2 py-1.5 font-mono text-[11px]"
          />
        )}
      </Field>
    </>
  );
}

/**
 * Where this copy can be downloaded again: Gutterberg's page, or the Store's page for the copy the Store installed
 * (the installer from the page would put a second copy next to it). Preferences › Updates shows it too.
 */
export function DownloadPageButton({ store, onOpen }: { store: boolean; onOpen: (url: string) => void }) {
  const { t } = useTranslation();
  const url = store ? EXTERNAL_LINKS.storePage : EXTERNAL_LINKS.projectPage;
  return (
    <Button size="md" title={url} onClick={() => onOpen(url)}>
      {t(store ? "preferences.about.storePage" : "preferences.about.downloadPage")}
    </Button>
  );
}
