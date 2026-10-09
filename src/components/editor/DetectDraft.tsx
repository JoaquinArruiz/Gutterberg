import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { orientedToScreen, rectToScreen, type ViewportState } from "../../lib/coordinates";
import { confidenceBand, gridFromProposal, pieceCount, piecesFromProposal } from "../../lib/detect";
import { applyDraft, discardDraft } from "../../lib/detect-actions";
import type { Proposal } from "../../lib/detect-api";
import { cardRects } from "../../lib/grid";
import type { PageSize } from "../../lib/tauri";
import { useDocumentStore } from "../../stores/document-store";
import { useEditorStore } from "../../stores/editor-store";
import { useLayoutStore } from "../../stores/layout-store";
import { Button } from "../ui/Button";

const DRAFT = "#f59e0b";

/** The proposal on show, when the draft belongs to the page and PDF in front of the user. */
export function useShownProposal(): Proposal | null {
  const draft = useEditorStore((s) => s.draft);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const activeId = useDocumentStore((s) => s.activeId);
  if (!draft || draft.page !== currentPage || draft.documentId !== activeId) return null;
  return draft.detection.proposals[draft.index] ?? null;
}

/**
 * The draft on the page: dashed outlines of every piece the proposal would make. It never takes a
 * pointer event, so the tools underneath keep working while it is up.
 */
export function DetectOverlay({ viewport, page }: { viewport: ViewportState; page: PageSize }) {
  const proposal = useShownProposal();
  if (!proposal) return null;
  const common = { fill: DRAFT, fillOpacity: 0.1, stroke: DRAFT, strokeWidth: 1.5, strokeDasharray: "6 3" };
  const grid = gridFromProposal(proposal, page);
  const pieces = piecesFromProposal(proposal, page);
  return (
    <g pointerEvents="none" data-testid="detect-overlay">
      {grid &&
        cardRects(grid.selection, { ...grid, gapXMm: grid.sourceGapXMm, gapYMm: grid.sourceGapYMm }, page).map(
          (r, i) => {
            const s = rectToScreen(r, viewport, page);
            return (
              <rect
                // biome-ignore lint/suspicious/noArrayIndexKey: the cells of a grid have no id; their place is their identity
                key={i}
                data-testid="detect-piece"
                x={s.x}
                y={s.y}
                width={s.width}
                height={s.height}
                {...common}
              />
            );
          },
        )}
      {pieces?.map((r, i) => {
        const s = orientedToScreen(r, viewport, page);
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of a proposal have no id; their place is their identity
            key={i}
            data-testid="detect-piece"
            x={s.center.x - s.width / 2}
            y={s.center.y - s.height / 2}
            width={s.width}
            height={s.height}
            transform={`rotate(${s.angle_deg} ${s.center.x} ${s.center.y})`}
            {...common}
          />
        );
      })}
    </g>
  );
}

/** True when a key press is meant for a field or a menu, not for the draft. */
const typingInto = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.getAttribute("role") === "combobox");

/**
 * What the draft is and what to do with it: which engine found it, how sure it is, how many pieces,
 * and Apply / Next proposal / Discard (Enter and Esc work too). Low confidence says so.
 */
export function DetectDraftBar({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const proposal = useShownProposal();
  const total = useEditorStore((s) => s.draft?.detection.proposals.length ?? 0);
  const index = useEditorStore((s) => s.draft?.index ?? 0);
  const nextProposal = useEditorStore((s) => s.nextProposal);
  const currentPage = useDocumentStore((s) => s.currentPage);
  const existing = useLayoutStore((s) => s.freeform[currentPage]?.length ?? 0);

  useEffect(() => {
    if (!proposal) return;
    const onKey = (e: KeyboardEvent) => {
      if (typingInto(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter") {
        e.preventDefault();
        applyDraft();
      } else if (e.key === "Escape") {
        e.preventDefault();
        discardDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [proposal]);

  if (!proposal) return null;
  const band = confidenceBand(proposal);
  const count = pieceCount(proposal);
  const size =
    proposal.kind === "grid"
      ? t("detect.gridSize", { rows: proposal.rows, columns: proposal.columns, count })
      : t("detect.pieceCount", { count });
  const replaces = proposal.kind === "rects" && existing > 0;
  return (
    <div
      className={`flex flex-col gap-1.5 rounded border border-[var(--border)] bg-[var(--panel)] p-2 shadow-lg shadow-black/40 ${className}`}
      role="status"
      data-testid="detect-bar"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-semibold" style={{ color: DRAFT }}>
          {t("detect.draft")}
        </span>
        <span data-testid="detect-size">{size}</span>
        <span className="text-[var(--muted)]" data-testid="detect-engine">
          {t(`detect.engines.${engineKey(proposal.engine)}`)}
        </span>
        <span
          className={band === "low" ? "font-semibold text-amber-400" : "text-[var(--muted)]"}
          data-testid="detect-confidence"
        >
          {t(`detect.confidence.${band}`)}
        </span>
        {total > 1 && (
          <span className="ml-auto text-[var(--muted)]" data-testid="detect-which">
            {t("detect.which", { n: index + 1, total })}
          </span>
        )}
      </div>
      {band === "low" && <p className="text-amber-400">{t("detect.lowWarning")}</p>}
      {proposal.notes.map((n) => (
        <p key={n} className="text-[var(--muted)]">
          {t(`detect.notes.${n}`)}
        </p>
      ))}
      <div className="flex flex-wrap gap-1.5">
        <Button size="md" variant="primary" onClick={applyDraft}>
          {replaces ? t("detect.replace", { count: existing }) : t("detect.apply")}
        </Button>
        {total > 1 && (
          <Button size="md" onClick={nextProposal}>
            {t("detect.next")}
          </Button>
        )}
        <Button size="md" onClick={discardDraft}>
          {t("detect.discard")}
        </Button>
      </div>
    </div>
  );
}

/** The catalog key of an engine's name; an engine the UI does not know (a later one) reads as "other". */
export function engineKey(engine: string): "objects" | "edges" | "blobs" | "ai" | "other" {
  if (engine === "ai") return "ai";
  return engine === "pdf-objects" ? "objects" : engine === "edges" ? "edges" : engine === "blobs" ? "blobs" : "other";
}
