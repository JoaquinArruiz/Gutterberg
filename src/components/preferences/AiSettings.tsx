import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AI_PROVIDERS, type AiProvider, DEFAULT_BASE_URL, DEFAULT_MODEL, needsKey } from "../../lib/ai";
import { aiDeleteKey, aiKeyStatus, aiSetKey, aiTestConnection } from "../../lib/ai-api";
import { formatError, toAppError } from "../../lib/errors";
import { usePreferencesStore } from "../../stores/preferences-store";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { Field } from "./Field";

const input =
  "w-full rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1 outline-none focus-visible:border-[var(--accent)]";

/** A text field that keeps what is typed until it is left, so the saved value is never trimmed under the cursor. */
function TextSetting({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      aria-label={label}
      className={input}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

/**
 * Preferences › AI Mode. With the switch off this is one sentence and the switch: everything else, here and
 * in the rest of the app, appears only when AI Mode is on. The key is typed here once, goes to the system
 * keychain and is never shown again.
 */
export function AiSettings() {
  const { t } = useTranslation();
  const ai = usePreferencesStore((s) => s.prefs.ai);
  const set = usePreferencesStore.getState();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  // Turning AI Mode on asks first; nothing changes until the user says Okay.
  const [asking, setAsking] = useState(false);
  const warning = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = warning.current;
    if (!d) return;
    if (asking && !d.open) d.showModal();
    if (!asking && d.open) d.close();
  }, [asking]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const provider = ai.provider;
  const settings = ai.providers[provider];

  // Whether a key is saved for the chosen provider. Asked of the keychain, never read back.
  useEffect(() => {
    setNotice(null);
    setKey("");
    if (!ai.enabled || !needsKey(provider)) return setSaved(null);
    let stale = false;
    aiKeyStatus(provider)
      .then((has) => !stale && setSaved(has))
      .catch((e) => {
        if (stale) return;
        setSaved(null);
        setNotice({ ok: false, text: formatError(toAppError(e)) });
      });
    return () => {
      stale = true;
    };
  }, [ai.enabled, provider]);

  const saveKey = async () => {
    setBusy("save");
    setNotice(null);
    try {
      await aiSetKey(provider, key);
      setKey("");
      setSaved(true);
    } catch (e) {
      setNotice({ ok: false, text: formatError(toAppError(e)) });
    } finally {
      setBusy(null);
    }
  };
  const removeKey = async () => {
    setNotice(null);
    try {
      await aiDeleteKey(provider);
      setSaved(false);
    } catch (e) {
      setNotice({ ok: false, text: formatError(toAppError(e)) });
    }
  };
  const test = async () => {
    setBusy("test");
    setNotice(null);
    try {
      const usage = await aiTestConnection();
      setNotice({
        ok: true,
        text: t("ai.settings.testOk", { input: usage.input_tokens, output: usage.output_tokens }),
      });
    } catch (e) {
      setNotice({ ok: false, text: formatError(toAppError(e)) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <dialog
        ref={warning}
        data-testid="ai-experimental"
        aria-label={t("ai.experimental.title")}
        onClose={() => setAsking(false)}
        className="m-auto w-[440px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold">{t("ai.experimental.title")}</h2>
          <p>{t("ai.experimental.text")}</p>
          <div className="flex justify-end gap-2">
            <Button size="md" onClick={() => setAsking(false)}>
              {t("ai.experimental.cancel")}
            </Button>
            <Button
              size="md"
              variant="primary"
              onClick={() => {
                setAsking(false);
                set.setAiEnabled(true);
              }}
            >
              {t("ai.experimental.ok")}
            </Button>
          </div>
        </div>
      </dialog>
      <Field label={t("ai.settings.title")}>
        <Switch
          checked={ai.enabled}
          onChange={(on) => (on ? setAsking(true) : set.setAiEnabled(false))}
          label={t("ai.settings.enable")}
          hint={t("ai.settings.enableNote")}
        />
      </Field>

      {ai.enabled && (
        <div data-ai="settings">
          <Field label={t("ai.settings.provider")}>
            <Select<AiProvider>
              label={t("ai.settings.provider")}
              value={provider}
              onChange={set.setAiProvider}
              options={AI_PROVIDERS.map((p) => ({ value: p, label: t(`ai.providers.${p}`) }))}
            />
          </Field>

          <Field label={t("ai.settings.model")}>
            <TextSetting
              label={t("ai.settings.model")}
              value={settings.model}
              placeholder={DEFAULT_MODEL[provider]}
              onCommit={(model) => set.setAiProviderSettings(provider, { model })}
            />
            <p className="text-[var(--muted)]">{t(`ai.modelHint.${provider}`)}</p>
          </Field>

          {provider === "anthropic" && (
            <Field label={t("ai.settings.workspace")}>
              <TextSetting
                label={t("ai.settings.workspace")}
                value={settings.workspaceId}
                placeholder="wrkspc_…"
                onCommit={(workspaceId) => set.setAiProviderSettings(provider, { workspaceId })}
              />
              <p className="text-[var(--muted)]">{t("ai.settings.workspaceNote")}</p>
            </Field>
          )}

          {(provider === "openai_compatible" || provider === "ollama") && (
            <Field label={t("ai.settings.baseUrl")}>
              <TextSetting
                label={t("ai.settings.baseUrl")}
                value={settings.baseUrl}
                placeholder={DEFAULT_BASE_URL[provider]}
                onCommit={(baseUrl) => set.setAiProviderSettings(provider, { baseUrl })}
              />
              <p className="text-[var(--muted)]">{t("ai.settings.baseUrlNote")}</p>
            </Field>
          )}

          {needsKey(provider) && (
            <Field label={t("ai.settings.key")}>
              {saved ? (
                <p data-testid="ai-key-saved">{t("ai.settings.keySaved")}</p>
              ) : (
                <p className="text-[var(--muted)]">{t("ai.settings.keyMissing")}</p>
              )}
              <div className="flex gap-1.5">
                <input
                  type="password"
                  aria-label={t("ai.settings.keyField")}
                  className={input}
                  value={key}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={saved ? t("ai.settings.keyReplace") : t("ai.settings.keyPlaceholder")}
                  onChange={(e) => setKey(e.target.value)}
                />
                <Button size="md" disabled={key.trim() === "" || busy !== null} onClick={saveKey}>
                  {t("ai.settings.keySave")}
                </Button>
              </div>
              {saved && (
                <div>
                  <Button size="md" onClick={removeKey}>
                    {t("ai.settings.keyRemove")}
                  </Button>
                </div>
              )}
              <p className="text-[var(--muted)]">{t("ai.settings.keyNote")}</p>
            </Field>
          )}

          <Field label={t("ai.settings.privacy")}>
            <Switch
              checked={ai.sendImages}
              onChange={set.setAiSendImages}
              label={t("ai.settings.sendImages")}
              hint={ai.sendImages ? t("ai.settings.sendImagesOn") : t("ai.settings.sendImagesOff")}
            />
          </Field>

          <Field label={t("ai.settings.test")}>
            <div>
              <Button
                size="md"
                variant="ai"
                busy={busy === "test"}
                disabled={busy !== null}
                title={t("ai.settings.testSends", { provider: t(`ai.providers.${ai.provider}`) })}
                onClick={test}
              >
                {busy === "test" ? t("ai.settings.testing") : t("ai.settings.testButton")}
              </Button>
            </div>
            {notice && (
              <p className={notice.ok ? "text-emerald-400" : "text-red-300"} role={notice.ok ? "status" : "alert"}>
                {notice.ok ? "✓ " : "⚠ "}
                {notice.text}
              </p>
            )}
          </Field>
        </div>
      )}
    </>
  );
}
