import { ArrowDown, ArrowUp, Eye, LayoutPanelLeft, LifeBuoy, Palette, Settings, Sparkles, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import appIcon from "../../../src-tauri/icons/32x32.png";
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
  LAYOUT_IDS,
  LAYOUT_PANELS,
  LAYOUT_PRESETS,
  type LayoutId,
  type LayoutPresetId,
  PANEL_DEFS,
  type PanelPosition,
} from "../../lib/workspace-layout";
import { usePreferencesStore } from "../../stores/preferences-store";
import { type PrefsSection, useUiStore } from "../../stores/ui-store";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { RadioCard, RadioCardGroup } from "../ui/RadioCard";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { AboutSection } from "./AboutSection";
import { AiSettings } from "./AiSettings";
import { Field } from "./Field";
import { HelpSection } from "./HelpSection";
import { LayoutPreview } from "./LayoutPreview";

/** The catalog key of each decimal choice. */
const DECIMAL_LABEL = { auto: "decimalAuto", dot: "decimalDot", comma: "decimalComma" } as const;

// About is not in this list: it sits alone at the bottom of the navigation.
const SECTIONS: PrefsSection[] = ["General", "Workspace", "Preview", "Appearance", "AI", "Help"];
type Section = PrefsSection;

const ICON_SIZE = 14;
/** Each section's icon. Workspace has the panels menu's; AI the spark, in the AI colour; Help the life buoy; About the app's own icon. */
const SECTION_ICON: Record<Section, React.ReactNode> = {
  General: <Settings size={ICON_SIZE} />,
  Workspace: <LayoutPanelLeft size={ICON_SIZE} />,
  Preview: <Eye size={ICON_SIZE} />,
  Appearance: <Palette size={ICON_SIZE} />,
  AI: <Sparkles size={ICON_SIZE} className="text-[var(--ai)]" />,
  Help: <LifeBuoy size={ICON_SIZE} />,
  About: <img src={appIcon} alt="" width={ICON_SIZE} height={ICON_SIZE} className="rounded-sm" draggable={false} />,
};

/** The layout of one tab: a preset, where each of its panels sits, and a small picture of it. */
function LayoutField({ layoutId }: { layoutId: LayoutId }) {
  const { t } = useTranslation();
  const layout = usePreferencesStore((s) => (layoutId === "cards" ? s.prefs.workspace.layout : s.prefs.print.layout));
  const applyPreset = usePreferencesStore((s) => s.applyLayoutPreset);
  const setPosition = usePreferencesStore((s) => s.setPanelPosition);
  const preset = detectPreset(layout);
  return (
    <Field label={t(layoutId === "cards" ? "preferences.workspace.layoutCards" : "preferences.workspace.layoutPrint")}>
      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--muted)]">{t("preferences.workspace.preset")}</span>
            <Select<LayoutPresetId>
              label={t("preferences.workspace.presetLabel")}
              value={preset}
              onChange={(v) => v !== "custom" && applyPreset(layoutId, v)}
              options={[
                ...(preset === "custom"
                  ? [{ value: "custom" as const, label: t("panels.presets.custom"), disabled: true }]
                  : []),
                ...LAYOUT_PRESETS[layoutId].map((id) => ({
                  value: id as LayoutPresetId,
                  label: t(`panels.presets.${id}`),
                })),
              ]}
            />
          </div>
          {LAYOUT_PANELS[layoutId].map((id) => (
            <div key={id} className="flex items-center justify-between gap-2">
              <span className="text-[var(--muted)]">
                {t("preferences.workspace.panelRow", { panel: t(`panels.titles.${id}`) })}
              </span>
              <Select<PanelPosition>
                label={t("preferences.workspace.panelPosition", { panel: t(`panels.titles.${id}`) })}
                value={layout.panels.find((p) => p.id === id)?.position ?? "hidden"}
                onChange={(pos) => setPosition(id, pos)}
                options={PANEL_DEFS[id].positions
                  .filter((pos) => canPlace(id, pos))
                  .map((pos) => ({ value: pos, label: t(`panels.positions.${pos}`) }))}
              />
            </div>
          ))}
        </div>
        <LayoutPreview
          panels={layout.panels}
          center={t(layoutId === "cards" ? "preferences.layoutPreview.editor" : "preferences.layoutPreview.sheets")}
        />
      </div>
      <p className="text-[var(--muted)]">{t("preferences.workspace.layoutNote")}</p>
    </Field>
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
  const { visibleModes } = prefs.workspace;
  const layout = prefs.workspace.layout;

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
        <nav
          className="flex w-44 shrink-0 flex-col border-r border-[var(--border)] p-2"
          aria-label={t("preferences.navLabel")}
        >
          {[...SECTIONS, "About" as const].map((s) => (
            <Fragment key={s}>
              {s === "About" && <div className="flex-1" />}
              <button
                type="button"
                onClick={() => setSection(s)}
                aria-current={section === s}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--hover)] ${section === s ? "bg-[var(--active)]" : ""}`}
              >
                <span className="flex w-4 shrink-0 justify-center">{SECTION_ICON[s]}</span>
                <span className="min-w-0 flex-1 leading-tight">{t(`preferences.sections.${s}`)}</span>
              </button>
            </Fragment>
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

          {section === "Workspace" && (
            <>
              <Field label={t("preferences.workspace.visibleViews")}>
                <p className="text-[var(--muted)]">{t("preferences.workspace.visibleNote")}</p>
                {[...visibleModes, ...hiddenModes].map((mode: WorkspaceMode) => {
                  const on = visibleModes.includes(mode);
                  const i = visibleModes.indexOf(mode);
                  return (
                    <div key={mode} className="flex items-center gap-2">
                      <Checkbox
                        className="flex-1"
                        aria-label={t("preferences.workspace.showView", { view: t(`views.${mode}`) })}
                        label={t(`views.${mode}`)}
                        checked={on}
                        disabled={on && visibleModes.length === 1}
                        onChange={(show) => store.setVisibleMode(mode, show)}
                      />
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

              {LAYOUT_IDS.map((id) => (
                <LayoutField key={id} layoutId={id} />
              ))}

              <Field label={t("preferences.workspace.behavior")}>
                <Switch
                  checked={layout.rememberSizes}
                  onChange={store.setRememberSizes}
                  label={t("preferences.workspace.rememberSizes")}
                />
                <Switch
                  checked={layout.rememberCollapsed}
                  onChange={store.setRememberCollapsed}
                  label={t("preferences.workspace.rememberCollapsed")}
                />
                <div>
                  <Button size="md" onClick={store.resetWorkspace}>
                    {t("preferences.workspace.resetLayout")}
                  </Button>
                </div>
                <p className="text-[var(--muted)]">{t("preferences.workspace.resetNote")}</p>
              </Field>
            </>
          )}

          {section === "Preview" && (
            <Field label={t("preferences.livePreview.title")}>
              <RadioCardGroup<LivePreviewPreference>
                label={t("preferences.livePreview.title")}
                value={prefs.preview.livePreview}
                onChange={store.setLivePreview}
              >
                <RadioCard
                  value="always"
                  title={t("preferences.livePreview.always")}
                  description={t("preferences.livePreview.alwaysHint")}
                />
                <RadioCard
                  value="manual"
                  title={t("preferences.livePreview.manual")}
                  description={t("preferences.livePreview.manualHint")}
                />
              </RadioCardGroup>
              <p className="text-[var(--muted)]">{t("preferences.livePreview.note")}</p>
            </Field>
          )}

          {section === "Appearance" && (
            <Field label={t("preferences.appearance.theme")}>
              <Segmented<ThemePreference>
                label={t("preferences.appearance.theme")}
                value={prefs.appearance.theme}
                onChange={store.setTheme}
                options={THEMES.map((theme) => ({ value: theme, label: t(`preferences.appearance.${theme}`) }))}
              />
            </Field>
          )}

          {section === "AI" && <AiSettings />}

          {section === "Help" && <HelpSection />}

          {section === "About" && <AboutSection />}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5">
        {confirmReset ? (
          <>
            <span>{t("preferences.footer.confirm")}</span>
            <span className="flex gap-2">
              <Button size="md" onClick={() => setConfirmReset(false)}>
                {t("preferences.footer.cancel")}
              </Button>
              <Button
                size="md"
                variant="danger"
                onClick={() => {
                  store.resetToDefaults();
                  setConfirmReset(false);
                }}
              >
                {t("preferences.footer.reset")}
              </Button>
            </span>
          </>
        ) : (
          <>
            <Button size="md" onClick={() => setConfirmReset(true)}>
              {t("preferences.footer.resetDefaults")}
            </Button>
            <Button size="md" onClick={() => setOpen(false)}>
              {t("preferences.footer.close")}
            </Button>
          </>
        )}
      </div>
    </dialog>
  );
}
