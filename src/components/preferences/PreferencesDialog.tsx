import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DECIMAL_PREFERENCES,
  type DecimalPreference,
  LANGUAGE_NAME,
  LANGUAGES,
  type LanguagePreference,
} from "../../lib/locale";
import { MEASUREMENT_UNITS, type MeasurementUnit } from "../../lib/measurement";
import {
  type DefaultWorkspace,
  type LivePreviewPreference,
  THEMES,
  type ThemePreference,
  WORKSPACE_MODES,
  type WorkspaceMode,
} from "../../lib/preferences";
import {
  canPlace,
  detectPreset,
  LAYOUT_PRESETS,
  type LayoutPresetId,
  PANEL_DEFS,
  PANEL_IDS,
  type PanelPosition,
} from "../../lib/workspace-layout";
import { usePreferencesStore } from "../../stores/preferences-store";
import { type PrefsSection, useUiStore } from "../../stores/ui-store";
import { Select } from "../ui/Select";
import { LayoutPreview } from "./LayoutPreview";

/** The catalog key of each decimal choice. */
const DECIMAL_LABEL = { auto: "decimalAuto", dot: "decimalDot", comma: "decimalComma" } as const;

const SECTIONS: PrefsSection[] = ["General", "Workspace", "Preview", "Appearance", "About"];
type Section = PrefsSection;

const btn = "rounded border border-[var(--border)] px-3 py-1 hover:bg-[var(--hover)] disabled:opacity-40";

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="mb-5">
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{label}</div>
    <div className="flex flex-col gap-1.5">{children}</div>
  </div>
);

function Radio<T extends string>({
  name,
  value,
  current,
  onSelect,
  label,
  hint,
}: {
  name: string;
  value: T;
  current: T;
  onSelect: (v: T) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2">
      <input type="radio" name={name} checked={current === value} onChange={() => onSelect(value)} className="mt-0.5" />
      <span>
        {label}
        {hint && <span className="block text-[var(--muted)]">{hint}</span>}
      </span>
    </label>
  );
}

/** Application preferences. Document settings (gaps, page, margins...) are NOT here. */
export function PreferencesDialog() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.prefsOpen);
  const setOpen = useUiStore((s) => s.setPrefsOpen);
  const ref = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<Section>("General");
  const [confirmReset, setConfirmReset] = useState(false);

  const store = usePreferencesStore();
  const { prefs } = store;
  const hiddenTips = Object.keys(prefs.help.dismissedHints).length;
  const { visibleModes } = prefs.workspace;
  const layout = prefs.workspace.layout;
  const preset = detectPreset(layout);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      // Opened from a link ("Open Preferences" in a tip)? Land on that section.
      const target = useUiStore.getState().prefsSection;
      if (target) setSection(target);
    }
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) setConfirmReset(false);
  }, [open]);

  const hiddenModes = WORKSPACE_MODES.filter((m) => !visibleModes.includes(m));

  return (
    <dialog
      ref={ref}
      aria-label={t("preferences.title")}
      onClose={() => setOpen(false)}
      // A click on the backdrop (the dialog element itself) closes it.
      onMouseDown={(e) => e.target === ref.current && setOpen(false)}
      className="m-auto w-[680px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <h2 className="text-sm font-semibold">{t("preferences.title")}</h2>
        <button
          type="button"
          aria-label={t("preferences.close")}
          onClick={() => setOpen(false)}
          className="rounded p-1 hover:bg-[var(--hover)]"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex h-[480px] max-h-[70vh]">
        <nav className="w-36 shrink-0 border-r border-[var(--border)] p-2" aria-label={t("preferences.navLabel")}>
          {SECTIONS.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setSection(s)}
              aria-current={section === s}
              className={`block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--hover)] ${section === s ? "bg-[var(--active)]" : ""}`}
            >
              {t(`preferences.sections.${s}`)}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {section === "General" && (
            <Field label={t("preferences.general.unit")}>
              <Select<MeasurementUnit>
                label={t("preferences.general.unit")}
                value={prefs.measurement.unit}
                onChange={store.setUnit}
                options={MEASUREMENT_UNITS.map((u) => ({ value: u, label: t(`preferences.units.${u}`) }))}
              />
              <p className="text-[var(--muted)]">{t("preferences.general.unitNote")}</p>
            </Field>
          )}

          {section === "General" && (
            <Field label={t("preferences.general.language")}>
              <Select<LanguagePreference>
                label={t("preferences.general.language")}
                value={prefs.locale.language}
                onChange={store.setLanguage}
                options={[
                  { value: "system", label: t("preferences.general.languageSystem") },
                  ...LANGUAGES.map((l) => ({ value: l as LanguagePreference, label: LANGUAGE_NAME[l] })),
                ]}
              />
              <p className="text-[var(--muted)]">{t("preferences.general.languageNote")}</p>
            </Field>
          )}

          {section === "General" && (
            <Field label={t("preferences.general.decimal")}>
              <Select<DecimalPreference>
                label={t("preferences.general.decimal")}
                value={prefs.locale.decimal}
                onChange={store.setDecimal}
                options={DECIMAL_PREFERENCES.map((d) => ({
                  value: d,
                  label: t(`preferences.general.${DECIMAL_LABEL[d]}`),
                }))}
              />
              <p className="text-[var(--muted)]">{t("preferences.general.decimalNote")}</p>
            </Field>
          )}

          {section === "General" && (
            <Field label={t("preferences.general.helpTips")}>
              <div>
                <button type="button" className={btn} disabled={hiddenTips === 0} onClick={store.resetHints}>
                  {t("preferences.general.enableTips")}
                </button>
              </div>
              <p className="text-[var(--muted)]">
                {hiddenTips === 0
                  ? t("preferences.general.allTipsOn")
                  : t("preferences.general.tipsHidden", { count: hiddenTips })}
              </p>
            </Field>
          )}

          {section === "Workspace" && (
            <>
              <Field label={t("preferences.workspace.visibleViews")}>
                <p className="text-[var(--muted)]">{t("preferences.workspace.visibleNote")}</p>
                {[...visibleModes, ...hiddenModes].map((mode: WorkspaceMode) => {
                  const on = visibleModes.includes(mode);
                  const i = visibleModes.indexOf(mode);
                  return (
                    <div key={mode} className="flex items-center gap-2">
                      <label className="flex flex-1 items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={t("preferences.workspace.showView", { view: t(`views.${mode}`) })}
                          checked={on}
                          disabled={on && visibleModes.length === 1}
                          onChange={(e) => store.setVisibleMode(mode, e.target.checked)}
                        />
                        {t(`views.${mode}`)}
                      </label>
                      {on && (
                        <>
                          <button
                            type="button"
                            aria-label={t("preferences.workspace.moveEarlier", { view: t(`views.${mode}`) })}
                            disabled={i === 0}
                            onClick={() => store.moveVisibleMode(mode, -1)}
                            className="rounded p-1 hover:bg-[var(--hover)] disabled:opacity-30"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={t("preferences.workspace.moveLater", { view: t(`views.${mode}`) })}
                            disabled={i === visibleModes.length - 1}
                            onClick={() => store.moveVisibleMode(mode, 1)}
                            className="rounded p-1 hover:bg-[var(--hover)] disabled:opacity-30"
                          >
                            <ArrowDown size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </Field>
              <Field label={t("preferences.workspace.defaultView")}>
                <Select<DefaultWorkspace>
                  label={t("preferences.workspace.defaultView")}
                  value={prefs.workspace.defaultMode}
                  onChange={store.setDefaultMode}
                  options={[
                    { value: "last", label: t("preferences.workspace.lastUsed") },
                    ...visibleModes.map((m) => ({ value: m as DefaultWorkspace, label: t(`views.${m}`) })),
                  ]}
                />
                <p className="text-[var(--muted)]">{t("preferences.workspace.defaultNote")}</p>
              </Field>

              <Field label={t("preferences.workspace.layout")}>
                <div className="flex gap-4">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[var(--muted)]">{t("preferences.workspace.preset")}</span>
                      <Select<LayoutPresetId>
                        label={t("preferences.workspace.presetLabel")}
                        value={preset}
                        onChange={(v) => v !== "custom" && store.applyLayoutPreset(v)}
                        options={[
                          ...(preset === "custom"
                            ? [{ value: "custom" as const, label: t("panels.presets.custom"), disabled: true }]
                            : []),
                          ...LAYOUT_PRESETS.map((id) => ({
                            value: id as LayoutPresetId,
                            label: t(`panels.presets.${id}`),
                          })),
                        ]}
                      />
                    </div>
                    {PANEL_IDS.map((id) => (
                      <div key={id} className="flex items-center justify-between gap-2">
                        <span className="text-[var(--muted)]">
                          {t("preferences.workspace.panelRow", { panel: t(`panels.titles.${id}`) })}
                        </span>
                        <Select<PanelPosition>
                          label={t("preferences.workspace.panelPosition", { panel: t(`panels.titles.${id}`) })}
                          value={layout.panels.find((p) => p.id === id)?.position ?? "hidden"}
                          onChange={(pos) => store.setPanelPosition(id, pos)}
                          options={PANEL_DEFS[id].positions
                            .filter((pos) => canPlace(id, pos))
                            .map((pos) => ({ value: pos, label: t(`panels.positions.${pos}`) }))}
                        />
                      </div>
                    ))}
                  </div>
                  <LayoutPreview panels={layout.panels} />
                </div>
                <p className="text-[var(--muted)]">{t("preferences.workspace.layoutNote")}</p>
              </Field>

              <Field label={t("preferences.workspace.behavior")}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={layout.rememberSizes}
                    onChange={(e) => store.setRememberSizes(e.target.checked)}
                  />
                  {t("preferences.workspace.rememberSizes")}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={layout.rememberCollapsed}
                    onChange={(e) => store.setRememberCollapsed(e.target.checked)}
                  />
                  {t("preferences.workspace.rememberCollapsed")}
                </label>
                <div>
                  <button type="button" className={btn} onClick={store.resetWorkspace}>
                    {t("preferences.workspace.resetLayout")}
                  </button>
                </div>
                <p className="text-[var(--muted)]">{t("preferences.workspace.resetNote")}</p>
              </Field>
            </>
          )}

          {section === "Preview" && (
            <Field label={t("preferences.livePreview.title")}>
              <Radio<LivePreviewPreference>
                name="live"
                value="always"
                current={prefs.preview.livePreview}
                onSelect={store.setLivePreview}
                label={t("preferences.livePreview.always")}
                hint={t("preferences.livePreview.alwaysHint")}
              />
              <Radio<LivePreviewPreference>
                name="live"
                value="manual"
                current={prefs.preview.livePreview}
                onSelect={store.setLivePreview}
                label={t("preferences.livePreview.manual")}
                hint={t("preferences.livePreview.manualHint")}
              />
              <p className="text-[var(--muted)]">{t("preferences.livePreview.note")}</p>
            </Field>
          )}

          {section === "Appearance" && (
            <Field label={t("preferences.appearance.theme")}>
              {THEMES.map((theme) => (
                <Radio<ThemePreference>
                  key={theme}
                  name="theme"
                  value={theme}
                  current={prefs.appearance.theme}
                  onSelect={store.setTheme}
                  label={t(`preferences.appearance.${theme}`)}
                />
              ))}
            </Field>
          )}

          {section === "About" && (
            <Field label={t("preferences.about.title")}>
              <p>{t("preferences.about.createdBy")}</p>
            </Field>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5">
        {confirmReset ? (
          <>
            <span>{t("preferences.footer.confirm")}</span>
            <span className="flex gap-2">
              <button type="button" className={btn} onClick={() => setConfirmReset(false)}>
                {t("preferences.footer.cancel")}
              </button>
              <button
                type="button"
                className={`${btn} border-red-400/60 text-red-300`}
                onClick={() => {
                  store.resetToDefaults();
                  setConfirmReset(false);
                }}
              >
                {t("preferences.footer.reset")}
              </button>
            </span>
          </>
        ) : (
          <>
            <button type="button" className={btn} onClick={() => setConfirmReset(true)}>
              {t("preferences.footer.resetDefaults")}
            </button>
            <button type="button" className={btn} onClick={() => setOpen(false)}>
              {t("preferences.footer.close")}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
