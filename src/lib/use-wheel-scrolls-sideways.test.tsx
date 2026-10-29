// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useWheelScrollsSideways } from "./use-wheel-scrolls-sideways";

function Strip({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useWheelScrollsSideways(ref, enabled);
  return <div ref={ref} data-testid="strip" />;
}

/** The strip, `content` px wide in a box `box` px wide. */
const strip = (content: number, box = 300) => {
  const el = document.querySelector<HTMLElement>("[data-testid=strip]") as HTMLElement;
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: content });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: box });
  return el;
};
const wheel = (el: HTMLElement, init: WheelEventInit) => {
  const e = new WheelEvent("wheel", { cancelable: true, bubbles: true, ...init });
  el.dispatchEvent(e);
  return e;
};

afterEach(cleanup);

describe("the wheel over a horizontal strip", () => {
  it("scrolls it sideways and keeps the page from scrolling too", () => {
    render(<Strip />);
    const el = strip(1000);
    const e = wheel(el, { deltaY: 120 });
    expect(el.scrollLeft).toBe(120);
    expect(e.defaultPrevented).toBe(true);
    wheel(el, { deltaY: -50 });
    expect(el.scrollLeft).toBe(70);
  });

  it("counts lines for wheels that step in lines, and stops at the ends, where the wheel goes on", () => {
    render(<Strip />);
    const el = strip(1000);
    wheel(el, { deltaY: 3, deltaMode: 1 });
    expect(el.scrollLeft).toBe(48);
    wheel(el, { deltaY: 5000 });
    expect(el.scrollLeft).toBe(700);
    expect(wheel(el, { deltaY: 10 }).defaultPrevented).toBe(false);
  });

  it("leaves alone a strip that shows everything, a sideways swipe, Ctrl+wheel, and a vertical list", () => {
    render(<Strip />);
    const el = strip(200);
    expect(wheel(el, { deltaY: 100 }).defaultPrevented).toBe(false);
    strip(1000);
    expect(wheel(el, { deltaY: 10, deltaX: 40 }).defaultPrevented).toBe(false);
    expect(wheel(el, { deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(el.scrollLeft).toBe(0);
    cleanup();
    render(<Strip enabled={false} />);
    expect(wheel(strip(1000), { deltaY: 100 }).defaultPrevented).toBe(false);
  });
});
