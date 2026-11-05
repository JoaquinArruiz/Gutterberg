// The changes of the version that is running, from its summary in release-notes/ (in the app's language when there is
// one) or else CHANGELOG.md (English only), as they were when the app was built, so they can be read without a network.

import changelog from "../../CHANGELOG.md?raw";

const summaries = import.meta.glob<string>("/release-notes/*/*.md", { query: "?raw", import: "default", eager: true });

/**
 * The short notes of `version` in `language` (release-notes/<language>/x.y.z.md, written with the release), as
 * Discord and the Microsoft Store show them, or the English ones when that language has none. Null for a version
 * without one, such as a development build.
 */
export function versionSummary(
  version: string,
  language = "en",
  files: Record<string, string> = summaries,
): string | null {
  const read = (lang: string) => files[`/release-notes/${lang}/${version}.md`]?.trim() || null;
  return read(language.split("-")[0]) ?? read("en");
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
