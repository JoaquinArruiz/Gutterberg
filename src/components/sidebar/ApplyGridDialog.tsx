import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { clampRange, gridsLabel, pagesOfSameSize, rangeLabel, runsOf } from "../../lib/document-layout";
import { useDocumentStore } from "../../stores/document-store";
import { useActiveGrid, useCurrentGridGroup, useLayoutStore } from "../../stores/layout-store";
import { Button } from "../ui/Button";
import { NumberField } from "../ui/NumberField";
import { RadioCard, RadioCardGroup } from "../ui/RadioCard";

type Target = "page" | "range" | "same-size";
type Which = "active" | "all";

/**
 * "Apply this grid to…": copies the viewed page's grid and piece region onto this page, a range of
 * pages or every page of the same size. Each target becomes its own group, so it can then be
 * edited without touching the rest. With several grids on the page it copies the grid being edited,
 * or all of them.
 */
export function ApplyGridDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const pages = useDocumentStore((s) => s.pages);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const group = useCurrentGridGroup();
  const active = useActiveGrid();
  const [which, setWhich] = useState<Which>("all");
  const several = (group?.grids.length ?? 0) > 1;
  const region = group?.grids[active];
  const groups = useLayoutStore((s) => s.groups);
  const applyGrid = useLayoutStore((s) => s.applyGrid);
  const [target, setTarget] = useState<Target>("same-size");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setFrom(currentPage + 1);
      setTo(pages.length);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, currentPage, pages.length]);

  const range = clampRange(from - 1, to - 1, pages.length);
  const targets =
    target === "page"
      ? [currentPage]
      : target === "range"
        ? Array.from({ length: range.last - range.first + 1 }, (_, i) => range.first + i)
        : pagesOfSameSize(groups, pages, currentPage);
  const summary = runsOf(targets).map(rangeLabel).join(", ");

  return (
    <dialog
      ref={ref}
      aria-label={t("applyGrid.dialog")}
      onClose={onClose}
      onMouseDown={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[420px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/50"
    >
      <h2 className="mb-1 text-sm font-semibold">{t("applyGrid.title")}</h2>
      {group ? (
        <>
          <p className="mb-3 text-[var(--muted)]">
            {several
              ? t("applyGrid.descriptionSeveral", { page: currentPage + 1 })
              : t("applyGrid.description", {
                  page: currentPage + 1,
                  rows: group.grids[0].grid.rows,
                  columns: group.grids[0].grid.columns,
                })}
          </p>
          {several && region && (
            <div className="mb-3">
              <RadioCardGroup<Which> label={t("applyGrid.which")} value={which} onChange={setWhich}>
                <RadioCard
                  value="all"
                  title={t("applyGrid.allGrids", { count: group.grids.length, grids: gridsLabel(group) })}
                />
                <RadioCard
                  value="active"
                  title={t("applyGrid.thisGrid", {
                    n: active + 1,
                    rows: region.grid.rows,
                    columns: region.grid.columns,
                  })}
                />
              </RadioCardGroup>
            </div>
          )}
          <RadioCardGroup<Target> label={t("applyGrid.dialog")} value={target} onChange={setTarget}>
            <RadioCard value="page" title={t("applyGrid.onlyThisPage")} />
            <RadioCard value="range" title={t("applyGrid.pagesRange")}>
              <div className="flex flex-wrap items-center gap-2">
                <NumberField
                  hideLabel
                  label={t("applyGrid.fromPage")}
                  value={from}
                  onCommit={setFrom}
                  min={1}
                  max={pages.length}
                />
                <span>{t("applyGrid.to")}</span>
                <NumberField
                  hideLabel
                  label={t("applyGrid.toPage")}
                  value={to}
                  onCommit={setTo}
                  min={1}
                  max={pages.length}
                />
              </div>
            </RadioCard>
            <RadioCard value="same-size" title={t("applyGrid.sameSize")} />
          </RadioCardGroup>
          <p className="mt-3 text-[var(--muted)]">{summary}</p>
        </>
      ) : (
        <p className="mb-3 text-[var(--muted)]">{t("applyGrid.skippedNoGrid")}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button size="md" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          size="md"
          disabled={!group || targets.length === 0}
          onClick={() => {
            applyGrid(currentPage, targets, several && which === "all" ? "all" : active);
            onClose();
          }}
        >
          {t("common.apply")}
        </Button>
      </div>
    </dialog>
  );
}
