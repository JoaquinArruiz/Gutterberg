import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GroupGrid } from "../../lib/document-layout";
import { formatMeasurement } from "../../lib/measurement";
import { MAX_PRESET_NAME } from "../../lib/preferences";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore, useUnit } from "../../stores/preferences-store";
import { Button } from "../ui/Button";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { Select } from "../ui/Select";

/**
 * Named grids: save the viewed group's rows, columns and source gap under a name ("3×3, 0.0 mm") and
 * apply it to any other page group. Presets belong to the user, not to a project, so they are there in
 * every project.
 */
export function PresetsSection({ grid, page }: { grid: GroupGrid; page: number }) {
  const { t } = useTranslation();
  const unit = useUnit();
  const presets = usePreferencesStore((s) => s.prefs.presets);
  const savePreset = usePreferencesStore((s) => s.savePreset);
  const deletePreset = usePreferencesStore((s) => s.deletePreset);
  const setGrid = useLayoutStore((s) => s.setGrid);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState("");

  const suggestion = `${grid.rows}×${grid.columns}, ${formatMeasurement(grid.sourceGapXMm, unit, 1)}`;
  const current = presets.find((p) => p.name === chosen) ?? presets[0];

  const save = () => {
    const label = name.trim() || suggestion;
    savePreset({
      name: label,
      rows: grid.rows,
      columns: grid.columns,
      sourceGapXMm: grid.sourceGapXMm,
      sourceGapYMm: grid.sourceGapYMm,
      sourceGapLinked: grid.sourceGapLinked,
    });
    setChosen(label.trim().slice(0, MAX_PRESET_NAME));
    setName("");
  };

  return (
    <CollapsibleSection id="cards.presets" title={t("presets.title")} defaultOpen={false}>
      {presets.length === 0 ? (
        <p className="text-[var(--muted)]">{t("presets.none")}</p>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <Select
              className="min-w-0 flex-1 [&>button]:w-full [&>button]:min-w-0"
              label={t("presets.choose")}
              value={current?.name ?? ""}
              onChange={setChosen}
              options={presets.map((p) => ({ value: p.name, label: p.name }))}
            />
            <Button
              aria-label={t("presets.delete")}
              title={t("presets.delete")}
              disabled={!current}
              onClick={() => current && deletePreset(current.name)}
            >
              <Trash2 size={12} />
            </Button>
          </div>
          <div>
            <Button
              disabled={!current}
              title={t("presets.applyTitle")}
              onClick={() => {
                if (!current) return;
                const { name: _name, ...values } = current;
                setGrid(page, values);
              }}
            >
              {t("presets.apply")}
            </Button>
          </div>
        </>
      )}
      <div className="flex items-center gap-1">
        <input
          type="text"
          aria-label={t("presets.name")}
          placeholder={suggestion}
          maxLength={MAX_PRESET_NAME}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="min-w-0 flex-1 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5"
        />
        <Button onClick={save} title={t("presets.saveTitle")}>
          {t("presets.save")}
        </Button>
      </div>
    </CollapsibleSection>
  );
}
