import { parseNotes } from "../../lib/updates";

/**
 * Release notes as plain text: headings, bullets and paragraphs. The notes come from the network, so they are only
 * ever put on the page as text (React escapes them); a tag in them is shown as typed, never run.
 */
export function ReleaseNotes({ notes }: { notes: string }) {
  const blocks = parseNotes(notes);
  return (
    <div className="flex select-text flex-col gap-1.5" data-testid="release-notes">
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
    </div>
  );
}
