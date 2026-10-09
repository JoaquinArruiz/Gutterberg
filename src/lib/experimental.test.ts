import { describe, expect, it } from "vitest";
import { EXPERIMENTAL, type ExperimentalDef, normalizeExperimental } from "./experimental";

const defs: ExperimentalDef[] = [
  { id: "alpha", title: "experimental.features.alpha.title", text: "experimental.features.alpha.text" },
];

describe("experimental switches", () => {
  it("keep the booleans of features that exist and drop the others", () => {
    expect(normalizeExperimental({ alpha: true, gone: true, beta: "yes" }, defs)).toEqual({ alpha: true });
    expect(normalizeExperimental({ alpha: "yes" }, defs)).toEqual({});
    expect(normalizeExperimental("nonsense", defs)).toEqual({});
  });
  it("are empty while no feature is experimental", () => {
    expect(EXPERIMENTAL).toHaveLength(0);
    expect(normalizeExperimental({ alpha: true })).toEqual({});
  });
});
