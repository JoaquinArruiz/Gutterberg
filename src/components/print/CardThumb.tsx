import { cardIdKey, cropWidthPx } from "../../lib/card";
import { finalSizePt, formatCardSize } from "../../lib/card-edits";
import type { Card } from "../../lib/sheet-api";
import { useCardImage } from "../../lib/use-card-image";
import { useDocumentStore } from "../../stores/document-store";
import { useUnit } from "../../stores/preferences-store";
import { CardImage } from "./CardImage";

/** Padding, gap and label below the picture: what the cell keeps for itself. */
const CHROME_X = 8;
const CHROME_Y = 25;

/**
 * A card in the library: its picture as it will print (straightened, turned and sized as set), a
 * page/position label, its copies, and a badge when it is printed at another size than on the page.
 */
export function CardThumb({
  card,
  width,
  height,
  selected,
  copies,
  dropMark,
  dragging,
  onClick,
  onPointerDown,
}: {
  card: Card;
  width: number;
  height: number;
  selected: boolean;
  /** Copies in a custom plan; null in "all cards", where every card prints once. */
  copies: number | null;
  /** While another card is dragged over this one: the drop goes before or after it. */
  dropMark?: "before" | "after" | null;
  /** This card is being dragged to a new place. */
  dragging?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const path = useDocumentStore((s) => s.path);
  const page = useDocumentStore((s) => s.pages[card.id.page_index]);
  const unit = useUnit();
  const dpr = window.devicePixelRatio || 1;
  // The picture's box has the card's final shape, as large as the cell allows.
  const final = finalSizePt(card);
  const fit = Math.min(Math.max(width - CHROME_X, 8) / final.width, Math.max(height - CHROME_Y, 8) / final.height);
  const [boxW, boxH] = [final.width * fit, final.height * fit];
  const url = useCardImage(
    path,
    card.id,
    card.source,
    page,
    cropWidthPx(card.source, card.turn, boxW, boxH) * dpr,
    "thumbnail",
  );
  const label =
    card.id.kind === "grid"
      ? `p${card.id.page_index + 1} · r${card.id.row + 1} c${card.id.column + 1}`
      : `p${card.id.page_index + 1} · #${card.id.index + 1}`;
  const printed = copies === null || copies > 0;
  const scaled = Math.abs(card.scale - 1) > 1e-6;
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      aria-pressed={selected}
      data-card={cardIdKey(card.id)}
      data-turn={card.turn}
      data-scale={card.scale}
      title={`Page ${card.id.page_index + 1}, ${label.split("· ")[1]} · ${formatCardSize(card, unit)}${card.turn ? ` · turned ${card.turn}°` : ""}`}
      style={{ width, height }}
      className={`relative flex select-none flex-col items-center gap-0.5 rounded p-1 text-[10px] ${selected ? "bg-[var(--accent)]/25 outline outline-1 outline-[var(--accent)]" : "hover:bg-[var(--hover)]"} ${printed ? "" : "opacity-45"} ${dragging ? "opacity-40" : ""}`}
    >
      <span className="flex min-h-0 w-full flex-1 items-center justify-center bg-white/5">
        <span className="relative" style={{ width: boxW, height: boxH }}>
          {url && <CardImage url={url} source={card.source} turn={card.turn} />}
        </span>
      </span>
      <span className="w-full truncate text-center text-[var(--muted)]">{label}</span>
      {copies !== null && copies > 0 && (
        <span className="absolute right-1 top-1 rounded bg-[var(--accent)] px-1 font-semibold text-black">
          ×{copies}
        </span>
      )}
      {scaled && (
        <span
          className="absolute left-1 top-1 rounded bg-amber-400 px-1 font-semibold text-black"
          data-testid="scale-badge"
        >
          {Math.round(card.scale * 100)}%
        </span>
      )}
      {dropMark && (
        <span
          aria-hidden
          data-testid="drop-mark"
          className={`absolute inset-y-0 w-0.5 bg-[var(--accent)] ${dropMark === "before" ? "-left-1" : "-right-1"}`}
        />
      )}
    </button>
  );
}
