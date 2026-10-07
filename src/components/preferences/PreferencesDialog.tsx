import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MEASUREMENT_UNITS, type MeasurementUnit, UNIT_LABEL } from "../../lib/measurement";
import {
  type DefaultWorkspace,
  type LivePreviewPreference,
  THEMES,
  type ThemePreference,
  WORKSPACE_LABEL,
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
  POSITION_LABEL,
  PRESET_LABEL,
} from "../../lib/workspace-layout";
import { usePreferencesStore } from "../../stores/preferences-store";
import { type PrefsSection, useUiStore } from "../../stores/ui-store";
import { Select } from "../ui/Select";
import { LayoutPreview } from "./LayoutPreview";

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
      aria-label="Preferences"
      onClose={() => setOpen(false)}
      // A click on the backdrop (the dialog element itself) closes it.
      onMouseDown={(e) => e.target === ref.current && setOpen(false)}
      className="m-auto w-[680px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-0 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <h2 className="text-sm font-semibold">Preferences</h2>
        <button
          type="button"
          aria-label="Close preferences"
          onClick={() => setOpen(false)}
          className="rounded p-1 hover:bg-[var(--hover)]"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex h-[480px] max-h-[70vh]">
        <nav className="w-36 shrink-0 border-r border-[var(--border)] p-2" aria-label="Preferences sections">
          {SECTIONS.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setSection(s)}
              aria-current={section === s}
              className={`block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--hover)] ${section === s ? "bg-[var(--active)]" : ""}`}
            >
              {s}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {section === "General" && (
            <Field label="Measurement unit">
              <Select<MeasurementUnit>
                label="Measurement unit"
                value={prefs.measurement.unit}
                onChange={store.setUnit}
                options={MEASUREMENT_UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }))}
              />
              <p className="text-[var(--muted)]">
                Only changes how lengths are shown and typed. The document itself is never altered.
              </p>
            </Field>
          )}

          {section === "General" && (
            <Field label="Help tips">
              <div>
                <button type="button" className={btn} disabled={hiddenTips === 0} onClick={store.resetHints}>
                  Enable all help tips
                </button>
              </div>
              <p className="text-[var(--muted)]">
                {hiddenTips === 0
                  ? "All help tips are enabled."
                  : `${hiddenTips} help tip${hiddenTips === 1 ? " is" : "s are"} hidden because you closed ${hiddenTips === 1 ? "it" : "them"}. Enable them to see ${hiddenTips === 1 ? "it" : "them"} again.`}
              </p>
            </Field>
          )}

          {section === "Workspace" && (
            <>
              <Field label="Visible views">
                <p className="text-[var(--muted)]">
                  The view switcher shows these, in this order. At least one must stay enabled.
                </p>
                {[...visibleModes, ...hiddenModes].map((mode: WorkspaceMode) => {
                  const on = visibleModes.includes(mode);
                  const i = visibleModes.indexOf(mode);
                  return (
                    <div key={mode} className="flex items-center gap-2">
                      <label className="flex flex-1 items-center gap-2">
                        <input
                          type="checkbox"
                          aria-label={`Show ${WORKSPACE_LABEL[mode]} view`}
                          checked={on}
                          disabled={on && visibleModes.length === 1}
                          onChange={(e) => store.setVisibleMode(mode, e.target.checked)}
                        />
                        {WORKSPACE_LABEL[mode]}
                      </label>
                      {on && (
                        <>
                          <button
                            type="button"
                            aria-label={`Move ${WORKSPACE_LABEL[mode]} earlier`}
                            disabled={i === 0}
                            onClick={() => store.moveVisibleMode(mode, -1)}
                            className="rounded p-1 hover:bg-[var(--hover)] disabled:opacity-30"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${WORKSPACE_LABEL[mode]} later`}
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
              <Field label="Default view">
                <Select<DefaultWorkspace>
                  label="Default view"
                  value={prefs.workspace.defaultMode}
                  onChange={store.setDefaultMode}
                  options={[
                    { value: "last", label: "Last used" },
                    ...visibleModes.map((m) => ({ value: m as DefaultWorkspace, label: WORKSPACE_LABEL[m] })),
                  ]}
                />
                <p className="text-[var(--muted)]">
                  Used when a document opens. Switching views while editing does not change it.
                </p>
              </Field>

              <Field label="Layout">
                <div className="flex gap-4">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[var(--muted)]">Preset</span>
                      <Select<LayoutPresetId>
                        label="Layout preset"
                        value={preset}
                        onChange={(v) => v !== "custom" && store.applyLayoutPreset(v)}
                        options={[
                          ...(preset === "custom"
                            ? [{ value: "custom" as const, label: PRESET_LABEL.custom, disabled: true }]
                            : []),
                          ...LAYOUT_PRESETS.map((id) => ({ value: id as LayoutPresetId, label: PRESET_LABEL[id] })),
                        ]}
                      />
                    </div>
                    {PANEL_IDS.map((id) => (
                      <div key={id} className="flex items-center justify-between gap-2">
                        <span className="text-[var(--muted)]">{PANEL_DEFS[id].title} panel</span>
                        <Select<PanelPosition>
                          label={`${PANEL_DEFS[id].title} panel position`}
                          value={layout.panels.find((p) => p.id === id)?.position ?? "hidden"}
                          onChange={(pos) => store.setPanelPosition(id, pos)}
                          options={PANEL_DEFS[id].positions
                            .filter((pos) => canPlace(id, pos))
                            .map((pos) => ({ value: pos, label: POSITION_LABEL[pos] }))}
                        />
                      </div>
                    ))}
                  </div>
                  <LayoutPreview panels={layout.panels} />
                </div>
                <p className="text-[var(--muted)]">
                  Changes apply immediately. The Panels menu in the toolbar can always bring a hidden panel back.
                </p>
              </Field>

              <Field label="Behavior">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={layout.rememberSizes}
                    onChange={(e) => store.setRememberSizes(e.target.checked)}
                  />
                  Remember panel sizes
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={layout.rememberCollapsed}
                    onChange={(e) => store.setRememberCollapsed(e.target.checked)}
                  />
                  Remember collapsed panels
                </label>
                <div>
                  <button type="button" className={btn} onClick={store.resetWorkspace}>
                    Reset workspace layout
                  </button>
                </div>
                <p className="text-[var(--muted)]">
                  Restores panel positions and sizes, the visible views and the default view. Units, theme and Live
                  Preview are kept.
                </p>
              </Field>
            </>
          )}

          {section === "Preview" && (
            <Field label="Live preview">
              <Radio<LivePreviewPreference>
                name="live"
                value="always"
                current={prefs.preview.livePreview}
                onSelect={store.setLivePreview}
                label="Always on"
                hint="The output follows every change."
              />
              <Radio<LivePreviewPreference>
                name="live"
                value="manual"
                current={prefs.preview.livePreview}
                onSelect={store.setLivePreview}
                label="Manual"
                hint="The output updates only when you press Update preview."
              />
              <p className="text-[var(--muted)]">
                With Manual, the Output tab refreshes the preview each time you open it, and the Split view has a
                refresh button (a dot on it means the preview is out of date). Changing this applies to the open
                document immediately.
              </p>
            </Field>
          )}

          {section === "Appearance" && (
            <Field label="Theme">
              {THEMES.map((t) => (
                <Radio<ThemePreference>
                  key={t}
                  name="theme"
                  value={t}
                  current={prefs.appearance.theme}
                  onSelect={store.setTheme}
                  label={t[0].toUpperCase() + t.slice(1)}
                />
              ))}
            </Field>
          )}

          {section === "About" && (
            <Field label="About">
              <p>Created by Joaquin Arruiz</p>
            </Field>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5">
        {confirmReset ? (
          <>
            <span>
              Reset all preferences? This restores the default application settings. Your document is not affected.
            </span>
            <span className="flex gap-2">
              <button type="button" className={btn} onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={`${btn} border-red-400/60 text-red-300`}
                onClick={() => {
                  store.resetToDefaults();
                  setConfirmReset(false);
                }}
              >
                Reset
              </button>
            </span>
          </>
        ) : (
          <>
            <button type="button" className={btn} onClick={() => setConfirmReset(true)}>
              Reset to defaults
            </button>
            <button type="button" className={btn} onClick={() => setOpen(false)}>
              Close
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
