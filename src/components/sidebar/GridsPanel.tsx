import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
  Ungroup,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import type { OrientedRect } from "../../lib/card";
import {
  cleanGridName,
  folderNames,
  GRID_COLORS,
  type GridGroup,
  gridList,
  type ListRef,
  MAX_GRID_NAME,
  MAX_GRIDS,
  moveInGridList,
  newFolderName,
} from "../../lib/document-layout";
import { emitHintEvent } from "../../lib/hint-events";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { useActiveGrid, useCurrentGroup, useLayoutStore, usePickedFolder } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { Button } from "../ui/Button";
import { type MenuEntry, openContextMenu } from "../ui/ContextMenu";
import { InfoTip } from "../ui/InfoTip";
import { Select } from "../ui/Select";
import { type ListDrag, listItemKey, useGridListDrag } from "./use-grid-list-drag";

const NO_FOLDER = "";
const NEW_FOLDER = "\u0000new";

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
      // biome-ignore lint/a11y/noAutofocus: the field was just opened on purpose (double-click or the pencil)
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

/** Every row starts with this slot (a grid's colour dot, a folder's fold arrow), so the names line up. */
const LEAD = "flex h-5 w-5 shrink-0 items-center justify-center";
/** A grid in a folder is moved right by one slot. */
const INDENT = "pl-6";

/** One round swatch of the colour picker. */
function Swatch({
  hex,
  label,
  on,
  onPick,
  onContextMenu,
}: {
  hex: string | undefined;
  label: string;
  on: boolean;
  onPick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onPick}
      onContextMenu={onContextMenu}
      className={`h-5 w-5 rounded-full border-2 ${on ? "border-[var(--fg)]" : "border-transparent"}`}
      style={{ background: hex ?? "var(--accent)" }}
    />
  );
}

/**
 * A grid's colours: the suggested ones (the first is the accent colour, no colour of its own), then the user's own,
 * kept in preferences for every project. The + adds one from the system's colour picker and gives it to the grid; a
 * right-click on one of the user's own colours deletes it (the suggested ones stay).
 */
function ColorChoices({ value, onPick }: { value: string | undefined; onPick: (hex: string | undefined) => void }) {
  const { t } = useTranslation();
  const own = usePreferencesStore((s) => s.prefs.gridColors);
  const addColor = usePreferencesStore((s) => s.addGridColor);
  const deleteColor = usePreferencesStore((s) => s.deleteGridColor);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(onPick);
  latest.current = onPick;
  // The system picker reports every move; the colour is added once, when it is closed on one ("change").
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const done = () => {
      const hex = el.value.toLowerCase();
      addColor(hex);
      latest.current(hex);
    };
    el.addEventListener("change", done);
    return () => el.removeEventListener("change", done);
  }, [addColor]);
  const heading = "text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]";
  return (
    <div className="flex flex-col gap-1.5">
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className={heading}>{t("source.grids.suggestedColors")}</legend>
        <div className="flex flex-wrap gap-1">
          {[{ id: "default" as const, hex: undefined }, ...GRID_COLORS].map((c) => (
            <Swatch
              key={c.id}
              hex={c.hex}
              label={t(`source.grids.colors.${c.id}`)}
              on={value === c.hex}
              onPick={() => onPick(c.hex)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className={heading}>{t("source.grids.ownColors")}</legend>
        <div className="flex flex-wrap items-center gap-1">
          {own.map((hex) => (
            <span key={hex} className="group relative">
              <Swatch
                hex={hex}
                label={hex}
                on={value === hex}
                onPick={() => onPick(hex)}
                onContextMenu={(e) =>
                  openContextMenu(e, [
                    { label: t("source.grids.deleteColor"), danger: true, onSelect: () => deleteColor(hex) },
                  ])
                }
              />
              {/* The × on hover deletes it too, for whoever does not think of the right-click. */}
              <button
                type="button"
                aria-label={t("source.grids.deleteColorNamed", { hex })}
                title={t("source.grids.deleteColor")}
                onClick={() => deleteColor(hex)}
                className="absolute -right-1 -top-1 hidden h-3 w-3 items-center justify-center rounded-full bg-[var(--fg)] text-[var(--bg)] group-focus-within:flex group-hover:flex"
              >
                <X size={8} strokeWidth={3} />
              </button>
            </span>
          ))}
          <label
            title={t("source.grids.addColor")}
            className="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-dashed border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]"
          >
            <Plus size={11} />
            <input
              ref={input}
              type="color"
              aria-label={t("source.grids.addColor")}
              defaultValue={value ?? "#3b82f6"}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>
      </fieldset>
    </div>
  );
}

/**
 * The colour picker that opens under a grid's row (`anchor`, a `data-list-item` key): closes on a choice, a press
 * outside it or Esc. It is drawn over the whole window, so the panel's width and scrolling never cut it; it follows
 * the row when the panel scrolls, and opens upwards when there is no room below.
 */
function ColorPopover({
  anchor,
  value,
  onPick,
  onClose,
}: {
  anchor: string;
  value: string | undefined;
  onPick: (hex: string | undefined) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const row = document.querySelector(`[data-list-item="${anchor}"]`)?.getBoundingClientRect();
      const box = ref.current?.getBoundingClientRect();
      if (!row || !box) return;
      const below = row.bottom + 2;
      setPos({
        left: Math.max(4, Math.min(row.left, window.innerWidth - box.width - 4)),
        top: below + box.height > window.innerHeight ? Math.max(4, row.top - box.height - 2) : below,
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor]);
  useEffect(() => {
    // The right-click menu on a colour is outside the popover but belongs to it.
    const down = (e: PointerEvent) => {
      const el = e.target as Element;
      if (!ref.current?.contains(el) && !el.closest?.("[data-testid=context-menu]")) close.current();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, []);
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={t("source.grids.color")}
      style={{ position: "fixed", left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? undefined : "hidden" }}
      className="z-50 w-56 rounded border border-[var(--border)] bg-[var(--panel)] p-2 shadow-xl shadow-black/40"
    >
      <ColorChoices
        value={value}
        onPick={(hex) => {
          onPick(hex);
          onClose();
        }}
      />
    </div>,
    document.body,
  );
}

/** The line or ring that shows where a dragged row will land. */
function dropClass(drag: ListDrag | null, item: ListRef): string {
  const d = drag?.drop;
  if (!d) return "";
  const key = listItemKey(item);
  if (d.place === "into") return item.kind === "folder" && d.folder === item.name ? "ring-2 ring-[var(--accent)]" : "";
  if (listItemKey(d.item) !== key) return "";
  return d.place === "before" ? "shadow-[inset_0_2px_0_var(--accent)]" : "shadow-[inset_0_-2px_0_var(--accent)]";
}

/**
 * The grids of the viewed page's group: one row per grid ("Grid 2 · 3×3", or the name the user gave it) with its
 * colour dot, the picked one pressed, and folders that hold several grids. Picking a grid makes it the one the page
 * and the sections above edit, on its own even when it is in a folder; picking a folder picks its grids together, so
 * a drag on the page or the arrow keys move them as one. Rows are dragged to change the order (a grid's number, and so
 * the order its pieces come out) or to put a grid in a folder. A double-click renames a grid or a folder; the dot opens
 * the colours; the pencil has the name, colour and folder together. "Add grid" adds one with no region, picked, so
 * the next drag on the page draws it; "New folder" in the header adds an empty folder, ready to be named.
 */
export function GridsList({ group, page }: { group: GridGroup; page: number }) {
  const { t } = useTranslation();
  const active = useActiveGrid();
  const pickedFolder = usePickedFolder();
  const setActive = useLayoutStore((s) => s.setActiveGrid);
  const pickFolder = useLayoutStore((s) => s.pickFolder);
  const setLook = useLayoutStore((s) => s.setGridLook);
  const renameFolder = useLayoutStore((s) => s.renameFolder);
  const setFolderHidden = useLayoutStore((s) => s.setFolderHidden);
  const addFolder = useLayoutStore((s) => s.addFolder);
  const moveInList = useLayoutStore((s) => s.moveInGridList);
  const add = useLayoutStore((s) => s.addGrid);
  const remove = useLayoutStore((s) => s.deleteGrid);
  const [editing, setEditing] = useState<number | null>(null);
  const [coloring, setColoring] = useState<number | null>(null);
  const renaming = useGridsUi((s) => s.renaming);
  const setRenaming = useGridsUi((s) => s.setRenaming);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const { drag, onPointerDown, wasDrag } = useGridListDrag((item, drop) => moveInList(page, item, drop));
  // The last grid is not deleted: it loses its region, so the page can draw it again.
  const several = group.grids.length > 1;
  const full = group.grids.length >= MAX_GRIDS;
  const folders = folderNames(group);
  const nameOf = (n: number) => group.grids[n].name ?? t("source.grids.item", { n: n + 1 });
  const isRenaming = (r: ListRef) => renaming !== null && listItemKey(renaming) === listItemKey(r);
  // The arrow keys then move what was picked, with the Select or the Grid tool.
  const pickOnPage = () => {
    const ed = useEditorStore.getState();
    if (ed.tool !== "pick") ed.setTool("grid");
    ed.setSelectedCard(null);
    useEditorStore.getState().setPickedRegion(page);
  };
  const toggleFold = (name: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  const pickClass = (pressed: boolean) =>
    `flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-0.5 text-left ${
      pressed ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "hover:bg-[var(--hover)]"
    }`;

  /** Move up and Move down: past the row's neighbour in the list or in its folder, off at either end. */
  const moveEntries = (ref: ListRef, folder: string | undefined): MenuEntry[] => {
    const items = gridList(group);
    const rows: ListRef[] =
      folder === undefined
        ? items.map((it) => (it.kind === "grid" ? { kind: "grid", n: it.n } : { kind: "folder", name: it.name }))
        : (items.find((it) => it.kind === "folder" && it.name === folder) as { grids: number[] }).grids.map((n) => ({
            kind: "grid",
            n,
          }));
    const i = rows.findIndex((r) => listItemKey(r) === listItemKey(ref));
    const step = (place: "before" | "after", to: ListRef | undefined): MenuEntry => ({
      label: t(place === "before" ? "source.grids.menu.moveUp" : "source.grids.menu.moveDown"),
      disabled: !to || moveInGridList(group, ref, { place, item: to }) === null,
      onSelect: () => to && moveInList(page, ref, { place, item: to }),
    });
    return [step("before", rows[i - 1]), step("after", rows[i + 1])];
  };

  const takeOut = (ref: ListRef, folder: string): MenuEntry => ({
    label: t("source.grids.menu.takeOut", { folder }),
    onSelect: () => moveInList(page, ref, { place: "after", item: { kind: "folder", name: folder } }),
  });

  const gridMenu = (n: number): MenuEntry[] => {
    const r = group.grids[n];
    const ref: ListRef = { kind: "grid", n };
    return [
      { label: t("source.grids.menu.rename"), onSelect: () => setRenaming(ref) },
      { label: t("source.grids.menu.color"), onSelect: () => setColoring(n) },
      {
        label: t(r.hidden ? "source.grids.menu.show" : "source.grids.menu.hide"),
        onSelect: () => setLook(page, n, { hidden: !r.hidden }),
      },
      "separator",
      ...moveEntries(ref, r.folder),
      ...folders
        .filter((f) => f !== r.folder)
        .map(
          (f): MenuEntry => ({
            label: t("source.grids.menu.moveTo", { folder: f }),
            onSelect: () => moveInList(page, ref, { place: "into", folder: f }),
          }),
        ),
      {
        label: t("source.grids.menu.moveToNew"),
        onSelect: () => moveInList(page, ref, { place: "into", folder: newFolder() }),
      },
      // Out of its folder, a grid goes just after it, as with the pencil's Folder field.
      ...(r.folder !== undefined ? [takeOut(ref, r.folder)] : []),
      "separator",
      {
        label: t(several ? "source.grids.menu.delete" : "source.grids.menu.clear"),
        danger: true,
        onSelect: () => {
          setEditing(null);
          setColoring(null);
          remove(page, n);
        },
      },
    ];
  };

  const folderMenu = (name: string, grids: number[], allHidden: boolean): MenuEntry[] => {
    const ref: ListRef = { kind: "folder", name };
    return [
      { label: t("source.grids.menu.rename"), onSelect: () => setRenaming(ref) },
      {
        label: t(allHidden ? "source.grids.menu.show" : "source.grids.menu.hide"),
        disabled: grids.length === 0,
        onSelect: () => setFolderHidden(page, name, !allHidden),
      },
      "separator",
      ...moveEntries(ref, undefined),
      "separator",
      grids.length > 0
        ? { label: t("source.grids.menu.ungroup"), onSelect: () => renameFolder(page, name, undefined) }
        : { label: t("source.grids.menu.delete"), danger: true, onSelect: () => renameFolder(page, name, undefined) },
    ];
  };

  const gridRow = (n: number, folder: string | undefined) => {
    const r = group.grids[n];
    const ref: ListRef = { kind: "grid", n };
    const name = nameOf(n);
    const pressed = n === active && pickedFolder === null;
    return (
      <li key={`g${n}`} className={`relative flex flex-col gap-1 ${folder !== undefined ? INDENT : ""}`}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the right-click menu repeats the row's buttons, so it needs no role of its own */}
        <div
          data-list-item={listItemKey(ref)}
          data-list-folder={folder}
          className={`flex items-center gap-1 rounded ${drag?.item.kind === "grid" && drag.item.n === n ? "opacity-50" : ""} ${dropClass(drag, ref)}`}
          onPointerDown={(e) => onPointerDown(ref, e)}
          onContextMenu={(e) => openContextMenu(e, gridMenu(n))}
        >
          <span className={LEAD}>
            <button
              type="button"
              aria-label={t("source.grids.pickColor", { name })}
              title={t("source.grids.pickColor", { name })}
              aria-expanded={coloring === n}
              onClick={() => setColoring(coloring === n ? null : n)}
              className="h-3 w-3 rounded-full border border-[var(--border)]"
              style={{ background: r.color ?? "var(--accent)" }}
            />
          </span>
          {isRenaming(ref) ? (
            <NameField
              value={r.name ?? ""}
              label={t("source.grids.name")}
              placeholder={t("source.grids.item", { n: n + 1 })}
              onCommit={(v) => setLook(page, n, { name: cleanGridName(v) })}
              onDone={() => setRenaming(null)}
            />
          ) : (
            <button
              type="button"
              aria-pressed={pressed}
              title={t("source.grids.pick", { name })}
              onClick={() => {
                if (wasDrag()) return;
                setActive(n);
                pickOnPage();
              }}
              onDoubleClick={() => setRenaming(ref)}
              className={pickClass(pressed)}
            >
              <span className={`truncate ${r.hidden ? "opacity-50" : ""}`}>{name}</span>
              <span className={`shrink-0 tabular-nums ${pressed ? "" : "text-[var(--muted)]"}`}>
                {r.selection ? `${r.grid.rows}×${r.grid.columns}` : t("source.grids.noRegion")}
              </span>
            </button>
          )}
          <Button
            variant="ghost"
            aria-label={t(r.hidden ? "source.grids.show" : "source.grids.hide", { name })}
            title={t(r.hidden ? "source.grids.show" : "source.grids.hide", { name })}
            aria-pressed={r.hidden === true}
            onClick={() => setLook(page, n, { hidden: !r.hidden })}
          >
            {r.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </Button>
          <Button
            variant="ghost"
            aria-label={t("source.grids.edit", { name })}
            title={t("source.grids.edit", { name })}
            aria-expanded={editing === n}
            onClick={() => setEditing(editing === n ? null : n)}
          >
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            aria-label={t("source.grids.delete", { name })}
            title={t(several ? "source.grids.delete" : "source.grids.deleteLast", { name })}
            onClick={() => {
              setEditing(null);
              setColoring(null);
              remove(page, n);
            }}
          >
            <Trash2 size={12} />
          </Button>
        </div>
        {coloring === n && editing !== n && (
          <ColorPopover
            anchor={listItemKey(ref)}
            value={r.color}
            onPick={(color) => setLook(page, n, { color })}
            onClose={() => setColoring(null)}
          />
        )}
        {editing === n && (
          <div className="ml-5 flex flex-col gap-1.5 rounded border border-[var(--border)] p-2">
            <NameField
              value={r.name ?? ""}
              label={t("source.grids.name")}
              placeholder={t("source.grids.item", { n: n + 1 })}
              onCommit={(v) => setLook(page, n, { name: cleanGridName(v) })}
            />
            <ColorChoices value={r.color} onPick={(color) => setLook(page, n, { color })} />
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
                // Out of its folder, a grid goes just after it, so the list stays in the order its pieces come out.
                v === NO_FOLDER
                  ? r.folder !== undefined &&
                    moveInList(page, ref, { place: "after", item: { kind: "folder", name: r.folder } })
                  : moveInList(page, ref, {
                      place: "into",
                      folder: v === NEW_FOLDER ? newFolder() : v,
                    })
              }
            />
          </div>
        )}
      </li>
    );
  };

  /** Adds an empty folder with the next free name and returns that name. */
  const newFolder = () => {
    const name = newFolderName(group, t("source.grids.folderBase"));
    addFolder(page, name);
    return name;
  };

  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1" data-hint-target="grid-list">
        {gridList(group).map((item) => {
          if (item.kind === "grid") return gridRow(item.n, undefined);
          const { name } = item;
          const ref: ListRef = { kind: "folder", name };
          const pressed = pickedFolder === name;
          const isFolded = folded.has(name);
          const allHidden = item.grids.length > 0 && item.grids.every((n) => group.grids[n].hidden);
          return (
            <li key={`f${name}`} className="flex flex-col gap-1">
              {/* biome-ignore lint/a11y/noStaticElementInteractions: the right-click menu repeats the row's buttons, so it needs no role of its own */}
              <div
                data-list-item={listItemKey(ref)}
                className={`flex items-center gap-1 rounded ${drag?.item.kind === "folder" && drag.item.name === name ? "opacity-50" : ""} ${dropClass(drag, ref)}`}
                onPointerDown={(e) => onPointerDown(ref, e)}
                onContextMenu={(e) => openContextMenu(e, folderMenu(name, item.grids, allHidden))}
              >
                <button
                  type="button"
                  aria-label={t(isFolded ? "source.grids.unfold" : "source.grids.fold", { name })}
                  aria-expanded={!isFolded}
                  onClick={() => toggleFold(name)}
                  className={`${LEAD} rounded text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]`}
                >
                  {isFolded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
                {isRenaming(ref) ? (
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
                    title={t(item.grids.length > 0 ? "source.grids.pickFolder" : "source.grids.emptyFolder", { name })}
                    onClick={() => {
                      if (wasDrag() || item.grids.length === 0) return;
                      pickFolder(page, name);
                      pickOnPage();
                    }}
                    onDoubleClick={() => setRenaming(ref)}
                    className={pickClass(pressed)}
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      <Folder size={12} className="shrink-0" />
                      <span className="truncate">{name}</span>
                    </span>
                    <span className={`shrink-0 tabular-nums ${pressed ? "" : "text-[var(--muted)]"}`}>
                      {item.grids.length}
                    </span>
                  </button>
                )}
                <Button
                  variant="ghost"
                  disabled={item.grids.length === 0}
                  aria-label={t(allHidden ? "source.grids.show" : "source.grids.hide", { name })}
                  title={t(allHidden ? "source.grids.show" : "source.grids.hide", { name })}
                  aria-pressed={allHidden}
                  onClick={() => setFolderHidden(page, name, !allHidden)}
                >
                  {allHidden ? <EyeOff size={12} /> : <Eye size={12} />}
                </Button>
                <Button
                  variant="ghost"
                  aria-label={t("source.grids.renameFolder", { name })}
                  title={t("source.grids.renameFolder", { name })}
                  onClick={() => setRenaming(ref)}
                >
                  <Pencil size={12} />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={t(item.grids.length > 0 ? "source.grids.ungroup" : "source.grids.deleteFolder", {
                    name,
                  })}
                  title={t(item.grids.length > 0 ? "source.grids.ungroup" : "source.grids.deleteFolder", { name })}
                  onClick={() => renameFolder(page, name, undefined)}
                >
                  {item.grids.length > 0 ? <Ungroup size={12} /> : <Trash2 size={12} />}
                </Button>
              </div>
              {!isFolded && item.grids.length > 0 && (
                <ul className="flex flex-col gap-1">{item.grids.map((n) => gridRow(n, name))}</ul>
              )}
            </li>
          );
        })}
      </ul>
      <div data-hint-target="add-grid-button">
        <Button
          className="inline-flex items-center gap-1"
          disabled={full}
          title={full ? t("source.grids.full", { count: MAX_GRIDS }) : t("source.grids.addTitle")}
          onClick={() => {
            add(page);
            emitHintEvent("grid-added");
            // The new grid is drawn with the Grid region tool.
            pickOnPage();
          }}
        >
          <Plus size={12} />
          {t("source.grids.add")}
        </Button>
      </div>
      <PiecesList page={page} />
    </div>
  );
}

/**
 * The viewed page's freeform pieces, after the grids: one row per piece ("Piece 2"), the picked ones pressed. Pressing
 * one picks it with the Piece tool, as clicking it on the page does; the bin deletes it. Pieces belong to their page,
 * not to the group, so they have no folder.
 */
function PiecesList({ page }: { page: number }) {
  const { t } = useTranslation();
  const pieces = useLayoutStore((s) => s.freeform[page]) ?? NO_PIECES;
  const remove = useLayoutStore((s) => s.deleteFreeformCard);
  const tool = useEditorStore((s) => s.tool);
  const picked = useEditorStore((s) => (s.selectedCard?.page === page ? s.pickedCards : NO_PICKED));
  if (pieces.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-[var(--border)] pt-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        {t("source.grids.pieces", { count: pieces.length })}
      </div>
      <ul className="flex flex-col gap-1">
        {pieces.map((p, i) => {
          const name = t("source.grids.piece", { n: i + 1 });
          const pressed = (tool === "card" || tool === "pick") && picked.includes(i);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a piece's place on its page is its identity
            <li key={i} className="flex items-center gap-1">
              <span className={LEAD} />
              <button
                type="button"
                aria-pressed={pressed}
                title={t("source.grids.pickPiece", { name })}
                onContextMenu={(e) =>
                  openContextMenu(e, [
                    { label: t("source.grids.menu.delete"), danger: true, onSelect: () => remove(page, i) },
                  ])
                }
                onClick={() => {
                  const ed = useEditorStore.getState();
                  if (ed.tool !== "pick") ed.setTool("card");
                  ed.setPickedRegion(null);
                  ed.setSelectedCard({ page, index: i });
                }}
                className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-0.5 text-left ${
                  pressed ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "hover:bg-[var(--hover)]"
                }`}
              >
                <span className="truncate">{name}</span>
                {p.angle_deg !== 0 && (
                  <span className={`shrink-0 tabular-nums ${pressed ? "" : "text-[var(--muted)]"}`}>
                    {Math.round(p.angle_deg * 10) / 10}°
                  </span>
                )}
              </button>
              <Button
                variant="ghost"
                aria-label={t("source.grids.delete", { name })}
                title={t("source.grids.delete", { name })}
                onClick={() => remove(page, i)}
              >
                <Trash2 size={12} />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const NO_PIECES: OrientedRect[] = [];
const NO_PICKED: number[] = [];

/** Session state of the list shared with the panel's header: the grid or folder whose name is being typed. */
const useGridsUi = create<{ renaming: ListRef | null; setRenaming: (r: ListRef | null) => void }>((set) => ({
  renaming: null,
  setRenaming: (renaming) => set({ renaming }),
}));

/** The ⓘ next to the panel's title. */
export function GridsPanelInfo() {
  const { t } = useTranslation();
  return <InfoTip text={t("source.grids.note")} />;
}

/** The panel header's New folder button: adds an empty folder to the viewed page's group, its name ready to type. */
export function NewFolderButton() {
  const { t } = useTranslation();
  const page = useDocumentStore((s) => s.currentPage);
  const group = useCurrentGroup();
  const addFolder = useLayoutStore((s) => s.addFolder);
  const setRenaming = useGridsUi((s) => s.setRenaming);
  return (
    <button
      type="button"
      aria-label={t("source.grids.newFolder")}
      title={t("source.grids.newFolderTitle")}
      disabled={group?.kind !== "grid"}
      onClick={() => {
        if (group?.kind !== "grid") return;
        const name = newFolderName(group, t("source.grids.folderBase"));
        addFolder(page, name);
        setRenaming({ kind: "folder", name });
      }}
      className="rounded p-0.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-40"
    >
      <FolderPlus size={13} />
    </button>
  );
}

/**
 * The Grids and pieces panel of the Source tab: the grids, folders and freeform pieces of the
 * viewed page, on its own beside Properties so the list is always in view.
 */
export function GridsPanel() {
  const { t } = useTranslation();
  const page = useDocumentStore((s) => s.currentPage);
  const hasPage = useDocumentStore((s) => s.pages.length > 0);
  const group = useCurrentGroup();
  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-3">
      {!hasPage ? (
        <p className="text-[var(--muted)]">{t("source.noDocument")}</p>
      ) : group?.kind === "grid" ? (
        <GridsList group={group} page={page} />
      ) : (
        <p className="text-[var(--muted)]">{t("source.grids.skipped")}</p>
      )}
    </div>
  );
}
