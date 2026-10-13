import { ask } from "@tauri-apps/plugin-dialog";
import type { TFunction } from "i18next";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cardIdKey } from "../../lib/card";
import { scaleCardsXY } from "../../lib/card-edits";
import { formatDecimal } from "../../lib/measurement";
import {
  BUILT_IN_SIZES,
  builtInSize,
  MAX_SIZE_PRESET_NAME,
  presetScales,
  SIZE_RANGE_MM,
  stretches,
  type UserSizePreset,
} from "../../lib/size-presets";
import { ptToMm } from "../../lib/units";
import { useLibraryCards } from "../../lib/use-library-cards";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { Button } from "../ui/Button";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";

const mmText = (mm: number) => formatDecimal(mm, Number.isInteger(mm) ? 0 : 1);
type Sides = "both" | "width" | "height";

/** "63 × 88 mm", or "62 mm wide" / "88 mm high" for a size that fixes one side. */
function sizeText(t: TFunction, p: Pick<UserSizePreset, "widthMm" | "heightMm">): string {
  if (p.widthMm !== null && p.heightMm !== null)
    return t("sizePresets.dims", { width: mmText(p.widthMm), height: mmText(p.heightMm) });
  return p.widthMm !== null
    ? t("sizePresets.wide", { mm: mmText(p.widthMm) })
    : t("sizePresets.high", { mm: mmText(p.heightMm ?? 0) });
}

/**
 * Size presets for the selected pieces: the common sleeve sizes and the sizes the user saved. Choosing one sets the
 * real size of the selected pieces (an explicit, visible setting, one undo step); a preset that fixes one side keeps
 * each piece's proportions. A size with both sides is stretched onto a piece of other proportions, so that is asked
 * about first. The user's own sizes can be saved from the selection, renamed and deleted.
 */
export function SizePresets() {
  const { t } = useTranslation();
  const cards = useLibraryCards();
  const selected = usePrintStore((s) => s.selection.selected);
  const edits = useLayoutStore((s) => s.cardEdits);
  const setEdits = useLayoutStore((s) => s.setCardEdits);
  const saved = usePreferencesStore((s) => s.prefs.sizePresets);
  const save = usePreferencesStore((s) => s.saveSizePreset);
  const rename = usePreferencesStore((s) => s.renameSizePreset);
  const remove = usePreferencesStore((s) => s.deleteSizePreset);
  const [name, setName] = useState("");
  const [sides, setSides] = useState<Sides>("both");
  const picked = cards.filter((c) => selected.includes(cardIdKey(c.id)));
  const first = picked[0];

  const apply = async (label: string, size: Pick<UserSizePreset, "widthMm" | "heightMm">) => {
    if (picked.some((c) => stretches(c.source, size))) {
      const ok = await ask(t("sizePresets.stretchAsk", { name: label, size: sizeText(t, size) }), {
        title: t("sizePresets.stretchTitle"),
        kind: "warning",
        okLabel: t("common.apply"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }
    let next = edits;
    for (const c of picked) {
      const { x, y } = presetScales(c.source, size);
      next = scaleCardsXY(next, [cardIdKey(c.id)], x, y);
    }
    setEdits(next);
  };

  const options = [
    { value: "", label: t("sizePresets.choose"), disabled: true },
    ...BUILT_IN_SIZES.map((s) => ({
      value: `built:${s.id}`,
      label: t("sizePresets.label", { name: t(`sizePresets.names.${s.id}`), dims: sizeText(t, s) }),
    })),
    ...saved.map((p) => ({ value: `user:${p.name}`, label: `${p.name}: ${sizeText(t, p)}` })),
  ];
  const choose = (value: string) => {
    if (value.startsWith("built:")) {
      const size = builtInSize(value.slice(6) as (typeof BUILT_IN_SIZES)[number]["id"]);
      void apply(t(`sizePresets.names.${size.id}`), size);
    } else {
      const p = saved.find((x) => `user:${x.name}` === value);
      if (p) void apply(p.name, p);
    }
  };

  // The size to save: what the first selected piece prints at.
  const printed =
    first &&
    (() => {
      const { x, y } = {
        x: first.scale,
        y: first.scale_y ?? first.scale,
      };
      return { widthMm: ptToMm(first.source.width * x), heightMm: ptToMm(first.source.height * y) };
    })();
  const round = (mm: number) => Math.min(Math.max(Math.round(mm * 10) / 10, SIZE_RANGE_MM[0]), SIZE_RANGE_MM[1]);
  const toSave: UserSizePreset | null = printed
    ? {
        name: name.trim(),
        widthMm: sides === "height" ? null : round(printed.widthMm),
        heightMm: sides === "width" ? null : round(printed.heightMm),
      }
    : null;
  const suggestion = printed
    ? sizeText(t, {
        widthMm: sides === "height" ? null : round(printed.widthMm),
        heightMm: sides === "width" ? null : round(printed.heightMm),
      })
    : "";
  const doSave = () => {
    if (!toSave) return;
    save({ ...toSave, name: toSave.name || suggestion });
    setName("");
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="size-presets">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[var(--muted)]">{t("sizePresets.title")}</span>
        <Select
          className="min-w-0 flex-1 [&>button]:w-full [&>button]:min-w-0"
          label={t("sizePresets.title")}
          value=""
          onChange={choose}
          options={options}
        />
      </div>
      {first && (
        <div className="flex flex-wrap items-center gap-1">
          <Segmented<Sides>
            label={t("sizePresets.sides")}
            value={sides}
            onChange={setSides}
            options={[
              { value: "both", label: t("sizePresets.both") },
              { value: "width", label: t("sizePresets.widthOnly") },
              { value: "height", label: t("sizePresets.heightOnly") },
            ]}
          />
          <input
            type="text"
            aria-label={t("sizePresets.name")}
            placeholder={suggestion}
            maxLength={MAX_SIZE_PRESET_NAME}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSave()}
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-transparent px-1.5 py-0.5"
          />
          <Button onClick={doSave} title={t("sizePresets.saveTitle")}>
            {t("sizePresets.save")}
          </Button>
        </div>
      )}
      {saved.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t("sizePresets.yours")}>
          {saved.map((p) => (
            <li key={p.name} className="flex items-center gap-1">
              <input
                type="text"
                aria-label={t("sizePresets.rename", { name: p.name })}
                defaultValue={p.name}
                maxLength={MAX_SIZE_PRESET_NAME}
                onBlur={(e) => {
                  const to = e.target.value.trim();
                  if (to && to !== p.name) rename(p.name, to);
                  else e.target.value = p.name;
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 hover:border-[var(--border)]"
              />
              <span className="whitespace-nowrap text-[var(--muted)]">{sizeText(t, p)}</span>
              <Button
                aria-label={t("sizePresets.delete", { name: p.name })}
                title={t("sizePresets.delete", { name: p.name })}
                onClick={() => remove(p.name)}
              >
                <Trash2 size={12} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
