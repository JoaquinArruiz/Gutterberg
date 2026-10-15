import { ChevronDown, ChevronRight, Folder, Pencil, Plus, Trash2, Ungroup } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  cleanGridName,
  folderGrids,
  folderNames,
  GRID_COLORS,
  type GridGroup,
  type GridRegion,
  MAX_GRID_NAME,
  MAX_GRIDS,
  newFolderName,
} from "../../lib/document-layout";
import { useEditorStore } from "../../stores/editor-store";
import { useActiveGrid, useLayoutStore, usePickedFolder } from "../../stores/layout-store";
import { Button } from "../ui/Button";
import { CollapsibleSection } from "../ui/CollapsibleSection";
import { Select } from "../ui/Select";

const NO_FOLDER = "";
const NEW_FOLDER = "\u0000new";

/** The list in the order it is shown: a folder where its first grid is, with its grids under it, and the other grids. */
type Row = { kind: "grid"; n: number } | { kind: "folder"; name: string; grids: number[] };

function rowsOf(g: GridGroup): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  g.grids.forEach((r, n) => {
    if (r.folder === undefined) rows.push({ kind: "grid", n });
    else if (!seen.has(r.folder)) {
      seen.add(r.folder);
      rows.push({ kind: "folder", name: r.folder, grids: folderGrids(g, r.folder) });
    }
  });
  return rows;
}

/** A text field that commits on Enter or when left, and gives up on Esc. */
function NameField({
  value,
  label,
  placeholder,
  onCommit,
  onDone,
}: {
  value: string;
  label: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  // Esc closes the field, and the blur that follows must not commit what was typed.
  const cancelled = useRef(false);
  const commit = () => {
    if (!cancelled.current && draft !== value) onCommit(draft);
    cancelled.current = false;
    onDone?.();
  };
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: the field was just opened by the rename button
      autoFocus
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      maxLength={MAX_GRID_NAME}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelled.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className="w-full min-w-0 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5"
    />
  );
}

/**
 * The grids of the viewed page's group: one row per grid ("Grid 2 · 3×3", or the name the user gave it) with its
 * colour, the picked one pressed, and folders that hold several grids. Picking a grid makes it the one the page and
 * the sections above edit, on its own even when it is in a folder; picking a folder picks its grids together, so a
 * drag on the page or the arrow keys move them as one. The pencil opens a grid's name, colour and folder. "Add grid"
 * adds one with no region, picked, so the next drag on the page draws it.
 */
export function GridsSection({ group, page }: { group: GridGroup; page: number }) {
  const { t } = useTranslation();
  const active = useActiveGrid();
  const pickedFolder = usePickedFolder();
  const setActive = useLayoutStore((s) => s.setActiveGrid);
  const pickFolder = useLayoutStore((s) => s.pickFolder);
  const setLook = useLayoutStore((s) => s.setGridLook);
  const renameFolder = useLayoutStore((s) => s.renameFolder);
  const add = useLayoutStore((s) => s.addGrid);
  const remove = useLayoutStore((s) => s.deleteGrid);
  const [editing, setEditing] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const several = group.grids.length > 1;
  const full = group.grids.length >= MAX_GRIDS;
  const folders = folderNames(group);
  const nameOf = (r: GridRegion, n: number) => r.name ?? t("source.grids.item", { n: n + 1 });
  // The arrow keys then move what was picked, with the Grid region tool.
  const pickOnPage = () => {
    useEditorStore.getState().setTool("select");
    useEditorStore.getState().setPickedRegion(page);
  };
  const pick = (n: number) => {
    setActive(n);
    pickOnPage();
  };
  const toggleFold = (name: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  const gridRow = (n: number, inFolder: boolean) => {
    const r = group.grids[n];
    const name = nameOf(r, n);
    const pressed = n === active && pickedFolder === null;
    const open = editing === n;
    return (
      <li key={`g${n}`} className={`flex flex-col gap-1 ${inFolder ? "pl-4" : ""}`}>
        <div className="flex items-center gap-1">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--border)]"
            style={{ background: r.color ?? "var(--accent)" }}
          />
          <button
            type="button"
            aria-pressed={pressed}
            title={t("source.grids.pick", { name })}
            onClick={() => pick(n)}
            className={`flex min-w-0 flex-1 justify-between gap-2 rounded px-2 py-0.5 text-left ${
              pressed ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "hover:bg-[var(--hover)]"
            }`}
          >
            <span className="truncate">{name}</span>
            <span className={`shrink-0 tabular-nums ${pressed ? "" : "text-[var(--muted)]"}`}>
              {r.selection ? `${r.grid.rows}×${r.grid.columns}` : t("source.grids.noRegion")}
            </span>
          </button>
          <Button
            variant="ghost"
            aria-label={t("source.grids.edit", { name })}
            title={t("source.grids.edit", { name })}
            aria-expanded={open}
            onClick={() => setEditing(open ? null : n)}
          >
            <Pencil size={12} />
          </Button>
          {several && (
            <Button
              variant="ghost"
              aria-label={t("source.grids.delete", { name })}
              title={t("source.grids.delete", { name })}
              onClick={() => {
                setEditing(null);
                remove(page, n);
              }}
            >
              <Trash2 size={12} />
            </Button>
          )}
        </div>
        {open && (
          <div className="ml-3.5 flex flex-col gap-1.5 rounded border border-[var(--border)] p-2">
            <NameField
              value={r.name ?? ""}
              label={t("source.grids.name")}
              placeholder={t("source.grids.item", { n: n + 1 })}
              onCommit={(v) => setLook(page, n, { name: cleanGridName(v) })}
            />
            <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0">
              <legend className="sr-only">{t("source.grids.color")}</legend>
              {[{ id: "default" as const, hex: undefined }, ...GRID_COLORS].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={r.color === c.hex}
                  aria-label={t(`source.grids.colors.${c.id}`)}
                  title={t(`source.grids.colors.${c.id}`)}
                  onClick={() => setLook(page, n, { color: c.hex })}
                  className={`h-5 w-5 rounded-full border-2 ${
                    r.color === c.hex ? "border-[var(--fg)]" : "border-transparent"
                  }`}
                  style={{ background: c.hex ?? "var(--accent)" }}
                />
              ))}
            </fieldset>
            <Select
              label={t("source.grids.folder")}
              fill
              value={r.folder ?? NO_FOLDER}
              options={[
                { value: NO_FOLDER, label: t("source.grids.noFolder") },
                ...folders.map((f) => ({ value: f, label: f })),
                { value: NEW_FOLDER, label: t("source.grids.newFolder") },
              ]}
              onChange={(v) =>
                setLook(page, n, {
                  folder:
                    v === NO_FOLDER
                      ? undefined
                      : v === NEW_FOLDER
                        ? newFolderName(group, t("source.grids.folderBase"))
                        : v,
                })
              }
            />
          </div>
        )}
      </li>
    );
  };

  return (
    <CollapsibleSection id="cards.grids" title={t("source.sections.grids")} info={t("source.grids.note")}>
      <ul className="flex flex-col gap-1" data-hint-target="grid-list">
        {rowsOf(group).map((row) => {
          if (row.kind === "grid") return gridRow(row.n, false);
          const { name } = row;
          const pressed = pickedFolder === name;
          const isFolded = folded.has(name);
          return (
            <li key={`f${name}`} className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  aria-label={t(isFolded ? "source.grids.unfold" : "source.grids.fold", { name })}
                  aria-expanded={!isFolded}
                  onClick={() => toggleFold(name)}
                >
                  {isFolded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </Button>
                {renaming === name ? (
                  <NameField
                    value={name}
                    label={t("source.grids.folderName")}
                    onCommit={(v) => {
                      const to = cleanGridName(v);
                      if (to) renameFolder(page, name, to);
                    }}
                    onDone={() => setRenaming(null)}
                  />
                ) : (
                  <button
                    type="button"
                    aria-pressed={pressed}
                    title={t("source.grids.pickFolder", { name })}
                    onClick={() => {
                      pickFolder(page, name);
                      pickOnPage();
                    }}
                    className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-0.5 text-left ${
                      pressed ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "hover:bg-[var(--hover)]"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      <Folder size={12} className="shrink-0" />
                      <span className="truncate">{name}</span>
                    </span>
                    <span className={`shrink-0 tabular-nums ${pressed ? "" : "text-[var(--muted)]"}`}>
                      {row.grids.length}
                    </span>
                  </button>
                )}
                <Button
                  variant="ghost"
                  aria-label={t("source.grids.renameFolder", { name })}
                  title={t("source.grids.renameFolder", { name })}
                  onClick={() => setRenaming(name)}
                >
                  <Pencil size={12} />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={t("source.grids.ungroup", { name })}
                  title={t("source.grids.ungroup", { name })}
                  onClick={() => renameFolder(page, name, undefined)}
                >
                  <Ungroup size={12} />
                </Button>
              </div>
              {!isFolded && <ul className="flex flex-col gap-1">{row.grids.map((n) => gridRow(n, true))}</ul>}
            </li>
          );
        })}
      </ul>
      <div>
        <Button
          className="inline-flex items-center gap-1"
          disabled={full}
          title={full ? t("source.grids.full", { count: MAX_GRIDS }) : t("source.grids.addTitle")}
          onClick={() => {
            add(page);
            // The new grid is drawn with the Grid region tool.
            pickOnPage();
          }}
        >
          <Plus size={12} />
          {t("source.grids.add")}
        </Button>
      </div>
    </CollapsibleSection>
  );
}
