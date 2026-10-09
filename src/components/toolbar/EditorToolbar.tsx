import {
  Download,
  Hand,
  Maximize,
  MousePointer2,
  RectangleVertical,
  Redo2,
  Settings,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { t as translate } from "../../i18n";
import { includedPages } from "../../lib/document-layout";
import { getLayoutDocuments, useLayoutDocuments } from "../../lib/documents";
import { type AppError, formatError, toAppError } from "../../lib/errors";
import { buildExportPlan, mergeIssues } from "../../lib/export-plan";
import { emitHintEvent } from "../../lib/hint-events";
import { buildPrintRequest } from "../../lib/print-request";
import { activateDocument } from "../../lib/project-actions";
import { exportPrint, validatePrint } from "../../lib/sheet-api";
import { exportDocument, pickExportPath, validateExport } from "../../lib/tauri";
import { switchWorkspace } from "../../lib/workspace";
import { zoomActions } from "../../lib/zoom-actions";
import { documentById, fileName, useDocumentStore } from "../../stores/document-store";
import { type Tool, useEditorStore } from "../../stores/editor-store";
import { redo, undo, useHistory } from "../../stores/history";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { planOf, usePrintStore } from "../../stores/print-store";
import { useProjectStore } from "../../stores/project-store";
import { type Stage, useUiStore } from "../../stores/ui-store";
import { Button } from "../ui/Button";
import { PanelsMenu } from "../workspace/PanelsMenu";
import { DocumentName } from "./DocumentName";
import { FileMenu } from "./FileMenu";

const TOOLS = [
  { id: "select", label: "toolbar.tools.select", key: "V", Icon: MousePointer2 },
  { id: "card", label: "toolbar.tools.card", key: "C", Icon: RectangleVertical },
  { id: "pan", label: "toolbar.tools.pan", key: "H", Icon: Hand },
] as const satisfies { id: Tool; label: string; key: string; Icon: typeof Hand }[];

const STAGES = [
  { id: "cards", label: "toolbar.stages.source" },
  { id: "print", label: "toolbar.stages.print" },
] as const satisfies { id: Stage; label: string }[];

/**
 * One line in the list of reasons an export cannot start. `page` is null for a problem with the plan itself;
 * `documentId` is the PDF the page is in.
 */
type ExportIssue = { documentId: number; page: number | null; error: AppError };

/** The line in the toolbar after an export. Worded when drawn, so changing the language updates it. */
type Status = { ok: boolean; text: () => string };

/** The file a PDF of the project was opened from (for naming the PDF a problem is in). */
const documentPath = (id: number) => documentById(useDocumentStore.getState(), id)?.path ?? "";

const base =
  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded py-1 hover:bg-[var(--hover)] disabled:opacity-40";
const btn = `${base} px-2`;
/** Buttons with only an icon are tighter, so the whole toolbar fits the minimum window width in Spanish too. */
const iconBtn = `${base} px-1.5`;

export function EditorToolbar() {
  const { t } = useTranslation();
  const pages = useDocumentStore((s) => s.pages);
  const path = useDocumentStore((s) => s.path);
  const setCurrentPage = useDocumentStore((s) => s.setCurrentPage);
  const documents = useLayoutDocuments();
  const activeGroups = useLayoutStore((s) => s.groups);
  // The Source tab exports the PDF being edited, the Print tab every PDF of the project.
  const includedCount =
    useUiStore((s) => s.stage) === "print"
      ? documents.reduce((n, d) => n + includedPages(d.groups).length, 0)
      : includedPages(activeGroups).length;
  const canUndo = useHistory((s) => s.canUndo);
  const canRedo = useHistory((s) => s.canRedo);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  // Pages that would make the export fail, found before the save dialog opens.
  const [issues, setIssues] = useState<ExportIssue[]>([]);
  const stage = useUiStore((s) => s.stage);
  const setStage = useUiStore((s) => s.setStage);

  /** Source tab: every included page of the PDF being edited with its own grid, as before. */
  const exportCards = async (source: string) => {
    const state = useLayoutStore.getState();
    const documentId = useDocumentStore.getState().activeId;
    const plan = buildExportPlan(state.groups, state, state.freeform);
    if (plan.jobs.length === 0 && plan.issues.length === 0) {
      setStatus({ ok: false, text: () => translate("toolbar.includeOnePage") });
      return;
    }
    const remote = plan.jobs.length ? await validateExport(documentId, plan.jobs) : [];
    const found = mergeIssues(plan.issues, remote);
    if (found.length > 0) {
      setIssues(found.map((i) => ({ documentId, page: i.page_index, error: toAppError(i) })));
      return;
    }
    const out = await pickExportPath(source);
    if (!out) return;
    const n = await exportDocument(documentId, plan.jobs, out);
    setStatus({ ok: true, text: () => translate("toolbar.exportedPages", { count: n, path: out }) });
  };

  /** Print tab: the sheets the plan produces. The same planner runs for the check and the export. */
  const exportSheets = async (source: string) => {
    const layout = useLayoutStore.getState();
    const print = usePrintStore.getState();
    if (!print.sheets?.length && !print.sheetsError) {
      setStatus({ ok: false, text: () => translate("toolbar.nothingToPrint") });
      return;
    }
    const req = buildPrintRequest(planOf(print), print.cards, getLayoutDocuments(), layout, layout.cardEdits);
    try {
      const found = await validatePrint(req);
      if (found.length > 0) {
        setIssues(
          found.map((i) => ({
            documentId: i.document_id ?? useDocumentStore.getState().activeId,
            page: i.page_index,
            error: toAppError(i),
          })),
        );
        return;
      }
    } catch (e) {
      // The plan itself does not work (for example pieces that do not fit the sheet).
      setIssues([{ documentId: useDocumentStore.getState().activeId, page: null, error: toAppError(e) }]);
      return;
    }
    const out = await pickExportPath(source, "print", print.exportName);
    if (!out) return;
    const n = await exportPrint(req, out);
    setStatus({ ok: true, text: () => translate("toolbar.exportedSheets", { count: n, path: out }) });
  };

  const doExport = async () => {
    if (!path) return;
    try {
      setExporting(true);
      setStatus(null);
      setIssues([]);
      emitHintEvent("export-started");
      await (stage === "print" ? exportSheets(useProjectStore.getState().path ?? path) : exportCards(path));
    } catch (e) {
      const error = toAppError(e);
      setStatus({ ok: false, text: () => formatError(error) });
    } finally {
      setExporting(false);
    }
  };

  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const viewMode = useEditorStore((s) => s.viewMode);
  // The switcher is the ordered list from Preferences; with a single view there is nothing to switch.
  const visibleModes = usePreferencesStore((s) => s.prefs.workspace.visibleModes);
  const setPrefsOpen = useUiStore((s) => s.setPrefsOpen);
  const { zoomIn, zoomOut, fitPage } = zoomActions;
  const empty = pages.length === 0;
  return (
    <header className="relative flex h-9 shrink-0 items-center gap-1 border-b border-[var(--border)] bg-[var(--panel)] px-2">
      <FileMenu />
      <div className="mx-1 h-4 w-px bg-[var(--border)]" />
      <div
        role="tablist"
        aria-label={t("toolbar.stageTabs")}
        data-hint-target="stage-tabs"
        className="flex items-center gap-1"
      >
        {STAGES.map(({ id, label }) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={stage === id}
            onClick={() => setStage(id)}
            disabled={empty}
            className={`${btn} ${stage === id ? "bg-[var(--active)]" : ""}`}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div className="mx-1 h-4 w-px bg-[var(--border)]" />
      {stage === "cards" &&
        TOOLS.map(({ id, label, key, Icon }) => (
          <button
            type="button"
            key={id}
            title={t("toolbar.toolTitle", { label: t(label), key })}
            onClick={() => setTool(id)}
            className={`${iconBtn} ${tool === id ? "bg-[var(--active)]" : ""}`}
          >
            <Icon size={14} />
          </button>
        ))}
      <div className="mx-1 h-4 w-px bg-[var(--border)]" />
      <button type="button" title={t("toolbar.undo")} onClick={undo} disabled={!canUndo} className={iconBtn}>
        <Undo2 size={14} />
      </button>
      <button type="button" title={t("toolbar.redo")} onClick={redo} disabled={!canRedo} className={iconBtn}>
        <Redo2 size={14} />
      </button>
      {stage === "cards" && (
        <>
          <div className="mx-1 h-4 w-px bg-[var(--border)]" />
          <button type="button" title={t("toolbar.zoomOut")} onClick={zoomOut} disabled={empty} className={iconBtn}>
            <ZoomOut size={14} />
          </button>
          <button type="button" title={t("toolbar.zoomIn")} onClick={zoomIn} disabled={empty} className={iconBtn}>
            <ZoomIn size={14} />
          </button>
          <button type="button" title={t("toolbar.fitPage")} onClick={fitPage} disabled={empty} className={iconBtn}>
            <Maximize size={14} />
          </button>
          <div className="mx-1 h-4 w-px bg-[var(--border)]" />
          {visibleModes.length > 1 && (
            <div role="tablist" aria-label={t("toolbar.viewTabs")} className="flex items-center gap-1">
              {visibleModes.map((id) => (
                <button
                  type="button"
                  key={id}
                  role="tab"
                  aria-selected={viewMode === id}
                  onClick={() => {
                    switchWorkspace(id);
                    // Clicking Preview (even when already there) refreshes a manual preview.
                    if (id === "output") useLayoutStore.getState().updatePreview();
                  }}
                  disabled={empty}
                  className={`${btn} ${viewMode === id ? "bg-[var(--active)]" : ""}`}
                >
                  {t(`views.${id}`)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="flex min-w-0 flex-1 items-center justify-center px-2">
        <DocumentName />
      </div>
      {status && (
        <span
          title={status.text()}
          className={`mr-2 max-w-[40ch] truncate text-[11px] ${status.ok ? "text-[var(--muted)]" : "text-red-400"}`}
        >
          {status.text()}
        </span>
      )}
      <PanelsMenu />
      <button
        type="button"
        title={t("toolbar.preferences")}
        aria-label={t("toolbar.preferencesLabel")}
        onClick={() => setPrefsOpen(true)}
        className={`${iconBtn} mr-1`}
      >
        <Settings size={14} />
      </button>
      <Button
        variant="primary"
        onClick={doExport}
        data-hint-target="export-button"
        disabled={!path || includedCount === 0 || exporting}
        title={includedCount === 0 ? t("toolbar.everyPageSkipped") : t("toolbar.exportPdf")}
        className="flex shrink-0 items-center gap-1.5 whitespace-nowrap"
      >
        <Download size={14} /> {exporting ? t("toolbar.exporting") : t("toolbar.exportPdf")}
      </Button>
      {issues.length > 0 && (
        <section
          aria-label={t("toolbar.issues.label")}
          className="absolute right-2 top-10 z-50 w-96 max-w-[90vw] rounded border border-red-400/50 bg-[var(--panel)] p-2 shadow-xl shadow-black/40"
        >
          <div className="mb-1 flex items-center justify-between font-medium text-red-300">
            <span>
              {issues.length === 1 && issues[0].page === null
                ? t("toolbar.issues.planTitle")
                : t("toolbar.issues.pagesTitle", { count: issues.length })}
            </span>
            <button
              type="button"
              aria-label={t("toolbar.issues.close")}
              onClick={() => setIssues([])}
              className="rounded p-0.5 hover:bg-[var(--hover)]"
            >
              <X size={12} />
            </button>
          </div>
          <ul className="max-h-72 overflow-y-auto">
            {issues.map((i) => (
              <li key={`${i.documentId}:${i.page}:${i.error.message}`}>
                <button
                  type="button"
                  disabled={i.page === null}
                  onClick={() => {
                    if (i.page === null) return;
                    activateDocument(i.documentId);
                    setCurrentPage(i.page);
                  }}
                  className="w-full rounded px-1.5 py-1 text-left hover:bg-[var(--hover)] disabled:hover:bg-transparent"
                >
                  {i.page !== null && (
                    <span className="font-medium">
                      {documents.length > 1
                        ? t("toolbar.issues.pageIn", { n: i.page + 1, name: fileName(documentPath(i.documentId)) })
                        : t("toolbar.issues.page", { n: i.page + 1 })}{" "}
                    </span>
                  )}
                  <span className="text-[var(--muted)]">{formatError(i.error)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[var(--muted)]">
            {stage === "print" ? t("toolbar.issues.fixPrint") : t("toolbar.issues.fixSource")}
          </p>
        </section>
      )}
    </header>
  );
}
