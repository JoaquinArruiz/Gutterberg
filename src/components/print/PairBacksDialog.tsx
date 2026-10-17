import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { askPair, discardPairing } from "../../lib/ai-actions";
import { cardIdKey } from "../../lib/card";
import { formatError } from "../../lib/errors";
import { emitHintEvent } from "../../lib/hint-events";
import {
  applyPairing,
  DEFAULT_PAIRING,
  lonePiece,
  PAIRING_SPLITS,
  type Pairing,
  type PairingOptions,
  type PairingRule,
  type PairingSplit,
  pairingFromSides,
  pairPieces,
} from "../../lib/pairing";
import { type AiPairing, useAiStore } from "../../stores/ai-store";
import { documentName, useDocumentStore } from "../../stores/document-store";
import { together } from "../../stores/history";
import { useLayoutStore } from "../../stores/layout-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { usePrintStore } from "../../stores/print-store";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { RadioCard, RadioCardGroup } from "../ui/RadioCard";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";

/** Backs below their fronts are printed upside down in gutterfold files; beside them, or on other pages, they are not. */
const upsideDownByDefault = (o: PairingOptions) => o.rule === "beside" && o.split === "rows";

/** The answer of Pair backs with AI, when it is for exactly these pieces (the library may have changed since). */
function aiPairingFor(keys: string[], answer: AiPairing | null): Pairing | null {
  if (!answer || answer.keys.length !== keys.length || answer.keys.some((k, i) => k !== keys[i])) return null;
  return pairingFromSides(answer.keys, answer.sides);
}

/**
 * "Pair backs automatically…": finds the back of every piece from where it is in the source PDF (or, with AI Mode, from
 * pictures of the pieces) and, on Apply, gives each front its back (turned if the backs are upside down) and takes
 * the backs out of the printed copies, as one undo step.
 */
export function PairBacksDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const cards = usePrintStore((s) => s.cards);
  const documents = useDocumentStore(useShallow((s) => s.documents));
  const [chosen, setOptions] = useState<PairingOptions>(DEFAULT_PAIRING);
  // "By picture, with AI" is a choice of its own: no rule, the answer of the model.
  const [byAi, setByAi] = useState(false);
  const aiEnabled = usePreferencesStore((s) => s.prefs.ai.enabled);
  const provider = usePreferencesStore((s) => s.prefs.ai.provider);
  const estimating = useAiStore((s) => s.estimating);
  const running = useAiStore((s) => s.running);
  const aiError = useAiStore((s) => (s.error?.task === "pair" ? s.error.error : null));
  const usage = useAiStore((s) => (s.usage?.task === "pair" ? s.usage.tokens : null));
  const answer = useAiStore((s) => s.pairing);
  // Backs in another PDF needs two PDFs; until one is picked, the last one added is the backs.
  const several = documents.length > 1;
  const backsDocument = documents.some((d) => d.id === chosen.backsDocument)
    ? chosen.backsDocument
    : (documents[documents.length - 1]?.id ?? null);
  const options = useMemo(() => ({ ...chosen, backsDocument }), [chosen, backsDocument]);
  const rule = several || options.rule !== "otherPdf" ? options.rule : DEFAULT_PAIRING.rule;
  const useAi = aiEnabled && byAi;
  const keys = useMemo(() => cards.map((c) => cardIdKey(c.id)), [cards]);
  const fromAi = useMemo(() => aiPairingFor(keys, answer), [keys, answer]);
  const pairing: Pairing = useMemo(
    () => (useAi ? (fromAi ?? { backs: {}, unpaired: [] }) : pairPieces(cards, { ...options, rule })),
    [useAi, fromAi, cards, options, rule],
  );
  const pairs = Object.keys(pairing.backs).length;
  const common = rule === "otherPdf" && backsDocument !== null && lonePiece(cards, backsDocument) !== null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      emitHintEvent("pairing-opened");
    }
    if (!open && d.open) d.close();
  }, [open]);

  const change = (patch: Partial<PairingOptions>) =>
    setOptions((o) => {
      const next = { ...o, ...patch };
      return "upsideDown" in patch ? next : { ...next, upsideDown: upsideDownByDefault(next) };
    });

  const close = () => {
    discardPairing();
    onClose();
  };

  const apply = () => {
    emitHintEvent("pairing-applied");
    together(() => {
      const layout = useLayoutStore.getState();
      layout.setCardEdits(applyPairing(layout.cardEdits, pairing, options.upsideDown));
      if (pairing.commonBack) usePrintStore.getState().setDuplex({ commonBack: pairing.commonBack });
      // Only the fronts are printed: their backs come with them.
      const print = usePrintStore.getState();
      if (print.mode === "all") print.startFromAllCards();
      usePrintStore
        .getState()
        .setQuantity(
          [
            ...Object.values(pairing.backs),
            ...(pairing.commonBack ? [pairing.commonBack] : []),
            ...(pairing.backPieces ?? []),
          ],
          0,
        );
    });
    close();
  };

  const pick = (value: PairingRule | "ai") => {
    setByAi(value === "ai");
    if (value !== "ai") change({ rule: value });
  };
  const busy = estimating || running;

  return (
    <dialog
      ref={ref}
      aria-label={t("print.pairing.title")}
      onClose={(e) => e.target === e.currentTarget && close()}
      onMouseDown={(e) => e.target === ref.current && close()}
      className="m-auto w-[440px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[var(--fg)] shadow-2xl shadow-black/50 backdrop:bg-black/50"
    >
      <h2 className="mb-1 text-sm font-semibold">{t("print.pairing.title")}</h2>
      <p className="mb-3 text-[var(--muted)]">{t("print.pairing.text")}</p>
      <RadioCardGroup<PairingRule | "ai"> label={t("print.pairing.rule")} value={useAi ? "ai" : rule} onChange={pick}>
        <RadioCard
          value="alternating"
          title={t("print.pairing.rules.alternating")}
          description={t("print.pairing.rules.alternatingHint")}
        />
        <RadioCard
          value="afterFronts"
          title={t("print.pairing.rules.afterFronts")}
          description={t("print.pairing.rules.afterFrontsHint")}
        />
        <RadioCard
          value="beside"
          title={t("print.pairing.rules.beside")}
          description={t("print.pairing.rules.besideHint")}
        >
          {rule === "beside" && (
            <Segmented<PairingSplit>
              label={t("print.pairing.split")}
              value={options.split}
              onChange={(split) => change({ split })}
              options={PAIRING_SPLITS.map((value) => ({ value, label: t(`print.pairing.splits.${value}`) }))}
            />
          )}
        </RadioCard>
        {several && (
          <RadioCard
            value="otherPdf"
            title={t("print.pairing.rules.otherPdf")}
            description={t("print.pairing.rules.otherPdfHint")}
          >
            {rule === "otherPdf" && (
              <Select
                fill
                label={t("print.pairing.backsPdf")}
                value={String(backsDocument)}
                onChange={(id) => change({ backsDocument: Number(id) })}
                options={documents.map((d) => ({ value: String(d.id), label: documentName(d) }))}
              />
            )}
          </RadioCard>
        )}
        {aiEnabled && (
          <RadioCard value="ai" title={t("print.pairing.ai.title")} description={t("print.pairing.ai.hint")}>
            {useAi && (
              <div data-ai="pair" className="flex flex-col gap-1.5">
                <div>
                  <Button
                    variant="ai"
                    busy={busy}
                    disabled={busy || cards.length < 2}
                    title={t("print.pairing.ai.sends", { provider: t(`ai.providers.${provider}`) })}
                    onClick={() =>
                      void askPair(
                        cards,
                        documents.map((d) => d.id),
                      )
                    }
                  >
                    {running
                      ? t("print.pairing.ai.running")
                      : estimating
                        ? t("ai.sort.estimating")
                        : t("print.pairing.ai.button")}
                  </Button>
                </div>
                {aiError && (
                  <p className="text-red-300" role="alert">
                    ⚠ {formatError(aiError)}
                  </p>
                )}
                {usage && (
                  <p className="text-[var(--muted)]">
                    {t("ai.usage", { input: usage.input_tokens, output: usage.output_tokens })}
                  </p>
                )}
              </div>
            )}
          </RadioCard>
        )}
      </RadioCardGroup>
      <div className="mt-3 flex flex-col gap-1">
        {!useAi && rule !== "beside" && (
          <Checkbox
            checked={options.mirrored}
            onChange={(mirrored) => change({ mirrored })}
            label={t("print.pairing.mirrored")}
            info={t("print.pairing.mirroredHint")}
          />
        )}
        {!useAi && (
          <Checkbox
            checked={options.upsideDown}
            onChange={(upsideDown) => change({ upsideDown })}
            label={t("print.pairing.upsideDown")}
            info={t("print.pairing.upsideDownHint")}
          />
        )}
      </div>
      {!useAi && common && (
        <div className="mt-1">
          <Checkbox
            checked={options.commonBack}
            onChange={(commonBack) => change({ commonBack })}
            label={t("print.pairing.commonBack")}
            info={t("print.pairing.commonBackHint")}
          />
        </div>
      )}
      <p className="mt-3" data-testid="pairing-summary">
        {pairing.commonBack
          ? t("print.pairing.common")
          : useAi && !fromAi
            ? t("print.pairing.ai.ask")
            : pairs === 0
              ? t("print.pairing.none")
              : `${t("print.pairing.pairs", { count: pairs })}${
                  pairing.unpaired.length > 0 ? ` ${t("print.pairing.left", { count: pairing.unpaired.length })}` : ""
                }`}
      </p>
      <p className="mt-1 text-[var(--muted)]">{t("print.pairing.note")}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button size="md" onClick={close}>
          {t("common.cancel")}
        </Button>
        <Button size="md" disabled={pairs === 0 && !pairing.commonBack} onClick={apply}>
          {t("common.apply")}
        </Button>
      </div>
    </dialog>
  );
}
