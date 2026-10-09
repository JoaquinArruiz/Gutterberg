// Experimental features (M15): switches for unfinished work, off by default and labelled "May change or disappear
// in a later version". Add an entry here and its two texts to the language files under `experimental.features.<id>`;
// the code then asks `useExperimental(id)` (in `stores/preferences-store.ts`, which avoids a cycle with the preferences model). While the list is empty, Preferences › Experimental is hidden.

export type ExperimentalDef = {
  id: string;
  title: `experimental.features.${string}.title`;
  text: `experimental.features.${string}.text`;
};

export const EXPERIMENTAL: readonly ExperimentalDef[] = [];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The saved switches of features that still exist (a feature that left the list loses its switch). */
export function normalizeExperimental(raw: unknown, defs: readonly ExperimentalDef[] = EXPERIMENTAL) {
  const flags: Record<string, boolean> = {};
  if (isObj(raw)) for (const { id } of defs) if (typeof raw[id] === "boolean") flags[id] = raw[id];
  return flags;
}
