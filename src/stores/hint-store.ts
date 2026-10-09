import { create } from "zustand";
import { HINT_IDS, type HintId, hintVersion } from "../lib/hints";
import { usePreferencesStore } from "./preferences-store";
import { useUiStore } from "./ui-store";

/**
 * Which hints are currently rendered by some component. Only the first of them (in catalog
 * order) that is not dismissed is visible; the next appears once it is closed or unmounted.
 */
const useMountedHints = create<{
  mounted: Partial<Record<HintId, number>>;
  add: (id: HintId) => void;
  remove: (id: HintId) => void;
}>((set) => ({
  mounted: {},
  add: (id) => set((s) => ({ mounted: { ...s.mounted, [id]: (s.mounted[id] ?? 0) + 1 } })),
  remove: (id) =>
    set((s) => {
      const { [id]: n = 0, ...rest } = s.mounted;
      return { mounted: n > 1 ? { ...rest, [id]: n - 1 } : rest };
    }),
}));

export const isHintDismissed = (dismissed: Partial<Record<HintId, number>>, id: HintId) =>
  (dismissed[id] ?? 0) >= hintVersion(id);

/** Registers the calling component for hint `id`; `visible` is true only when it is the hint to show now. */
export function useHint(id: HintId) {
  const add = useMountedHints((s) => s.add);
  const remove = useMountedHints((s) => s.remove);
  const mounted = useMountedHints((s) => s.mounted);
  const dismissed = usePreferencesStore((s) => s.prefs.help.dismissedHints);
  const dismissHint = usePreferencesStore((s) => s.dismissHint);
  // No tip shows while the welcome tour is open, nor in the moment after it closes.
  const held = useUiStore((s) => s.hintsHeld);
  return {
    register: () => {
      add(id);
      return () => remove(id);
    },
    visible: !held && HINT_IDS.find((h) => mounted[h] && !isHintDismissed(dismissed, h)) === id,
    dismiss: () => dismissHint(id),
  };
}
