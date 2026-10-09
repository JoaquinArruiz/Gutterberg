import { useTranslation } from "react-i18next";
import { MAX_GAP_MM } from "../../stores/layout-store";
import { MeasurementInput } from "./MeasurementInput";
import { Switch } from "./Switch";

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
  const { t } = useTranslation();
  const f = { min: 0, max: MAX_GAP_MM };
  return (
    <>
      <Switch checked={linked} onChange={onLink} label={t("gapFields.link")} />
      <MeasurementInput
        label={linked ? t("gapFields.gap") : t("gapFields.horizontal")}
        value={x}
        onChange={onX}
        {...f}
      />
      {!linked && <MeasurementInput label={t("gapFields.vertical")} value={y} onChange={onY} {...f} />}
    </>
  );
}
