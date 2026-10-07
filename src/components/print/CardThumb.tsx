import { cardIdKey, orientedBounds } from "../../lib/card";
import type { Card } from "../../lib/sheet-api";
import { useCardImage } from "../../lib/use-card-image";
import { useDocumentStore } from "../../stores/document-store";

/** A card in the library: its crop of the source page, a page/position label and its copies. */
export function CardThumb({
  card,
  width,
  height,
  selected,
  copies,
  onClick,
}: {
  card: Card;
  width: number;
  height: number;
  selected: boolean;
  /** Copies in a custom plan; null in "all cards", where every card prints once. */
  copies: number | null;
  onClick: (e: React.MouseEvent) => void;
}) {
  const path = useDocumentStore((s) => s.path);
  const page = useDocumentStore((s) => s.pages[card.id.page_index]);
  const dpr = window.devicePixelRatio || 1;
  const url = useCardImage(path, card.id, card.source, page, width * dpr, "thumbnail");
  const box = orientedBounds(card.source);
  const label =
    card.id.kind === "grid"
      ? `p${card.id.page_index + 1} · r${card.id.row + 1} c${card.id.column + 1}`
      : `p${card.id.page_index + 1} · #${card.id.index + 1}`;
  const printed = copies === null || copies > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-card={cardIdKey(card.id)}
      title={`Page ${card.id.page_index + 1}, ${label.split("· ")[1]}`}
      style={{ width, height }}
      className={`relative flex flex-col items-center gap-0.5 rounded p-1 text-[10px] ${selected ? "bg-[var(--accent)]/25 outline outline-1 outline-[var(--accent)]" : "hover:bg-[var(--hover)]"} ${printed ? "" : "opacity-45"}`}
    >
      <span className="flex min-h-0 w-full flex-1 items-center justify-center bg-white/5">
        {url && (
          <img
            src={url}
            alt=""
            draggable={false}
            className="max-h-full max-w-full object-contain"
            style={{ aspectRatio: `${box.width} / ${box.height}` }}
          />
        )}
      </span>
      <span className="w-full truncate text-center text-[var(--muted)]">{label}</span>
      {copies !== null && copies > 0 && (
        <span className="absolute right-1 top-1 rounded bg-[var(--accent)] px-1 font-semibold text-black">
          ×{copies}
        </span>
      )}
    </button>
  );
}
