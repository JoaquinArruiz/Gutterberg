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

/**
 * Which of a clip's two files this webview should play: the VP9 .webm when it says it can, the H.264 .mp4 otherwise.
 * `canPlayType` is the video element's own (an empty string means no).
 */
export const clipFormat = (canPlayType: (type: string) => string): "webm" | "mp4" =>
  canPlayType('video/webm; codecs="vp9"') ? "webm" : "mp4";

const loaded = new Map<string, Promise<string>>();

/**
 * Loads a clip into memory and gives a `blob:` URL to play it from. On Linux the webview's media player (GStreamer)
 * cannot seek in a file served through the app's own `tauri://` address, so it cannot play the clip from there
 * (the WebM demuxer needs to seek); a blob is a whole file in memory, which it can. Each clip is loaded once and
 * kept for the life of the app (four small files). A failed load is not kept, so the next try fetches again.
 */
export function loadClip(clip: string, ext: "webm" | "mp4", fetchFile: typeof fetch = fetch): Promise<string> {
  const key = `${clip}.${ext}`;
  let url = loaded.get(key);
  if (!url) {
    url = fetchFile(clipUrl(clip, ext))
      .then((r) => {
        if (!r.ok) throw new Error(`${key}: ${r.status}`);
        return r.blob();
      })
      .then((b) => URL.createObjectURL(b));
    url.catch(() => loaded.delete(key));
    loaded.set(key, url);
  }
  return url;
}

/** Forgets the loaded clips (for tests). */
export const forgetLoadedClips = () => loaded.clear();
