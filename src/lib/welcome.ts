// The welcome tour (M25): four short clips, one per step, with their words from the language files. The clips
// are in `public/welcome/` (made from the masters in `assets/welcome/` by `scripts/encode-welcome.sh`): a .webm and
// an .mp4 of each, because neither format plays everywhere, and a .png of its last frame.

/**
 * The tour's version. The welcome opens by itself until the user closes it; a much changed app can raise this to
 * show a new tour to everyone once.
 */
export const WELCOME_VERSION = 1;

export type WelcomeStep = {
  id: "cut" | "place" | "arrange" | "done";
  /** The clip's file name without its extension: `public/welcome/<clip>.webm`, `.mp4` and `.png`. */
  clip: string;
  title:
    | "welcome.steps.cut.title"
    | "welcome.steps.place.title"
    | "welcome.steps.arrange.title"
    | "welcome.steps.done.title";
  text:
    | "welcome.steps.cut.text"
    | "welcome.steps.place.text"
    | "welcome.steps.arrange.text"
    | "welcome.steps.done.text";
};

export const WELCOME_STEPS: readonly WelcomeStep[] = [
  { id: "cut", clip: "01-cut", title: "welcome.steps.cut.title", text: "welcome.steps.cut.text" },
  { id: "place", clip: "02-place", title: "welcome.steps.place.title", text: "welcome.steps.place.text" },
  { id: "arrange", clip: "03-arrange", title: "welcome.steps.arrange.title", text: "welcome.steps.arrange.text" },
  { id: "done", clip: "04-done", title: "welcome.steps.done.title", text: "welcome.steps.done.text" },
];

/** Where a clip's files are served from. */
export const clipUrl = (clip: string, ext: "webm" | "mp4" | "png") => `/welcome/${clip}.${ext}`;

/** Whether the user asked their system for less motion: the clips then wait for a Play button. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
