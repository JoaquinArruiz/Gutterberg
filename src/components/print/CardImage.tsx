import { type OrientedRect, orientedBounds } from "../../lib/card";

/**
 * A card's picture, straightened and turned as it will print. `url` is the crop of the source's bounding
 * box (`useCardImage`), which for a tilted card also holds a bit of its neighbours: the picture is rotated
 * back by the source angle and cut to the card, then turned by `turn`. Fills its parent, whose shape must
 * be the card's final shape (the source size swapped for a quarter turn). Display only: the export keeps
 * the original vector content and does the same with a PDF matrix. `aspect` is the parent's width over its
 * height, needed when the card's width and height were scaled apart (otherwise it follows from the source).
 */
export function CardImage({
  url,
  source,
  turn,
  aspect,
}: {
  url: string;
  source: OrientedRect;
  turn: number;
  aspect?: number;
}) {
  const box = orientedBounds(source);
  const quarter = turn === 90 || turn === 270;
  // The unturned card, sized so that after the turn it fills the parent: a quarter turn swaps which of
  // the parent's sides each of its sides lies along, hence the ratios. The picture inside stretches to it.
  const parent = aspect ?? (quarter ? source.height / source.width : source.width / source.height);
  const card = quarter
    ? { width: `${(1 / parent) * 100}%`, height: `${parent * 100}%` }
    : { width: "100%", height: "100%" };
  return (
    <div
      className="absolute overflow-hidden"
      style={{ ...card, left: "50%", top: "50%", transform: `translate(-50%, -50%) rotate(${turn}deg)` }}
    >
      <img
        src={url}
        alt=""
        draggable={false}
        className="absolute"
        style={{
          maxWidth: "none",
          left: "50%",
          top: "50%",
          width: `${(box.width / source.width) * 100}%`,
          height: `${(box.height / source.height) * 100}%`,
          transform: `translate(-50%, -50%) rotate(${-source.angle_deg}deg)`,
        }}
      />
    </div>
  );
}
