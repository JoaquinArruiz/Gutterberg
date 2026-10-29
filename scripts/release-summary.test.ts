import { describe, expect, it } from "vitest";
// @ts-expect-error a plain Node script with no types
import { markdown, parseSummary, readSummary, STORE_LIMIT, storeText } from "./release-summary.mjs";

const SUMMARY = [
  "### Added",
  "",
  "- Save for sharing writes a readme beside the project.",
  "- A bullet that goes on",
  "  over two lines.",
  "",
  "### Fixed",
  "",
  "- Closing with unsaved changes asks first.",
  "",
].join("\r\n");

describe("parseSummary", () => {
  it("reads the sections and their bullets", () => {
    expect(parseSummary(SUMMARY)).toEqual({
      sections: [
        {
          name: "Added",
          items: ["Save for sharing writes a readme beside the project.", "A bullet that goes on over two lines."],
        },
        { name: "Fixed", items: ["Closing with unsaved changes asks first."] },
      ],
      problems: [],
    });
  });

  it("refuses other headings, text that is not a bullet, empty sections and Markdown in a bullet", () => {
    const { problems } = parseSummary(
      "A paragraph.\n\n### New\n- x\n### Added\n### Fixed\n- **Bold** and `code`\n### Fixed\n- again",
    );
    expect(problems).toEqual([
      expect.stringContaining("line 1"),
      expect.stringContaining('"New" is not one of'),
      expect.stringContaining('"Fixed" comes twice'),
      '"Added" has no bullets',
      expect.stringContaining("no Markdown"),
    ]);
    expect(parseSummary("").problems).toEqual(["it has no sections"]);
  });

  it("refuses a summary whose Store text is over the Store's limit", () => {
    const { problems } = parseSummary(`### Added\n${"- A sentence that says what changed.\n".repeat(60)}`);
    expect(problems).toEqual([expect.stringContaining(`over ${STORE_LIMIT}`)]);
  });
});

describe("the forms of a summary", () => {
  const { sections } = parseSummary(SUMMARY);

  it("is plain text for the Store, without Markdown or a link", () => {
    expect(storeText(sections)).toBe(
      "Added\n• Save for sharing writes a readme beside the project.\n• A bullet that goes on over two lines.\n\n" +
        "Fixed\n• Closing with unsaved changes asks first.",
    );
  });

  it("is tidy Markdown for latest.json", () => {
    expect(markdown(sections)).toBe(
      "### Added\n\n- Save for sharing writes a readme beside the project.\n- A bullet that goes on over two lines." +
        "\n\n### Fixed\n\n- Closing with unsaved changes asks first.",
    );
  });
});

describe("the summaries in release-notes/", () => {
  it("are all valid", () => {
    const files = Object.keys(import.meta.glob("../release-notes/*.md"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(() => readSummary(file.match(/([^/]+)\.md$/)?.[1])).not.toThrow();
  });
});
