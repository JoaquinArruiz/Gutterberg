import { describe, expect, it } from "vitest";
import { DEFAULT_AI, normalizeAi, providerConfig, providerHost } from "./ai";
import { DEFAULT_PREFERENCES, migratePreferences, normalizePreferences, PREFERENCES_VERSION } from "./preferences";

describe("AI preferences", () => {
  it("start off, on Anthropic, sending images, with Claude as its default model and no key anywhere", () => {
    expect(DEFAULT_AI.enabled).toBe(false);
    expect(DEFAULT_AI.provider).toBe("anthropic");
    expect(DEFAULT_AI.sendImages).toBe(true);
    expect(DEFAULT_AI.providers.anthropic.model).toBe("claude-sonnet-5-5");
    expect(DEFAULT_AI.providers.openai_compatible.model).toBe("");
    expect(JSON.stringify(DEFAULT_AI)).not.toMatch(/key/i);
  });

  it("are repaired from anything stored", () => {
    for (const raw of [undefined, null, 3, "x", [], {}]) expect(normalizeAi(raw)).toEqual(DEFAULT_AI);
    const ai = normalizeAi({
      enabled: "yes",
      provider: "skynet",
      sendImages: false,
      providers: {
        gemini: { model: "  gemini-2.5-flash  ", baseUrl: 5 },
        ollama: "nope",
        openai_compatible: { model: "x".repeat(500), baseUrl: " http://localhost:1234/v1 " },
      },
      apiKey: "sk-secret",
    });
    expect(ai.enabled).toBe(false); // only a real true turns it on
    expect(ai.provider).toBe("anthropic");
    expect(ai.sendImages).toBe(false);
    expect(ai.providers.gemini).toEqual({ model: "gemini-2.5-flash", baseUrl: "", workspaceId: "" });
    expect(ai.providers.ollama).toEqual(DEFAULT_AI.providers.ollama);
    expect(ai.providers.openai_compatible.model).toHaveLength(200);
    expect(ai.providers.openai_compatible.baseUrl).toBe("http://localhost:1234/v1");
    // Whatever else was stored is dropped, a key included.
    expect(JSON.stringify(ai)).not.toContain("sk-secret");
  });

  it("turn on only with a real true", () => {
    expect(normalizeAi({ enabled: true }).enabled).toBe(true);
    expect(normalizeAi({ enabled: 1 }).enabled).toBe(false);
  });
});

describe("AI Mode in the preferences (added in version 8)", () => {
  it("adds AI Mode, off, to preferences saved by version 7", () => {
    expect(PREFERENCES_VERSION).toBeGreaterThanOrEqual(8);
    const v7 = { version: 7, measurement: { unit: "in" }, presets: [], files: { recent: ["/a.gtr"] } };
    const migrated = migratePreferences(v7);
    expect(migrated.version).toBe(PREFERENCES_VERSION);
    expect(migrated.ai).toEqual(DEFAULT_AI);
    expect(migrated.measurement.unit).toBe("in");
    expect(migrated.files.recent).toEqual(["/a.gtr"]);
    expect(normalizePreferences({}).ai.enabled).toBe(false);
    expect(DEFAULT_PREFERENCES.ai).toEqual(DEFAULT_AI);
  });
});

describe("what a command is given", () => {
  it("is the chosen provider's model and address, with an empty address as none", () => {
    const ai = normalizeAi({
      provider: "openai_compatible",
      providers: { openai_compatible: { model: "gpt-x", baseUrl: "https://api.x.ai/v1" } },
    });
    expect(providerConfig(ai)).toEqual({
      kind: "openai_compatible",
      model: "gpt-x",
      base_url: "https://api.x.ai/v1",
      workspace_id: null,
    });
    expect(providerConfig(DEFAULT_AI)).toEqual({
      kind: "anthropic",
      model: "claude-sonnet-5-5",
      base_url: null,
      workspace_id: null,
    });
  });

  it("names the server the way the notice shows it", () => {
    expect(providerHost(DEFAULT_AI)).toBe("api.anthropic.com");
    expect(providerHost(normalizeAi({ provider: "ollama" }))).toBe("localhost:11434");
    const lm = normalizeAi({
      provider: "openai_compatible",
      providers: { openai_compatible: { baseUrl: "http://192.168.1.5:1234/v1/" } },
    });
    expect(providerHost(lm)).toBe("192.168.1.5:1234");
  });
});

describe("the Anthropic workspace ID", () => {
  it("is kept per provider, trimmed, and sent only for Anthropic", () => {
    const ai = normalizeAi({
      providers: {
        anthropic: { workspaceId: "  wrkspc_01ABC  " },
        gemini: { workspaceId: "wrkspc_other" },
      },
    });
    expect(ai.providers.anthropic.workspaceId).toBe("wrkspc_01ABC");
    expect(providerConfig(ai).workspace_id).toBe("wrkspc_01ABC");
    expect(providerConfig({ ...ai, provider: "gemini" }).workspace_id).toBeNull();
    expect(providerConfig(DEFAULT_AI).workspace_id).toBeNull();
  });
});
