// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { InfoTip } from "./InfoTip";
import { RadioCard, RadioCardGroup } from "./RadioCard";
import { Segmented } from "./Segmented";
import { Switch } from "./Switch";

afterEach(cleanup);

describe("Switch and Checkbox", () => {
  it("are labelled buttons with the right role that toggle on click and on the label", () => {
    const onSwitch = vi.fn();
    const onBox = vi.fn();
    render(
      <>
        <Switch checked={false} onChange={onSwitch} label="Auto-fill" />
        <Checkbox checked onChange={onBox} label="Skip" />
      </>,
    );
    const sw = screen.getByRole("switch", { name: "Auto-fill" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(onSwitch).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText("Auto-fill")); // the label is a click target too
    expect(onSwitch).toHaveBeenCalledTimes(2);

    const box = screen.getByRole("checkbox", { name: "Skip" });
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    expect(onBox).toHaveBeenLastCalledWith(false);
  });

  it("do nothing when disabled, and a Checkbox without a label needs an aria-label", () => {
    const onChange = vi.fn();
    render(
      <>
        <Switch checked={false} onChange={onChange} label="Off" disabled />
        <Checkbox checked={false} onChange={onChange} aria-label="Include page 2" />
      </>,
    );
    fireEvent.click(screen.getByRole("switch", { name: "Off" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include page 2" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("show an InfoTip after the label, and a hint under it", () => {
    render(<Switch checked onChange={() => {}} label="Link" info="Keeps both gaps equal." hint="Always visible." />);
    expect(screen.getByText("Always visible.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "More information" })).toBeTruthy();
  });
});

describe("Segmented", () => {
  function Harness({ onChange }: { onChange?: (v: string) => void }) {
    const [v, setV] = useState("long");
    return (
      <Segmented
        label="Flip on"
        value={v}
        onChange={(n) => {
          setV(n);
          onChange?.(n);
        }}
        options={[
          { value: "long", label: "Long edge" },
          { value: "short", label: "Short edge" },
        ]}
      />
    );
  }

  it("is a radio group where only the chosen option is in the tab order", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Flip on" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Long edge" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Long edge" }).tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: "Short edge" }).tabIndex).toBe(-1);
  });

  it("moves and selects with the arrow keys, wrapping round", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const long = screen.getByRole("radio", { name: "Long edge" });
    long.focus();
    fireEvent.keyDown(long, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("short");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Short edge" }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("long");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("short");
  });
});

describe("RadioCard", () => {
  it("shows the title and description, selects on click, and keeps extra content outside the button", () => {
    const onChange = vi.fn();
    render(
      <RadioCardGroup label="Live preview" value="always" onChange={onChange}>
        <RadioCard value="always" title="Always on" description="Follows every change." />
        <RadioCard value="manual" title="Manual">
          <input aria-label="inside" />
        </RadioCard>
      </RadioCardGroup>,
    );
    expect(screen.getByText("Follows every change.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Always on/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Manual" }));
    expect(onChange).toHaveBeenCalledWith("manual");
    expect(screen.getByLabelText("inside").closest("button")).toBeNull();
  });
});

describe("Button", () => {
  it("defaults to type=button and puts the spark of an AI button in front of the text", () => {
    render(
      <>
        <Button>Plain</Button>
        <Button variant="ai">Detect with AI</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Plain" }).getAttribute("type")).toBe("button");
    const ai = screen.getByRole("button", { name: "Detect with AI" });
    expect(ai.firstElementChild?.getAttribute("data-ai")).toBe("spark");
  });

  it("gives an icon-only AI button a spark badge in the corner, and pulses it only while busy", () => {
    const { rerender } = render(
      <Button variant="ai" iconOnly aria-label="Sort">
        <span data-testid="icon" />
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Sort" });
    expect(button.lastElementChild?.querySelector("[data-ai=spark]")).toBeTruthy();
    expect(button.querySelector("[data-ai=spark]")?.getAttribute("class")).not.toContain("animate-pulse");
    rerender(
      <Button variant="ai" iconOnly busy aria-label="Sort">
        <span data-testid="icon" />
      </Button>,
    );
    expect(button.querySelector("[data-ai=spark]")?.getAttribute("class")).toContain("animate-pulse");
    expect(button.querySelector("[data-ai=spark]")?.getAttribute("class")).toContain("motion-reduce:animate-none");
  });
});

describe("InfoTip", () => {
  const trigger = () => screen.getByRole("button", { name: "More information" });

  it("is described by its text for screen readers without opening anything", () => {
    render(<InfoTip text="Repeat the pieces until the last sheet is full." />);
    const id = trigger().getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)?.textContent).toBe("Repeat the pieces until the last sheet is full.");
    expect(screen.queryByTestId("info-tip-bubble")).toBeNull();
  });

  it("opens on hover and closes when the pointer leaves", () => {
    render(<InfoTip text="Tip" />);
    fireEvent.pointerEnter(trigger());
    expect(screen.getByTestId("info-tip-bubble").textContent).toBe("Tip");
    fireEvent.pointerLeave(trigger());
    expect(screen.queryByTestId("info-tip-bubble")).toBeNull();
  });

  it("opens on keyboard focus and closes on blur", () => {
    render(<InfoTip text="Tip" />);
    fireEvent.focus(trigger());
    expect(screen.getByTestId("info-tip-bubble")).toBeTruthy();
    fireEvent.blur(trigger());
    expect(screen.queryByTestId("info-tip-bubble")).toBeNull();
  });

  it("stays open after a click until clicked again, and Esc closes it", () => {
    render(<InfoTip text="Tip" />);
    fireEvent.click(trigger());
    fireEvent.pointerLeave(trigger());
    expect(screen.getByTestId("info-tip-bubble")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("info-tip-bubble")).toBeNull();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByTestId("info-tip-bubble")).toBeNull();
  });

  it("does not let Esc reach a dialog around it", () => {
    render(<InfoTip text="Tip" />);
    fireEvent.click(trigger());
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
