import { describe, expect, it } from "vitest";
import { versionNotes, versionSummary } from "./changelog";

const TEXT = `# Changelog

Intro.

## Unreleased

### Added

- Something new.

## 1.2.1 (2026-10-27)

A safety release.

### Fixed

- A fix.

## 1.2.0 (2026-10-21)

- Older.
`;

describe("the notes of the running version", () => {
  it("are its section, up to the next version, as the release takes them", () => {
    expect(versionNotes("1.2.1", TEXT)).toBe("A safety release.\n\n### Fixed\n\n- A fix.");
    expect(versionNotes("1.2.0", TEXT)).toBe("- Older.");
  });

  it("are the Unreleased ones for a version without a section, and none when that is empty too", () => {
    expect(versionNotes("1.3.0", TEXT)).toBe("### Added\n\n- Something new.");
    expect(versionNotes("1.3.0", "## Unreleased\n\n## 1.2.0 (2026-10-21)\n\n- Older.\n")).toBeNull();
  });

  it("come from the CHANGELOG.md the app was built with", () => {
    expect(versionNotes("1.2.1")).toContain("safety release");
  });
});

describe("the summary of the running version", () => {
  it("is its file in release-notes/, and none for a version without one", () => {
    const files = { "/release-notes/1.3.0.md": "### Added\n\n- New.\n" };
    expect(versionSummary("1.3.0", files)).toBe("### Added\n\n- New.");
    expect(versionSummary("1.3.1", files)).toBeNull();
  });

  it("comes from the release-notes/ the app was built with", () => {
    expect(versionSummary("1.3.0")).toContain("### Added");
  });
});
