import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { clampRange, pagesOfSameSize, rangeLabel, runsOf } from "../../lib/document-layout";
import { useDocumentStore } from "../../stores/document-store";
import { useCurrentGridGroup, useLayoutStore } from "../../stores/layout-store";
import { NumberField } from "../ui/NumberField";

type Target = "page" | "range" | "same-size";

const btn = "rounded border border-[var(--border)] px-3 py-1 hover:bg-[var(--hover)] disabled:opacity-40";

/**
 * "Apply this grid to…": copies the viewed page's grid and piece region onto this page, a range of
 * pages or every page of the same size. Each target becomes its own group, so it can then be
 * edited without touching the rest.
 */
export function ApplyGridDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const pages = useDocumentStore((s) => s.pages);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const group = useCurrentGridGroup();
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
            {t("applyGrid.description", {
              page: currentPage + 1,
              rows: group.grid.rows,
              columns: group.grid.columns,
            })}
          </p>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2">
              <input type="radio" name="target" checked={target === "page"} onChange={() => setTarget("page")} />
              {t("applyGrid.onlyThisPage")}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="radio"
                name="target"
                id="apply-range"
                checked={target === "range"}
                onChange={() => setTarget("range")}
              />
              <label htmlFor="apply-range">{t("applyGrid.pagesRange")}</label>
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
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="target"
                checked={target === "same-size"}
                onChange={() => setTarget("same-size")}
              />
              {t("applyGrid.sameSize")}
            </label>
          </div>
          <p className="mt-3 text-[var(--muted)]">{summary}</p>
        </>
      ) : (
        <p className="mb-3 text-[var(--muted)]">{t("applyGrid.skippedNoGrid")}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btn} onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className={btn}
          disabled={!group || targets.length === 0}
          onClick={() => {
            applyGrid(currentPage, targets);
            onClose();
          }}
        >
          {t("common.apply")}
        </button>
      </div>
    </dialog>
  );
}
