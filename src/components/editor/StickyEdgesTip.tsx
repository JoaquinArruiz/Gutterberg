import { useEffect, useState } from "react";
import { onHintEvent } from "../../lib/hint-events";
import { HintToast } from "../ui/HintToast";

/** The sticky edges help tip: from the first time a side actually sticks to an edge, it points at the button. */
export function StickyEdgesTip() {
  const [stuck, setStuck] = useState(false);
  useEffect(() => onHintEvent("edge-stuck", () => setStuck(true)), []);
  return stuck ? (
    <HintToast hint="sticky-edges" className="absolute left-1/2 top-3 z-30 w-[22rem] max-w-[90%] -translate-x-1/2" />
  ) : null;
}
