import { useTranslation } from "react-i18next";
import { openExternalLink, releasePageUrl } from "../../lib/external-links";
import { parseNotes } from "../../lib/updates";

/**
 * Release notes as plain text: headings, bullets and paragraphs, in a box of about 14 lines that scrolls, so a long
 * changelog never pushes the buttons out of view. The notes come from the network, so they are only ever put on
 * the page as text (React escapes them); a tag in them is shown as typed, never run. With `version`, the notes are
 * its summary and end with a link to the full changelog on its release page.
 */
export function ReleaseNotes({ notes, version }: { notes: string; version?: string }) {
  const { t } = useTranslation();
  const blocks = parseNotes(notes);
  return (
    <div className="flex max-h-60 select-text flex-col gap-1.5 overflow-y-auto" data-testid="release-notes">
      {blocks.map((b, i) =>
        b.type === "bullets" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the blocks come from one text and never reorder
          <ul key={i} className="list-disc pl-5">
            {b.items.map((item, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: same
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : b.type === "heading" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: same
          <p key={i} className="mt-1 font-semibold">
            {b.text}
          </p>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: same
          <p key={i}>{b.text}</p>
        ),
      )}
      {version && (
        <button
          type="button"
          className="self-start text-[var(--accent)] underline hover:no-underline"
          title={releasePageUrl(version)}
          onClick={() => void openExternalLink(releasePageUrl(version)).catch(() => {})}
        >
          {t("preferences.updates.fullChangelog")}
        </button>
      )}
    </div>
  );
}
