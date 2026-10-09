import type { KeyboardEvent } from "react";

/**
 * Arrow-key movement for a `role="radiogroup"` made of `role="radio"` buttons: the arrows (and Home/End) move
 * the focus to the next enabled radio and select it, as native radios do. Attach to the group element.
 */
export function radioGroupKeys(e: KeyboardEvent<HTMLElement>) {
  const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  const here = radios.indexOf(document.activeElement as HTMLButtonElement);
  if (here < 0 || radios.length === 0) return;
  let next: number;
  if (e.key in keys) next = (here + keys[e.key] + radios.length) % radios.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = radios.length - 1;
  else return;
  e.preventDefault();
  radios[next].focus();
  radios[next].click();
}
