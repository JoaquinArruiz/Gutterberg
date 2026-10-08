// AI Mode (M19): the settings the user chooses, and how they become what the Rust commands take.
// A key is never part of this: it is typed once, goes straight to the system keychain, and is read
// only inside Rust when a request is sent.

export const AI_PROVIDERS = ["anthropic", "openai_compatible", "gemini", "ollama"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export type AiProviderSettings = {
  /** Free text; empty uses the provider's default where it has one. */
  model: string;
  /** Empty = the provider's own address. */
  baseUrl: string;
};

export type AiPrefs = {
  /** Off by default: with it off no AI control is shown and nothing is sent. */
  enabled: boolean;
  provider: AiProvider;
  /** Off = text only: no picture of any page is ever sent. */
  sendImages: boolean;
  providers: Record<AiProvider, AiProviderSettings>;
};

/** What the model field starts as for each provider (only Anthropic has a default). */
export const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-5-5",
  openai_compatible: "",
  gemini: "",
  ollama: "",
};

/** Where each provider's requests go when no address is typed. */
export const DEFAULT_BASE_URL: Record<AiProvider, string> = {
  anthropic: "https://api.anthropic.com",
  openai_compatible: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com",
  ollama: "http://localhost:11434",
};

export const needsKey = (p: AiProvider): boolean => p !== "ollama";

export const DEFAULT_AI: AiPrefs = {
  enabled: false,
  provider: "anthropic",
  sendImages: true,
  providers: {
    anthropic: { model: DEFAULT_MODEL.anthropic, baseUrl: "" },
    openai_compatible: { model: "", baseUrl: "" },
    gemini: { model: "", baseUrl: "" },
    ollama: { model: "", baseUrl: "" },
  },
};

const MAX_TEXT = 200;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, fallback: string) => (typeof v === "string" ? v.trim().slice(0, MAX_TEXT) : fallback);

/** Raw stored data -> valid AI preferences; anything missing or odd takes its default. */
export function normalizeAi(raw: unknown): AiPrefs {
  const r = isObj(raw) ? raw : {};
  const stored = isObj(r.providers) ? r.providers : {};
  const providers = {} as Record<AiProvider, AiProviderSettings>;
  for (const p of AI_PROVIDERS) {
    const s = isObj(stored[p]) ? stored[p] : {};
    providers[p] = {
      model: text(s.model, DEFAULT_AI.providers[p].model),
      baseUrl: text(s.baseUrl, ""),
    };
  }
  return {
    enabled: r.enabled === true,
    provider: AI_PROVIDERS.includes(r.provider as AiProvider) ? (r.provider as AiProvider) : DEFAULT_AI.provider,
    sendImages: r.sendImages !== false,
    providers,
  };
}

/** The provider settings a Rust command takes (`card_ai::ProviderConfig`). */
export type ProviderConfigPayload = { kind: AiProvider; model: string; base_url: string | null };

export function providerConfig(ai: AiPrefs): ProviderConfigPayload {
  const s = ai.providers[ai.provider];
  return { kind: ai.provider, model: s.model.trim(), base_url: s.baseUrl.trim() === "" ? null : s.baseUrl.trim() };
}

/** The server a request goes to, as the notice names it (`api.anthropic.com`, `localhost:11434`). */
export function providerHost(ai: AiPrefs): string {
  const base = (ai.providers[ai.provider].baseUrl.trim() || DEFAULT_BASE_URL[ai.provider]).replace(/\/+$/, "");
  const rest = base.includes("://") ? base.slice(base.indexOf("://") + 3) : base;
  return rest.split("/")[0];
}
