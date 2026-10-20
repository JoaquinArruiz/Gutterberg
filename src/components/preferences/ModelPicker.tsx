import { Check, ChevronDown, RefreshCw } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AiProvider, DEFAULT_MODEL, providerHost } from "../../lib/ai";
import { aiListModels, type ModelInfo } from "../../lib/ai-api";
import { formatError, toAppError } from "../../lib/errors";
import { usePreferencesStore } from "../../stores/preferences-store";

/** Most options drawn at once; typing narrows the rest down (OpenRouter has hundreds). */
const MAX_SHOWN = 150;

type ListState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; models: ModelInfo[]; fetchedAt: number; refreshError: string | null }
  | { kind: "error"; text: string };

/** Anthropic and Gemini answer their list only with a key; the others are asked without one. */
const listNeedsKey = (p: AiProvider) => p === "anthropic" || p === "gemini";

/**
 * The model setting: a field that lists the provider's own models as you type, fetched when AI Mode is on and a
 * provider is chosen. Any id can still be typed, which is the whole control when the list cannot be had.
 */
export function ModelPicker({ provider, keySaved }: { provider: AiProvider; keySaved: boolean | null }) {
  const { t, i18n } = useTranslation();
  const ai = usePreferencesStore((s) => s.prefs.ai);
  const value = ai.providers[provider].model;
  const host = providerHost(ai);
  const cacheKey = `${provider}|${ai.providers[provider].baseUrl.trim()}|${ai.providers[provider].workspaceId.trim()}|${keySaved === true}`;
  const [list, setList] = useState<ListState>({ kind: "idle" });
  const [reload, setReload] = useState(0);
  // Set by the reload button, so only that asks the provider again; anything else gets the saved list.
  const refreshNext = useRef(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  // Typing filters; opening the list on a picked model shows them all.
  const [filtering, setFiltering] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();

  // The list Rust saved comes back without asking the provider; `reload` asks it again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `cacheKey` stands for the settings the list depends on
  useEffect(() => {
    if (listNeedsKey(provider) && keySaved !== true) {
      setBusy(false);
      return setList({ kind: "idle" });
    }
    let stale = false;
    const refresh = refreshNext.current;
    refreshNext.current = false;
    setList((l) => (refresh && l.kind === "ready" ? l : { kind: "loading" }));
    setBusy(true);
    aiListModels(refresh)
      .then(
        (r) =>
          !stale &&
          setList({
            kind: "ready",
            models: r.models,
            fetchedAt: r.fetched_at,
            refreshError: r.refresh_error ? formatError(toAppError(r.refresh_error)) : null,
          }),
      )
      .catch((e) => !stale && setList({ kind: "error", text: formatError(toAppError(e)) }))
      .finally(() => !stale && setBusy(false));
    return () => {
      stale = true;
    };
  }, [cacheKey, reload]);

  const models = list.kind === "ready" ? list.models : [];
  const shown = useMemo(() => {
    const q = filtering ? text.trim().toLowerCase() : "";
    const hits = q ? models.filter((m) => m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q)) : models;
    return hits.slice(0, MAX_SHOWN);
  }, [models, text, filtering]);

  const commit = (v: string) =>
    v !== value && usePreferencesStore.getState().setAiProviderSettings(provider, { model: v });
  const close = () => setOpen(false);
  const pick = (m: ModelInfo) => {
    setText(m.id);
    commit(m.id);
    close();
  };
  const openList = (filter: boolean) => {
    if (models.length === 0) return;
    setFiltering(filter);
    setActive(Math.max(0, filter ? 0 : models.findIndex((m) => m.id === value)));
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const flip = below < 200 && above > below;
    const height = Math.min(Math.max(96, flip ? above : below), 280);
    setPos({ left: r.left, width: r.width, top: flip ? r.top - 4 - height : r.bottom + 4, maxHeight: height });
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `close` only sets state; listeners are bound per open
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!box.current?.contains(target) && !document.getElementById(`${id}-list`)?.contains(target)) close();
    };
    // Scrolling anything but the list would leave the fixed list stranded.
    const away = (e: Event) => {
      if (!document.getElementById(`${id}-list`)?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", away, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", away, true);
    };
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `pos` re-runs this once the list is positioned
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-list`)
        ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, pos]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openList(false);
      } else if (e.key === "Enter") field.current?.blur();
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(shown.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (shown[active]) pick(shown[active]);
        else close();
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // don't also close Preferences
        close();
        break;
      case "Tab":
        close();
        break;
    }
  };

  const status = (() => {
    switch (list.kind) {
      case "loading":
        return t("ai.models.loading", { host });
      case "ready": {
        const when = new Date(list.fetchedAt * 1000).toLocaleDateString(i18n.language);
        if (list.refreshError) return t("ai.models.refreshFailed", { date: when, error: list.refreshError });
        return models.length > 0
          ? t("ai.models.count", { count: models.length, host, date: when })
          : t("ai.models.empty", { host });
      }
      case "error":
        return t("ai.models.failed", { error: list.text });
      default:
        return listNeedsKey(provider) && keySaved === false ? t("ai.models.needsKey") : null;
    }
  })();

  const warn = list.kind === "error" || (list.kind === "ready" && list.refreshError !== null);

  return (
    <>
      <div ref={box} className="relative flex gap-1.5">
        <div className="relative min-w-0 flex-1">
          <input
            ref={field}
            role="combobox"
            aria-label={t("ai.settings.model")}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? `${id}-list` : undefined}
            aria-activedescendant={open && shown[active] ? `${id}-opt-${active}` : undefined}
            className="w-full rounded border border-[var(--border)] bg-[var(--bg)] py-1 pr-6 pl-2 outline-none focus-visible:border-[var(--accent)]"
            value={text}
            placeholder={DEFAULT_MODEL[provider] || t("ai.models.placeholder")}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setText(e.target.value);
              if (models.length > 0) {
                setFiltering(true);
                setActive(0);
                setOpen(true);
              }
            }}
            onBlur={(e) => {
              // A click in the list picks; it is not a leave.
              if (document.getElementById(`${id}-list`)?.contains(e.relatedTarget as Node)) return;
              commit(text.trim());
            }}
            onKeyDown={onKeyDown}
          />
          {models.length > 0 && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={t("ai.models.show")}
              className="absolute inset-y-0 right-1 flex items-center text-[var(--muted)] hover:text-[var(--fg)]"
              onClick={() => {
                if (open) close();
                else {
                  openList(false);
                  field.current?.focus();
                }
              }}
            >
              <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
        {(list.kind === "ready" || list.kind === "error") && (
          <button
            type="button"
            title={t("ai.models.reload")}
            aria-label={t("ai.models.reload")}
            className="flex shrink-0 items-center rounded border border-[var(--border)] px-1.5 text-[var(--muted)] hover:text-[var(--fg)]"
            disabled={busy}
            onClick={() => {
              refreshNext.current = true;
              setReload((n) => n + 1);
            }}
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>
      {open && pos && shown.length > 0 && (
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label={t("ai.settings.model")}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
          className="z-[60] overflow-y-auto rounded border border-[var(--border)] bg-[var(--panel)] p-1 shadow-xl shadow-black/40"
        >
          {shown.map((m, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useFocusableInteractive: keyboard handled on the field via aria-activedescendant
            <div
              key={m.id}
              id={`${id}-opt-${i}`}
              data-index={i}
              role="option"
              aria-selected={m.id === value}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()} // keep the focus in the field
              onClick={() => pick(m)}
              title={m.name ? `${m.name} (${m.id})` : m.id}
              className={`flex cursor-default items-center gap-2 rounded px-2 py-1 ${i === active ? "bg-[var(--hover)]" : ""}`}
            >
              <span className="flex w-3 shrink-0 text-[var(--accent)]">{m.id === value && <Check size={12} />}</span>
              <span className="min-w-0 flex-1 truncate">
                {m.id}
                {m.name && <span className="text-[var(--muted)]"> · {m.name}</span>}
              </span>
              {m.images === false && <span className="shrink-0 text-[var(--muted)]">{t("ai.models.textOnly")}</span>}
            </div>
          ))}
        </div>
      )}
      {status && (
        <p className={warn ? "text-red-300" : "text-[var(--muted)]"} role={warn ? "alert" : undefined}>
          {status}
        </p>
      )}
    </>
  );
}
