// One-time help tips ("hints"). Each has a stable id; once the user closes one it
// stays closed (the id is saved in preferences) until they use "Reset help tips"
// in Preferences. To add a tip: add its id here and render it with <HintToast id=...>.

export type HintId = "live-preview-manual";
export const HINT_IDS: HintId[] = ["live-preview-manual"];

export const isHintId = (v: unknown): v is HintId => HINT_IDS.includes(v as HintId);
