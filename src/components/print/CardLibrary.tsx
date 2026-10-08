import { Minus, Plus, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { cardIdKey } from "../../lib/card";
import { moveCards, orientCards, setBacks, turnCards } from "../../lib/card-edits";
import { rangeLabel } from "../../lib/document-layout";
import { useLayoutDocuments } from "../../lib/documents";
import { formatError } from "../../lib/errors";
import { commonQuantity, filterCards } from "../../lib/library";
import { MAX_QUANTITY } from "../../lib/print-request";
import { useLibraryCards } from "../../lib/use-library-cards";
import { cellWidth, gridColumns, rowCount, visibleRows } from "../../lib/virtual-grid";
import { documentById, fileName, useDocumentStore } from "../../stores/document-store";
import { useLayoutStore } from "../../stores/layout-store";
import { usePrintStore } from "../../stores/print-store";
import { NumberField } from "../ui/NumberField";
import { Select } from "../ui/Select";
import { CardThumb } from "./CardThumb";
import { useCardDrag } from "./use-card-drag";

const GAP = 6;
const CELL_MIN = 84;
const LABEL_PX = 6;
/** Cards are mostly portrait: the thumbnail area is this much taller than wide. */
const ASPECT = 1.35;

const smallBtn = "rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--hover)] disabled:opacity-40";

type FilterChoice = "all" | "page" | `doc:${number}` | `group:${number}:${number}`;

/**
 * Every piece of the page groups, as a windowed grid of thumbnails (only the rows near the view are
 * mounted). Click selects, Ctrl/Cmd toggles, Shift selects a range; the copies field sets how many
 * of each selected piece to print.
 */
export function CardLibrary() {
  const { t } = useTranslation();
  const hasDocument = useDocumentStore((s) => s.documents.length > 0);
  const activeId = useDocumentStore((s) => s.activeId);
  const documents = useLayoutDocuments();
  const P = usePrintStore(
    useShallow((s) => ({
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
      pickingBack: s.pickingBack,
      setPickingBack: s.setPickingBack,
    })),
  );
  const commonBack = usePrintStore((s) => s.finish.duplex.commonBack);

  // The cards as they print: the engine's, with the user's turn, scale and order applied.
  const cards = useLibraryCards();
  const cardCount = usePrintStore((s) => s.cards.length);
  const edits = useLayoutStore((s) => s.cardEdits);
  const setEdits = useLayoutStore((s) => s.setCardEdits);
  const shown = useMemo(() => filterCards(cards, documents, P.filter), [cards, documents, P.filter]);
  const keys = useMemo(() => shown.map((c) => cardIdKey(c.id)), [shown]);
  const selected = useMemo(() => new Set(P.selection.selected), [P.selection.selected]);

  // Choosing a back: the next click on a piece sets it as the back of the selection; Esc cancels.
  const { pickingBack, setPickingBack } = P;
  useEffect(() => {
    if (!pickingBack) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPickingBack(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickingBack, setPickingBack]);

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
    P.filter.kind === "group"
      ? `group:${P.filter.document}:${P.filter.index}`
      : P.filter.kind === "document"
        ? `doc:${P.filter.document}`
        : P.filter.kind === "page"
          ? "page"
          : "all";
  // With several PDFs the menu names each one, and its groups say which PDF they belong to.
  const several = documents.length > 1;
  const nameOf = (id: number) => fileName(documentById(useDocumentStore.getState(), id)?.path ?? "");
  const documentOptions = several
    ? documents.map((d) => ({
        value: `doc:${d.id}` as FilterChoice,
        label: t("library.allOfDocument", { name: nameOf(d.id) }),
      }))
    : [];
  const groupOptions = documents.flatMap((d) =>
    d.groups.flatMap((g, i) =>
      g.kind === "grid" && g.selection
        ? [
            {
              value: `group:${d.id}:${i}` as FilterChoice,
              label: t(several ? "library.groupIn" : "library.group", {
                name: nameOf(d.id),
                range: rangeLabel(g.pages),
                rows: g.grid.rows,
                columns: g.grid.columns,
              }),
            },
          ]
        : [],
    ),
  );
  // The page field looks at the PDF the filter is on, or the one being edited.
  const pageDocument = P.filter.kind === "all" ? activeId : P.filter.document;
  const pageCount = documents.find((d) => d.id === pageDocument)?.pages.length ?? 0;

  const picked = P.selection.selected;
  const turn = (delta: number) => picked.length > 0 && setEdits(turnCards(edits, cards, picked, delta));
  const orient = (to: "portrait" | "landscape") => picked.length > 0 && setEdits(orientCards(edits, cards, picked, to));
  const sort = useCardDrag({
    scrollRef: ref,
    selected: picked,
    onDrop: (keys, target, after) => setEdits(moveCards(edits, cards, keys, target, after)),
  });

  // R turns the selected cards a quarter turn clockwise, Shift+R counter-clockwise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
      if (typing || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== "r") return;
      e.preventDefault();
      turn(e.shiftKey ? -90 : 90);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const copies = P.mode === "custom" ? commonQuantity(P.quantities, picked) : null;
  const allMode = P.mode === "all";

  if (!hasDocument) return <Empty>{t("library.openPdf")}</Empty>;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="card-library" data-hint-target="card-library">
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-[var(--border)] p-2">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[var(--muted)]">{t("library.show")}</span>
          <Select
            className="min-w-0 flex-1 [&>button]:min-w-0"
            label={t("library.filterLabel")}
            value={filterValue}
            onChange={(v) => {
              if (v === "all") P.setFilter({ kind: "all" });
              else if (v.startsWith("doc:")) P.setFilter({ kind: "document", document: Number(v.slice(4)) });
              else if (v.startsWith("group:")) {
                const [document, index] = v.slice(6).split(":").map(Number);
                P.setFilter({ kind: "group", document, index });
              }
            }}
            options={[
              { value: "all" as FilterChoice, label: t("library.all") },
              // Shown while a single page is filtered, so the menu says what is on screen.
              ...(P.filter.kind === "page"
                ? [{ value: "page" as FilterChoice, label: t("common.page", { n: P.filter.page + 1 }) }]
                : []),
              ...documentOptions,
              ...groupOptions,
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="flex shrink-0 items-center gap-1 text-[var(--muted)]">
            {t("library.page")}
            <NumberField
              hideLabel
              label={t("library.showOnlyPage")}
              value={P.filter.kind === "page" ? P.filter.page + 1 : null}
              min={1}
              max={pageCount}
              onCommit={(p) => P.setFilter({ kind: "page", document: pageDocument, page: p - 1 })}
            />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={smallBtn} onClick={() => P.selectAll(keys)} disabled={keys.length === 0}>
            {t("library.selectAll")}
          </button>
          <button
            type="button"
            className={smallBtn}
            onClick={P.clearSelection}
            disabled={picked.length === 0}
            title={t("library.clearTitle")}
          >
            {t("library.clear")}
          </button>
          <span className="text-[var(--muted)]">
            {t("library.selected", { selected: picked.length, total: shown.length })}
          </span>
        </div>
        <div className="flex items-center gap-1.5" data-hint-target="copies">
          <span className="text-[var(--muted)]">{t("library.copies")}</span>
          <button
            type="button"
            className={smallBtn}
            aria-label={t("library.copiesFewer")}
            disabled={picked.length === 0}
            onClick={() => P.adjustQuantity(picked, -1)}
          >
            <Minus size={12} />
          </button>
          <NumberField
            hideLabel
            hideSteppers
            label={t("library.copiesLabel")}
            value={copies}
            min={0}
            max={MAX_QUANTITY}
            disabled={picked.length === 0}
            onCommit={(n) => P.setQuantity(picked, n)}
          />
          <button
            type="button"
            className={smallBtn}
            aria-label={t("library.copiesMore")}
            disabled={picked.length === 0}
            onClick={() => P.adjustQuantity(picked, 1)}
          >
            <Plus size={12} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" data-testid="card-turn">
          <span className="text-[var(--muted)]">{t("library.turn")}</span>
          <button
            type="button"
            className={smallBtn}
            aria-label={t("library.turnLeft")}
            title={t("library.turnLeftTitle")}
            disabled={picked.length === 0}
            onClick={() => turn(-90)}
          >
            <RotateCcw size={12} />
          </button>
          <button
            type="button"
            className={smallBtn}
            aria-label={t("library.turnRight")}
            title={t("library.turnRightTitle")}
            disabled={picked.length === 0}
            onClick={() => turn(90)}
          >
            <RotateCw size={12} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className={`${smallBtn} truncate`}
            title={t("library.makePortraitTitle")}
            disabled={picked.length === 0}
            onClick={() => orient("portrait")}
          >
            {t("library.makePortrait")}
          </button>
          <button
            type="button"
            className={`${smallBtn} truncate`}
            title={t("library.makeLandscapeTitle")}
            disabled={picked.length === 0}
            onClick={() => orient("landscape")}
          >
            {t("library.makeLandscape")}
          </button>
        </div>
        <p className="text-[var(--muted)]">{allMode ? t("library.modeAll") : t("library.modeCustom")}</p>
        {pickingBack && (
          <p className="rounded bg-[var(--accent)]/20 p-1.5" role="status" data-testid="picking-back">
            {t("library.pickingBack")}
          </p>
        )}
      </div>

      <div
        ref={ref}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        data-testid="card-library-scroll"
      >
        {P.cardsError ? (
          <p className="p-3 text-red-400">{formatError(P.cardsError)}</p>
        ) : cardCount === 0 ? (
          <Empty>{t("library.emptyNone")}</Empty>
        ) : shown.length === 0 ? (
          <Empty>{t("library.emptyFilter")}</Empty>
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
                      back={edits.backs[key] !== undefined ? "own" : key === commonBack ? "common" : null}
                      dragging={sort.drag?.keys.includes(key)}
                      dropMark={sort.drag?.target?.key === key ? (sort.drag.target.after ? "after" : "before") : null}
                      onPointerDown={(e) => sort.onPointerDown(key, e)}
                      onClick={(e) => {
                        if (sort.wasDrag()) return;
                        if (pickingBack) {
                          setEdits(setBacks(edits, P.selection.selected, key));
                          setPickingBack(false);
                          return;
                        }
                        P.clickCard(key, keys, e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "none");
                      }}
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
