// IPC for AI Mode (M19). Mirrors `card_ai` and `src-tauri/src/commands/ai.rs`; every request is made by
// Rust, never by the page. Each call first tells Rust whether AI Mode is on, so the switch Rust checks is
// always the one the user set. No call returns a key.

import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { usePreferencesStore } from "../stores/preferences-store";
import { type AiProvider, providerConfig } from "./ai";
import type { DocumentId, OrientedRect } from "./card";
import { DetectionSchema } from "./detect-api";

export const PAGE_LABELS = ["cards", "backs", "rules", "cover", "other"] as const;
export type PageLabel = (typeof PAGE_LABELS)[number];
/** Pages of these kinds have no pieces to print, so Sort pages starts them skipped. Backs are pieces. */
export const skippedByDefault = (label: PageLabel): boolean =>
  label === "rules" || label === "cover" || label === "other";

export const UsageSchema = z.object({ input_tokens: z.number(), output_tokens: z.number() });
export type Usage = z.infer<typeof UsageSchema>;

export const EstimateSchema = z.object({
  requests: z.number().int(),
  images: z.number().int(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  host: z.string(),
  sends_images: z.boolean(),
});
export type Estimate = z.infer<typeof EstimateSchema>;

const LabelledPageSchema = z.object({
  page_index: z.number().int().min(0),
  label: z.enum(PAGE_LABELS),
  confidence: z.number(),
});
export type LabelledPage = z.infer<typeof LabelledPageSchema>;

const settings = () => {
  const ai = usePreferencesStore.getState().prefs.ai;
  return { config: providerConfig(ai), sendImages: ai.sendImages };
};

/** Tells Rust whether AI Mode is on (it refuses every AI command while it is off). */
export async function syncAiGate(): Promise<void> {
  try {
    await invoke("ai_set_enabled", { enabled: usePreferencesStore.getState().prefs.ai.enabled });
  } catch {
    /* no backend (a test, a browser): nothing to tell */
  }
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  await syncAiGate();
  return invoke<T>(command, args);
}

export async function aiKeyStatus(provider: AiProvider): Promise<boolean> {
  return call<boolean>("ai_key_status", { provider });
}

export async function aiSetKey(provider: AiProvider, key: string): Promise<void> {
  await call<void>("ai_set_key", { provider, key });
}

export async function aiDeleteKey(provider: AiProvider): Promise<void> {
  await call<void>("ai_delete_key", { provider });
}

export async function aiTestConnection(): Promise<Usage> {
  return UsageSchema.parse(await call("ai_test_connection", { config: settings().config }));
}

export type AiTask = "detect" | "sort" | "pair";

/** What a run would send, from the very requests it would make. Sends nothing. */
export async function aiEstimate(task: "detect" | "sort", documentId: DocumentId, pages: number[]): Promise<Estimate> {
  const { config, sendImages } = settings();
  return EstimateSchema.parse(await call("ai_estimate", { task, documentId, pages, config, sendImages }));
}

export async function aiDetectPieces(documentId: DocumentId, pageIndex: number) {
  const { config, sendImages } = settings();
  const raw = await call<unknown>("ai_detect_pieces", { documentId, pageIndex, config, sendImages });
  return z.object({ detection: DetectionSchema, usage: UsageSchema }).parse(raw);
}

export async function aiSortPages(documentId: DocumentId, pages: number[]) {
  const { config, sendImages } = settings();
  const raw = await call<unknown>("ai_sort_pages", { documentId, pages, config, sendImages });
  return z.object({ labels: z.array(LabelledPageSchema), usage: UsageSchema }).parse(raw);
}

/** A piece as Pair backs with AI sends it: where it is (to cut its picture out) and the name the model reads. */
export type PairPiece = { document_id: DocumentId; page_index: number; source: OrientedRect; name: string };

const AiSideSchema = z.object({
  index: z.number().int().min(0),
  side: z.enum(["front", "back", "other"]),
  back: z.number().int().min(0).nullable(),
  upside_down: z.boolean(),
});

/** What Pair backs with AI would send. Sends nothing. */
export async function aiEstimatePairing(pieces: PairPiece[]): Promise<Estimate> {
  const { config, sendImages } = settings();
  return EstimateSchema.parse(await call("ai_estimate_pairing", { pieces, config, sendImages }));
}

export async function aiPairBacks(pieces: PairPiece[]) {
  const { config, sendImages } = settings();
  const raw = await call<unknown>("ai_pair_backs", { pieces, config, sendImages });
  return z.object({ pieces: z.array(AiSideSchema), usage: UsageSchema }).parse(raw);
}
