// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "../../stores/preferences-store";
import { MeasurementInput } from "./MeasurementInput";
import { NumberField } from "./NumberField";

const prefs = () => usePreferencesStore.getState();

beforeEach(() => prefs().resetToDefaults());
afterEach(() => {
  cleanup();
  prefs().resetToDefaults();
});

/** Types into the field and leaves it, as a user does. */
function type(name: string, text: string) {
  const input = screen.getByRole("textbox", { name });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
  return input as HTMLInputElement;
}

describe("NumberField decimals", () => {
  it.each([
    ["dot", "63.5"],
    ["comma", "63,5"],
    ["auto", "63.5"],
    ["auto", "63,5"],
  ] as const)("accepts %s setting with %s typed", (decimal, typed) => {
    prefs().setDecimal(decimal);
    const onCommit = vi.fn();
    render(<NumberField label="Width" value={10} decimals={1} onCommit={onCommit} />);
    type("Width", typed);
    expect(onCommit).toHaveBeenCalledWith(63.5);
  });

  it("accepts both separators in either language", () => {
    for (const language of ["en", "es"] as const) {
      prefs().setLanguage(language);
      const onCommit = vi.fn();
      const { unmount } = render(<NumberField label="Width" value={10} decimals={1} onCommit={onCommit} />);
      type("Width", "1,5");
      type("Width", "2.5");
      expect(onCommit.mock.calls.map((c) => c[0])).toEqual([1.5, 2.5]);
      unmount();
    }
  });

  it("shows the number with the chosen separator, and redraws when it changes", () => {
    render(<NumberField label="Width" value={63.5} decimals={2} onCommit={() => {}} />);
    expect((screen.getByRole("textbox", { name: "Width" }) as HTMLInputElement).value).toBe("63.50");
    act(() => prefs().setDecimal("comma"));
    expect((screen.getByRole("textbox", { name: "Width" }) as HTMLInputElement).value).toBe("63,50");
    act(() => prefs().setLanguage("es"));
    act(() => prefs().setDecimal("dot"));
    expect((screen.getByRole("textbox", { name: "Width" }) as HTMLInputElement).value).toBe("63.50");
  });

  it("rejects a value with both separators or more than one, and puts the old number back", () => {
    const onCommit = vi.fn();
    render(<NumberField label="Width" value={10} decimals={1} onCommit={onCommit} />);
    for (const bad of ["1,234.5", "1.2.3", "1,,2", "abc"]) {
      const input = type("Width", bad);
      expect(input.value).toBe("10.0");
    }
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not rewrite an exact value when the shown, rounded text is left as it is", () => {
    prefs().setDecimal("comma");
    const onCommit = vi.fn();
    render(<NumberField label="Width" value={2.997} decimals={3} onCommit={onCommit} />);
    // Typing the number it already shows, with either separator, is not an edit.
    type("Width", "2,997");
    type("Width", "2.997");
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("MeasurementInput", () => {
  it("types a length with a comma in any unit and stores plain millimetres", () => {
    prefs().setUnit("cm");
    const onChange = vi.fn();
    render(<MeasurementInput label="Gap" value={3} onChange={onChange} />);
    type("Gap", "0,5");
    expect(onChange).toHaveBeenCalledWith(5);
  });
});
