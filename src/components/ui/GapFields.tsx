import { MAX_GAP_MM } from "../../stores/layout-store";
import { MeasurementInput } from "./MeasurementInput";

/** A horizontal gap, with a link switch that makes the vertical gap follow it. */
export function GapFields({
  linked,
  onLink,
  x,
  y,
  onX,
  onY,
}: {
  linked: boolean;
  onLink: (l: boolean) => void;
  x: number;
  y: number;
  onX: (v: number) => void;
  onY: (v: number) => void;
}) {
  const f = { min: 0, max: MAX_GAP_MM };
  return (
    <>
      <label className="flex items-center gap-2 text-[var(--muted)]">
        <input type="checkbox" checked={linked} onChange={(e) => onLink(e.target.checked)} />
        Link horizontal / vertical
      </label>
      <MeasurementInput label={linked ? "Gap" : "Horizontal"} value={x} onChange={onX} {...f} />
      {!linked && <MeasurementInput label="Vertical" value={y} onChange={onY} {...f} />}
    </>
  );
}
