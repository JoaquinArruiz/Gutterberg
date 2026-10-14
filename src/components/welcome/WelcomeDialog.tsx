import { ChevronLeft, ChevronRight, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { clipFormat, clipUrl, loadClip, prefersReducedMotion, WELCOME_STEPS, WELCOME_VERSION } from "../../lib/welcome";
import { useDocumentStore } from "../../stores/document-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { Button } from "../ui/Button";
import { usualUnit, WelcomeSetup } from "./WelcomeSetup";

/**
 * Opens the welcome tour by itself, once: over the start screen, with nothing open, until the user has closed it
 * (`prefs.help.welcomeSeen`). If the app was started with a file (`welcomeDeferred`, set by whatever opens it) it
 * waits for the next time the start screen is shown.
 */
export function useWelcomeAutoOpen() {
  const hasDocuments = useDocumentStore((s) => s.documents.length > 0);
  const seen = usePreferencesStore((s) => s.prefs.help.welcomeSeen >= WELCOME_VERSION);
  const deferred = useUiStore((s) => s.welcomeDeferred);
  useEffect(() => {
    const ui = useUiStore.getState();
    if (hasDocuments) {
      if (deferred) ui.deferWelcome(false);
      return;
    }
    if (!seen && !deferred && !ui.welcomeOpen) ui.setWelcomeOpen(true);
  }, [hasDocuments, seen, deferred]);
}

/**
 * The welcome tour: a short clip, a title and a line or two for each step, Back and Next, a dot for each step and
 * Skip. A clip plays once when its step opens and stops on its last frame; Play again replays it. With reduced
 * motion the poster stays and a Play button starts it. Closing in any way (Skip, Esc, Get started) marks the tour
 * as seen. Clips play from memory (`loadClip`); one that cannot play at all shows its poster instead of a black box.
 * On the first start it begins with `WelcomeSetup` (language, theme, units); a replay goes straight to the clips.
 */
export function WelcomeDialog() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.welcomeOpen);
  const setOpen = useUiStore((s) => s.setWelcomeOpen);
  const setSeen = usePreferencesStore((s) => s.setWelcomeSeen);
  const ref = useRef<HTMLDialogElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [played, setPlayed] = useState(false);
  // The loaded clip, with the clip it belongs to, so a step never shows the previous step's file.
  const [loadedClip, setLoadedClip] = useState<{ clip: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  // The setup step comes first while the tour has never been finished.
  const [setup, setSetup] = useState(false);
  const step = WELCOME_STEPS[index];
  const last = index === WELCOME_STEPS.length - 1;
  const src = loadedClip?.clip === step.clip ? loadedClip.url : null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setIndex(0);
      setPlayed(false);
      const prefs = usePreferencesStore.getState();
      const firstTime = prefs.prefs.help.welcomeSeen < WELCOME_VERSION;
      setSetup(firstTime);
      // Units start from the user's region when nothing was chosen yet (the default is millimetres).
      if (firstTime && prefs.prefs.measurement.unit === "mm" && typeof navigator !== "undefined")
        prefs.setUnit(usualUnit(navigator.language));
      d.showModal();
      next.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  // A new step loads its clip into memory, in the format this webview plays. If loading fails, the file's own
  // address is the fallback; if that cannot play either, the poster stays (`failed`).
  useEffect(() => {
    if (!open) return;
    let live = true;
    setFailed(false);
    setPlayed(false);
    setReduced(prefersReducedMotion());
    const ext = clipFormat((type) => document.createElement("video").canPlayType(type));
    const clip = step.clip;
    loadClip(clip, ext).then(
      (url) => live && setLoadedClip({ clip, url }),
      () => live && setLoadedClip({ clip, url: clipUrl(clip, ext) }),
    );
    return () => {
      live = false;
    };
  }, [step.clip, open]);

  // Once the clip is there it plays from its first frame, by itself, unless the user wants less motion. During the
  // setup step the first clip only loads; it plays when the setup is left.
  useEffect(() => {
    const v = video.current;
    if (!open || setup || !src || !v || prefersReducedMotion()) return;
    v.currentTime = 0;
    void v.play?.()?.catch(() => {}); // a webview that blocks autoplay leaves the poster, with Play again
  }, [src, open, setup]);

  const finish = () => {
    setSeen(WELCOME_VERSION);
    setOpen(false);
  };
  const play = () => {
    const v = video.current;
    if (!v) return;
    v.currentTime = 0;
    setPlayed(true);
    void v.play?.()?.catch(() => {});
  };

  return (
    <dialog
      ref={ref}
      aria-label={t("welcome.label")}
      // Esc: closes like Skip.
      onCancel={(e) => {
        e.preventDefault();
        finish();
      }}
      onClose={() => open && finish()}
      // Narrow window: the clip stacks on top, as wide as 640 px, and less on a short window so the clip, the text and
      // the buttons fit (the 4:3 clip is 3/4 of the width, the rest about 250 px). From 720 px: the clip (3/5 of the
      // width, 4:3) beside the text, up to 960 px, and no taller than the window.
      className="m-auto w-[min(640px,92vw,calc((100vh_-_250px)_*_4_/_3))] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/60 min-[720px]:w-[min(960px,92vw,calc((100vh_-_64px)_/_0.45))]"
    >
      <div
        className={`flex flex-col ${setup ? "" : "min-[720px]:grid min-[720px]:grid-cols-[3fr_2fr]"}`}
        data-testid="welcome"
        data-step={setup ? "setup" : step.id}
      >
        {setup && <WelcomeSetup />}
        {!setup && (
          <div className="relative aspect-[4/3] w-full self-start overflow-hidden rounded-t-lg bg-black min-[720px]:rounded-l-lg min-[720px]:rounded-tr-none">
            {failed ? (
              // The webview could not play the clip: its last frame tells the step without moving.
              <img
                src={clipUrl(step.clip, "png")}
                alt=""
                data-testid="welcome-poster"
                className="size-full object-contain"
              />
            ) : (
              // Keyed by the step, so each clip starts fresh.
              <video
                key={step.clip}
                ref={video}
                src={src ?? undefined}
                muted
                playsInline
                preload="auto"
                poster={clipUrl(step.clip, "png")}
                aria-hidden
                data-testid="welcome-clip"
                className="size-full object-contain"
                onPlay={() => setPlayed(true)}
                onError={() => setFailed(true)}
              />
            )}
            {!failed && (
              <Button
                variant="ghost"
                className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/55 text-white hover:bg-black/75 hover:text-white"
                onClick={play}
              >
                {reduced && !played ? <Play size={12} /> : <RotateCcw size={12} />}
                {reduced && !played ? t("welcome.play") : t("welcome.playAgain")}
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col justify-between gap-3 min-[720px]:min-h-0">
          {!setup && (
            <div className="flex flex-col gap-1 px-4 pt-3 min-[720px]:pt-5" aria-live="polite">
              <h2 className="text-sm font-semibold">{t(step.title)}</h2>
              <p className="min-h-10 max-w-[65ch] text-[var(--muted)]">{t(step.text)}</p>
            </div>
          )}
          <div className={`flex flex-col gap-3 px-4 pb-3 pt-2 ${setup ? "" : "min-[720px]:pb-4"}`}>
            <fieldset className={`m-0 flex items-center gap-1.5 border-0 p-0 ${setup ? "hidden" : ""}`}>
              <legend className="sr-only">{t("welcome.steps.label")}</legend>
              {WELCOME_STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={t("welcome.steps.goTo", { n: i + 1, total: WELCOME_STEPS.length, title: t(s.title) })}
                  aria-current={i === index ? "step" : undefined}
                  onClick={() => setIndex(i)}
                  className={`size-2 rounded-full ${i === index ? "bg-[var(--accent)]" : "bg-[var(--border)] hover:bg-[var(--muted)]"}`}
                />
              ))}
            </fieldset>
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" className="px-2" onClick={finish}>
                {t("welcome.skip")}
              </Button>
              <div className="flex items-center gap-1.5">
                <Button
                  className={`flex items-center gap-1 ${setup ? "hidden" : ""}`}
                  disabled={index === 0}
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft size={13} />
                  {t("welcome.back")}
                </Button>
                <Button
                  ref={next}
                  variant="primary"
                  className="flex items-center gap-1"
                  onClick={() => (setup ? setSetup(false) : last ? finish() : setIndex((i) => i + 1))}
                >
                  {setup ? t("welcome.setup.continue") : last ? t("welcome.getStarted") : t("welcome.next")}
                  {(setup || !last) && <ChevronRight size={13} />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}
