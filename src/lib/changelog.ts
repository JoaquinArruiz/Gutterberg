// The changes of the version that is running, from CHANGELOG.md as it was when the app was built, so they can be read
// without a network. English only, like the release notes.

import changelog from "../../CHANGELOG.md?raw";

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
