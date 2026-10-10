import { ChevronLeft, ChevronRight, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { clipFormat, clipUrl, loadClip, prefersReducedMotion, WELCOME_STEPS, WELCOME_VERSION } from "../../lib/welcome";
import { useDocumentStore } from "../../stores/document-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { useUiStore } from "../../stores/ui-store";
import { Button } from "../ui/Button";

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
  const step = WELCOME_STEPS[index];
  const last = index === WELCOME_STEPS.length - 1;
  const src = loadedClip?.clip === step.clip ? loadedClip.url : null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setIndex(0);
      setPlayed(false);
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

  // Once the clip is there it plays from its first frame, by itself, unless the user wants less motion.
  useEffect(() => {
    const v = video.current;
    if (!open || !src || !v || prefersReducedMotion()) return;
    v.currentTime = 0;
    void v.play?.()?.catch(() => {}); // a webview that blocks autoplay leaves the poster, with Play again
  }, [src, open]);

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
      className="m-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/60"
      style={{ width: "min(560px, 92vw, calc((100vh - 230px) * 16 / 9))" }}
    >
      <div className="flex flex-col" data-testid="welcome" data-step={step.id}>
        <div className="relative aspect-video w-full overflow-hidden rounded-t-lg bg-black">
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

        <div className="flex flex-col gap-1 px-4 pt-3" aria-live="polite">
          <h2 className="text-sm font-semibold">{t(step.title)}</h2>
          <p className="min-h-10 text-[var(--muted)]">{t(step.text)}</p>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-2">
          <Button variant="ghost" className="px-2" onClick={finish}>
            {t("welcome.skip")}
          </Button>
          <fieldset className="m-0 flex items-center gap-1.5 border-0 p-0">
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
          <div className="flex items-center gap-1.5">
            <Button
              className="flex items-center gap-1"
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
              onClick={() => (last ? finish() : setIndex((i) => i + 1))}
            >
              {last ? t("welcome.getStarted") : t("welcome.next")}
              {!last && <ChevronRight size={13} />}
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
