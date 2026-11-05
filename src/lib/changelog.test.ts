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
  it("is its file in release-notes/<language>/, and none for a version without one", () => {
    const files = {
      "/release-notes/en/1.3.0.md": "### Added\n\n- New.\n",
      "/release-notes/es/1.3.0.md": "### Agregado\n\n- Nuevo.\n",
      "/release-notes/en/1.3.1.md": "### Fixed\n\n- Fixed.\n",
    };
    expect(versionSummary("1.3.0", "en", files)).toBe("### Added\n\n- New.");
    expect(versionSummary("1.3.0", "es", files)).toBe("### Agregado\n\n- Nuevo.");
    expect(versionSummary("1.3.0", "es-AR", files)).toBe("### Agregado\n\n- Nuevo.");
    expect(versionSummary("1.3.2", "en", files)).toBeNull();
  });

  it("is the English one when the language has none", () => {
    const files = { "/release-notes/en/1.3.1.md": "### Fixed\n\n- Fixed.\n" };
    expect(versionSummary("1.3.1", "es", files)).toBe("### Fixed\n\n- Fixed.");
  });

  it("comes from the release-notes/ the app was built with, in English and Spanish", () => {
    expect(versionSummary("1.3.0")).toContain("### Added");
    expect(versionSummary("1.3.0", "es")).toContain("### Agregado");
  });
});
