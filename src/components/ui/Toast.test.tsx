// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "../../stores/toast-store";
import { Toast } from "./Toast";

const show = (title: string, extra = {}) => act(() => useToastStore.getState().show({ title, ...extra }));

beforeEach(() => useToastStore.setState({ queue: [] }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("is announced to screen readers and shows one toast at a time, the next after it closes", () => {
    render(<Toast />);
    expect(screen.queryByRole("status")).toBeNull();
    show("First");
    show("Second");
    expect(screen.getByRole("status").textContent).toContain("First");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("status").textContent).toContain("Second");
  });

  it("closes with Esc, but leaves Esc to an open dialog", () => {
    render(<Toast />);
    show("Hello");
    const dialog = document.body.appendChild(document.createElement("dialog"));
    dialog.setAttribute("open", "");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("status")).not.toBeNull();
    dialog.remove();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("runs an action and closes, unless the action keeps it open", () => {
    const go = vi.fn();
    const stay = vi.fn();
    render(<Toast />);
    show("Hello", {
      actions: [
        { label: "Stay", onClick: stay, keep: true },
        { label: "Go", onClick: go },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(stay).toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(go).toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("can close by itself", () => {
    vi.useFakeTimers();
    render(<Toast />);
    show("Hello", { autoCloseMs: 1000 });
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
