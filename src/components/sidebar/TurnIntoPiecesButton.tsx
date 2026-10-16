import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { pageCount } from "../../lib/document-layout";
import { getLayoutDocuments } from "../../lib/documents";
import { formatError, toAppError } from "../../lib/errors";
import { computeCards } from "../../lib/sheet-api";
import { useDocumentStore } from "../../stores/document-store";
import { useCurrentGrid, useCurrentGroup, useLayoutStore } from "../../stores/layout-store";
import { Button } from "../ui/Button";
import { RadioCard, RadioCardGroup } from "../ui/RadioCard";

type Scope = "page" | "group";

/**
 * "Turn into pieces": the grid being edited on the viewed page becomes freeform pieces at the same place and size, so the page is
 * free for the next grid. When the grid is shared by several pages it asks whether this page only or all of them.
 * The cells come from the engine (`compute_cards`), so they are exactly what the library shows.
 */
export function TurnIntoPiecesButton() {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const page = useDocumentStore((s) => s.currentPage);
  const group = useCurrentGroup();
  const turn = useLayoutStore((s) => s.turnGridIntoPieces);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("page");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const grid = group?.kind === "grid" ? group : null;
  const region = useCurrentGrid()?.selection ?? null;
  const shared = grid ? pageCount(grid.pages) : 1;

  // The dialog exists only while it is open, so nothing of it is in the page otherwise.
  useEffect(() => {
    if (open && ref.current && !ref.current.open) ref.current.showModal();
  }, [open]);

  const run = async (onlyPage: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const output = useLayoutStore.getState();
      const cards = await computeCards(getLayoutDocuments(), output);
      const made = turn(page, onlyPage, cards);
      setMessage(
        made > 0
          ? { ok: true, text: t("source.turnIntoPieces.done", { count: made }) }
          : { ok: false, text: t("source.turnIntoPieces.none") },
      );
    } catch (e) {
      setMessage({ ok: false, text: formatError(toAppError(e)) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        disabled={!region || busy}
        title={t("source.turnIntoPieces.title")}
        onClick={() => (shared > 1 ? (setScope("page"), setOpen(true)) : void run(true))}
      >
        {t("source.turnIntoPieces.button")}
      </Button>
      {message && (
        <p role="status" className={`basis-full ${message.ok ? "text-[var(--muted)]" : "text-red-400"}`}>
          {message.text}
        </p>
      )}
      {open && (
        <dialog
          ref={ref}
          aria-label={t("source.turnIntoPieces.dialog")}
          onClose={() => setOpen(false)}
          onMouseDown={(e) => e.target === ref.current && setOpen(false)}
          className="m-auto w-[420px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/50"
        >
          <h2 className="mb-1 text-sm font-semibold">{t("source.turnIntoPieces.dialog")}</h2>
          <p className="mb-3 text-[var(--muted)]">{t("source.turnIntoPieces.shared", { count: shared })}</p>
          <RadioCardGroup<Scope> label={t("source.turnIntoPieces.dialog")} value={scope} onChange={setScope}>
            <RadioCard
              value="page"
              title={t("source.turnIntoPieces.onlyThisPage")}
              description={t("source.turnIntoPieces.onlyThisPageHint")}
            />
            <RadioCard
              value="group"
              title={t("source.turnIntoPieces.everyPage", { count: shared })}
              description={t("source.turnIntoPieces.everyPageHint")}
            />
          </RadioCardGroup>
          <div className="mt-4 flex justify-end gap-2">
            <Button size="md" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="md"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                void run(scope === "page");
              }}
            >
              {t("source.turnIntoPieces.button")}
            </Button>
          </div>
        </dialog>
      )}
    </>
  );
}
