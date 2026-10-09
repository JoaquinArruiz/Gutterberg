import { describe, expect, it } from "vitest";
import {
  afterUpdate,
  changeKind,
  compareVersions,
  DEFAULT_UPDATES,
  normalizeUpdates,
  parseNotes,
  parseVersion,
  shouldNotify,
  type UpdateNotify,
  type UpdatePrefs,
} from "./updates";

const prefs = (patch: Partial<UpdatePrefs> = {}): UpdatePrefs => ({ ...DEFAULT_UPDATES, ...patch });

describe("version comparison", () => {
  it("reads versions with or without a v and rejects anything else", () => {
    expect(parseVersion("1.2.3")?.core).toEqual([1, 2, 3]);
    expect(parseVersion("v1.2.3-beta.1")?.pre).toEqual(["beta", "1"]);
    for (const bad of ["1.2", "1.2.3.4", "latest", "", "1.2.x"]) expect(parseVersion(bad)).toBeNull();
  });

  it("orders by major, minor, then patch, as numbers", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("0.9.1", "0.9.0")).toBe(1);
  });

  it("puts a pre-release before its release and orders pre-releases", () => {
    expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBe(-1);
    expect(compareVersions("1.2.0", "1.2.0-beta.1")).toBe(1);
    expect(compareVersions("1.2.0-beta.2", "1.2.0-beta.10")).toBe(-1);
    expect(compareVersions("1.2.0-alpha", "1.2.0-beta")).toBe(-1);
    expect(compareVersions("1.2.0-beta", "1.2.0-beta.1")).toBe(-1);
    expect(compareVersions("1.1.9", "1.2.0-beta.1")).toBe(-1);
  });

  it("treats text that is not a version as equal, so nothing is announced from it", () => {
    expect(compareVersions("soon", "1.0.0")).toBe(0);
  });
});

describe("how big a step is", () => {
  it("is a patch, a feature (minor) or major, also before 1.0", () => {
    expect(changeKind("1.1.0", "1.1.1")).toBe("patch");
    expect(changeKind("1.1.0", "1.2.0")).toBe("feature");
    expect(changeKind("1.1.0", "2.0.0")).toBe("major");
    expect(changeKind("0.9.0", "0.9.1")).toBe("patch");
    expect(changeKind("0.9.0", "0.10.0")).toBe("feature");
    expect(changeKind("0.9.0", "1.0.0")).toBe("major");
  });
});

describe("Tell me about", () => {
  const cases: [string, string, Record<UpdateNotify, boolean>][] = [
    ["1.1.0", "1.1.1", { all: true, features: false, major: false, never: false }],
    ["1.1.0", "1.2.0", { all: true, features: true, major: false, never: false }],
    ["1.1.0", "2.0.0", { all: true, features: true, major: true, never: false }],
    ["0.9.0", "0.9.1", { all: true, features: false, major: false, never: false }],
    ["0.9.0", "1.0.0", { all: true, features: true, major: true, never: false }],
  ];
  for (const [current, next, expected] of cases) {
    it(`${current} -> ${next}`, () => {
      for (const notify of Object.keys(expected) as UpdateNotify[])
        expect(shouldNotify(current, next, prefs({ notify })), notify).toBe(expected[notify]);
    });
  }

  it("is quiet about the same or an older version", () => {
    expect(shouldNotify("1.1.0", "1.1.0", prefs())).toBe(false);
    expect(shouldNotify("1.1.0", "1.0.0", prefs())).toBe(false);
  });

  it("is quiet about a skipped version until a newer one comes", () => {
    const skipped = prefs({ skippedVersion: "1.2.0" });
    expect(shouldNotify("1.1.0", "1.2.0", skipped)).toBe(false);
    expect(shouldNotify("1.1.0", "1.2.1", skipped)).toBe(true);
    expect(shouldNotify("1.1.0", "1.3.0", skipped)).toBe(true);
  });
});

describe("after an update", () => {
  const pending = { version: "1.2.0", notes: "- Faster" };
  it("says it worked, with the notes, when the running version is the one that was installing", () => {
    expect(afterUpdate("1.2.0", prefs({ pending }))).toEqual({ kind: "updated", version: "1.2.0", notes: "- Faster" });
  });
  it("says it did not finish when the app is older than that", () => {
    expect(afterUpdate("1.1.0", prefs({ pending }))).toEqual({ kind: "failed", version: "1.2.0" });
  });
  it("says nothing on a first install, a normal start or a newer version than the record", () => {
    expect(afterUpdate("1.1.0", prefs())).toEqual({ kind: "none" });
    expect(afterUpdate("1.3.0", prefs({ pending }))).toEqual({ kind: "none" });
  });
});

describe("release notes", () => {
  it("become headings, bullets and paragraphs", () => {
    const blocks = parseNotes("### Added\n\n- One\n* Two\n\nSome words\nover two lines.\r\n\n### Fixed\n- Three");
    expect(blocks).toEqual([
      { type: "heading", text: "Added" },
      { type: "bullets", items: ["One", "Two"] },
      { type: "paragraph", text: "Some words over two lines." },
      { type: "heading", text: "Fixed" },
      { type: "bullets", items: ["Three"] },
    ]);
  });
  it("keep tags and links as typed text", () => {
    expect(parseNotes("- <img src=x onerror=alert(1)> [a](http://x)")).toEqual([
      { type: "bullets", items: ["<img src=x onerror=alert(1)> [a](http://x)"] },
    ]);
  });
  it("are empty for empty text", () => {
    expect(parseNotes("  \n\n")).toEqual([]);
  });
});

describe("update preferences", () => {
  it("start as: tell me about everything, never checked, nothing pending", () => {
    expect(normalizeUpdates(undefined)).toEqual(DEFAULT_UPDATES);
  });
  it("keep valid values and drop the rest", () => {
    const p = normalizeUpdates({
      notify: "major",
      lastCheck: 1700000000000,
      skippedVersion: "1.2.0",
      pending: { version: "1.3.0", notes: "x" },
      lastRunVersion: "1.1.0",
    });
    expect(p).toEqual({
      notify: "major",
      lastCheck: 1700000000000,
      skippedVersion: "1.2.0",
      pending: { version: "1.3.0", notes: "x" },
      lastRunVersion: "1.1.0",
    });
    const bad = normalizeUpdates({ notify: "sometimes", lastCheck: -1, skippedVersion: 5, pending: { version: 3 } });
    expect(bad).toEqual(DEFAULT_UPDATES);
  });
});
