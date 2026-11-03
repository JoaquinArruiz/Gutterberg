// The changes of the version that is running, from its summary in release-notes/ or else CHANGELOG.md, as they were
// when the app was built, so they can be read without a network. English only, like the release notes.

import changelog from "../../CHANGELOG.md?raw";

const summaries = import.meta.glob<string>("/release-notes/*.md", { query: "?raw", import: "default", eager: true });

/**
 * The short notes of `version` (release-notes/x.y.z.md, written with the release), as Discord and the Microsoft Store
 * show them. Null for a version without one, such as a development build.
 */
export function versionSummary(version: string, files: Record<string, string> = summaries): string | null {
  return files[`/release-notes/${version}.md`]?.trim() || null;
}

/**
 * The notes of `version` in `text`: everything between its "## x.y.z (date)" heading and the next "## " heading, as
 * scripts/check-release.sh takes them for the release. A development build, whose version has no section yet, gets
 * the Unreleased one. Null when there is nothing under either.
 */
export function versionNotes(version: string, text: string = changelog): string | null {
  const section = (name: string) => {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const start = lines.findIndex((l) => l.startsWith("## ") && l.split(/\s+/)[1] === name);
    if (start < 0) return null;
    const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
    const body = lines
      .slice(start + 1, end < 0 ? undefined : end)
      .join("\n")
      .trim();
    return body || null;
  };
  return section(version) ?? section("Unreleased");
}
