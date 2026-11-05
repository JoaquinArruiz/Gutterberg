import { describe, expect, it } from "vitest";
import { copiesFor, parseCopiesList } from "./copies-list";

describe("parseCopiesList", () => {
  it("reads the number before or after the name", () => {
    const { lines } = parseCopiesList(
      [
        "3x Ember Drake",
        "2 × Tide Caller",
        "4 Mossback Elder",
        "Granite Warden x2",
        "Night Weaver, 5",
        "Imp\t1",
        "7",
      ].join("\n"),
    );
    expect(lines).toEqual([
      { copies: 3, label: "Ember Drake" },
      { copies: 2, label: "Tide Caller" },
      { copies: 4, label: "Mossback Elder" },
      { copies: 2, label: "Granite Warden" },
      { copies: 5, label: "Night Weaver" },
      { copies: 1, label: "Imp" },
      { copies: 7, label: "" },
    ]);
  });

  it("leaves out blank lines, comments and a header without a number", () => {
    expect(parseCopiesList("Name,Count\n\n# base game\n2,Heart\n")).toEqual({
      lines: [{ copies: 2, label: "Heart" }],
      skipped: 1,
    });
  });

  it("keeps a count within the maximum and allows none", () => {
    expect(parseCopiesList("500 Coin\n0 Skull").lines).toEqual([
      { copies: 99, label: "Coin" },
      { copies: 0, label: "Skull" },
    ]);
  });
});

describe("copiesFor", () => {
  it("pairs lines and pieces in order and leaves the rest alone", () => {
    const list = parseCopiesList("3 A\n2 B\n1 C");
    expect(copiesFor(["a", "b"], list)).toEqual({ a: 3, b: 2 });
    expect(copiesFor(["a", "b", "c", "d"], list)).toEqual({ a: 3, b: 2, c: 1 });
  });
});
