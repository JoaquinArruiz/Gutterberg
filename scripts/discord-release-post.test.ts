import { describe, expect, it } from "vitest";
// @ts-expect-error a plain Node script with no types
import { buildPost, parseNotes, summarize } from "./discord-release-post.mjs";

const NOTES = [
  "A paragraph on why the version exists.",
  "",
  "### Added",
  "",
  "- Cut marks on back sheets: with Backs on the other side, the marks go around the backs too. It is off by default.",
  "- A second feature that goes on",
  "  over two lines.",
  "",
  "### Fixed",
  "",
  "- Test connection failed on Gemini models: their thinking used up the reply. Gemini now gets room to think.",
].join("\r\n");

describe("parseNotes", () => {
  it("reads the Added, Changed and Fixed lists and leaves the paragraph out", () => {
    expect(parseNotes(NOTES)).toEqual([
      {
        heading: "✨ New",
        items: [
          "Cut marks on back sheets: with Backs on the other side, the marks go around the backs too. It is off by default.",
          "A second feature that goes on over two lines.",
        ],
      },
      {
        heading: "🛠️ Fixed",
        items: [
          "Test connection failed on Gemini models: their thinking used up the reply. Gemini now gets room to think.",
        ],
      },
    ]);
  });

  it("skips headings it doesn't know and empty lists", () => {
    expect(parseNotes("### Removed\n- gone\n### Changed\n")).toEqual([]);
  });
});

describe("summarize", () => {
  it("keeps a bullet's name in bold and the first sentence after it", () => {
    expect(
      summarize("Cut marks on back sheets: with Backs on the other side, the marks go around. Off by default."),
    ).toBe("**Cut marks on back sheets:** with Backs on the other side, the marks go around.");
  });

  it("keeps the first sentence of a bullet without a name", () => {
    expect(summarize("A tutorial works with tips off. Nothing about it is saved.")).toBe(
      "A tutorial works with tips off.",
    );
  });

  it("doesn't take a colon inside code, or one far into the text, for a name", () => {
    expect(summarize("A command line, `gutterberg-cli`: it exports. More.")).toBe(
      "A command line, `gutterberg-cli`: it exports.",
    );
  });

  it("cuts a long sentence on a word", () => {
    const short = summarize(`${"word ".repeat(60)}end.`, 40);
    expect(short.length).toBeLessThanOrEqual(40);
    expect(short.endsWith("word…")).toBe(true);
  });
});

describe("buildPost", () => {
  const post = (body: string) => buildPost({ tag: "v1.1.0", url: "https://example.com/v1.1.0", body, roleId: "42" });

  it("pings the role, names the version and links the release without an embed", () => {
    const text = post(NOTES);
    expect(text.startsWith("<@&42>\n# Gutterberg 1.1.0 is out!\n\n## ✨ New\n- **Cut marks on back sheets:**")).toBe(
      true,
    );
    expect(text).toContain(
      "\n\n## 🛠️ Fixed\n- **Test connection failed on Gemini models:** their thinking used up the reply.",
    );
    expect(text.endsWith("[download it from GitHub](<https://example.com/v1.1.0>).")).toBe(true);
  });

  it("fits in Discord's 2000 characters by shortening, then leaving bullets for the release page", () => {
    const long = `### Added\n${Array.from({ length: 60 }, (_, i) => `- Feature ${i}: ${"a long text ".repeat(20)}`).join("\n")}`;
    const text = post(long);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toMatch(/- …and \d+ more in the release notes\./);
  });
});
