import { Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { cardIdKey } from "../../lib/card";
import { rangeLabel } from "../../lib/document-layout";
import { commonQuantity, filterCards } from "../../lib/library";
import { MAX_QUANTITY } from "../../lib/print-request";
import { cellWidth, gridColumns, rowCount, visibleRows } from "../../lib/virtual-grid";
import { useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePrintStore } from "../../stores/print-store";
import { NumberField } from "../ui/NumberField";
import { Select } from "../ui/Select";
import { CardThumb } from "./CardThumb";

const GAP = 6;
const CELL_MIN = 84;
const LABEL_PX = 6;
/** Cards are mostly portrait: the thumbnail area is this much taller than wide. */
const ASPECT = 1.35;

const smallBtn = "rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--hover)] disabled:opacity-40";

type FilterChoice = "all" | "page" | `group:${number}`;

/**
 * Every card of the page groups, as a windowed grid of thumbnails (only the rows near the view are
 * mounted). Click selects, Ctrl/Cmd toggles, Shift selects a range; the copies field sets how many
 * of each selected card to print.
 */
export function CardLibrary() {
  const hasDocument = useDocumentStore((s) => s.pages.length > 0);
  const groups = useLayoutStore((s) => s.groups);
  const P = usePrintStore(
    useShallow((s) => ({
      cards: s.cards,
      cardsError: s.cardsError,
      filter: s.filter,
      selection: s.selection,
      mode: s.mode,
      quantities: s.quantities,
      setFilter: s.setFilter,
      clickCard: s.clickCard,
      selectAll: s.selectAll,
      clearSelection: s.clearSelection,
      setQuantity: s.setQuantity,
      adjustQuantity: s.adjustQuantity,
    })),
  );

  const shown = useMemo(() => filterCards(P.cards, groups, P.filter), [P.cards, groups, P.filter]);
  const keys = useMemo(() => shown.map((c) => cardIdKey(c.id)), [shown]);
  const selected = useMemo(() => new Set(P.selection.selected), [P.selection.selected]);

  // The scroll area's size and position drive which rows are mounted.
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scroll area exists once a document is open
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasDocument]);
  // A different filter shows different cards: start from the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the filter is the trigger
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setScrollTop(0);
  }, [P.filter]);

  const columns = gridColumns(box.width, CELL_MIN, GAP);
  const width = cellWidth(box.width, columns, GAP);
  const height = width * ASPECT + LABEL_PX + 14;
  const rowHeight = height + GAP;
  const rows = rowCount(shown.length, columns);
  const { first, last } = visibleRows(scrollTop, box.height, rowHeight, rows);

  const filterValue: FilterChoice =
    P.filter.kind === "group" ? `group:${P.filter.index}` : P.filter.kind === "page" ? "page" : "all";
  const groupOptions = groups.flatMap((g, i) =>
    g.kind === "grid" && g.selection
      ? [{ value: `group:${i}` as FilterChoice, label: `${rangeLabel(g.pages)} (${g.grid.rows}×${g.grid.columns})` }]
      : [],
  );
  const pageCount = useDocumentStore((s) => s.pages.length);

  const picked = P.selection.selected;
  const copies = P.mode === "custom" ? commonQuantity(P.quantities, picked) : null;
  const allMode = P.mode === "all";

  if (!hasDocument) return <Empty>Open a PDF to see its cards.</Empty>;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="card-library">
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-[var(--border)] p-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[var(--muted)]">Show</span>
          <Select
            label="Filter cards by group"
            value={filterValue}
            onChange={(v) => {
              if (v === "all") P.setFilter({ kind: "all" });
              else if (v !== "page") P.setFilter({ kind: "group", index: Number(v.slice("group:".length)) });
            }}
            options={[
              { value: "all" as FilterChoice, label: "All cards" },
              // Shown while a single page is filtered, so the menu says what is on screen.
              ...(P.filter.kind === "page"
                ? [{ value: "page" as FilterChoice, label: `Page ${P.filter.page + 1}` }]
                : []),
              ...groupOptions,
            ]}
          />
          <span className="ml-auto flex items-center gap-1 text-[var(--muted)]">
            Page
            <NumberField
              hideLabel
              label="Show only page"
              value={P.filter.kind === "page" ? P.filter.page + 1 : null}
              min={1}
              max={pageCount}
              onCommit={(p) => P.setFilter({ kind: "page", page: p - 1 })}
            />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={smallBtn} onClick={() => P.selectAll(keys)} disabled={keys.length === 0}>
            Select all
          </button>
          <button
            type="button"
            className={smallBtn}
            onClick={P.clearSelection}
            disabled={picked.length === 0}
            title="Clear the selection"
          >
            Clear
          </button>
          <span className="text-[var(--muted)]">
            {picked.length} of {shown.length} selected
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--muted)]">Copies</span>
          <button
            type="button"
            className={smallBtn}
            aria-label="One copy fewer"
            disabled={picked.length === 0}
            onClick={() => P.adjustQuantity(picked, -1)}
          >
            <Minus size={12} />
          </button>
          <NumberField
            hideLabel
            hideSteppers
            label="Copies of the selected cards"
            value={copies}
            min={0}
            max={MAX_QUANTITY}
            disabled={picked.length === 0}
            onCommit={(n) => P.setQuantity(picked, n)}
          />
          <button
            type="button"
            className={smallBtn}
            aria-label="One copy more"
            disabled={picked.length === 0}
            onClick={() => P.adjustQuantity(picked, 1)}
          >
            <Plus size={12} />
          </button>
        </div>
        <p className="text-[var(--muted)]">
          {allMode
            ? "Every card prints once. Change the copies of a card to print a custom selection."
            : "Only cards with copies are printed."}
        </p>
      </div>

      <div
        ref={ref}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        data-testid="card-library-scroll"
      >
        {P.cardsError ? (
          <p className="p-3 text-red-400">{P.cardsError}</p>
        ) : P.cards.length === 0 ? (
          <Empty>No cards yet. Draw the card region on a page in the Cards stage.</Empty>
        ) : shown.length === 0 ? (
          <Empty>No cards match this filter.</Empty>
        ) : (
          <div className="relative" style={{ height: rows * rowHeight }}>
            {Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i).map((row) => (
              <div key={row} className="absolute left-0 flex" style={{ top: row * rowHeight, gap: GAP }}>
                {shown.slice(row * columns, (row + 1) * columns).map((card, col) => {
                  const key = keys[row * columns + col];
                  return (
                    <CardThumb
                      key={key}
                      card={card}
                      width={width}
                      height={height}
                      selected={selected.has(key)}
                      copies={allMode ? null : (P.quantities[key] ?? 0)}
                      onClick={(e) =>
                        P.clickCard(key, keys, e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "none")
                      }
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-3 text-[var(--muted)]">{children}</p>;
}
