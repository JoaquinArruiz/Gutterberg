// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../stores/ui-store";

const { invoke, listen, openProjectDialog } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  openProjectDialog: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("./project-actions", () => ({ openProjectDialog }));

import { useOpenedFiles } from "./use-opened-files";

const flush = () => act(async () => {});

let onOpened: (e: { payload: string }) => void;
const off = vi.fn();

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(null);
  openProjectDialog.mockReset().mockResolvedValue(undefined);
  off.mockReset();
  listen.mockReset().mockImplementation(async (_name: string, handler: typeof onOpened) => {
    onOpened = handler;
    return off;
  });
  useUiStore.setState({ welcomeDeferred: false });
});
afterEach(cleanup);

describe("opening the project the app was started with", () => {
  it("opens it, and holds the welcome tour back until the question is answered", async () => {
    invoke.mockResolvedValue("/home/me/Game.gtr");
    renderHook(() => useOpenedFiles());
    expect(useUiStore.getState().welcomeDeferred).toBe(true);
    await flush();
    expect(invoke).toHaveBeenCalledWith("take_opened_file");
    expect(openProjectDialog).toHaveBeenCalledWith("/home/me/Game.gtr");
    expect(useUiStore.getState().welcomeDeferred).toBe(false);
  });

  it("releases the welcome tour when the app started with no file", async () => {
    renderHook(() => useOpenedFiles());
    await flush();
    expect(openProjectDialog).not.toHaveBeenCalled();
    expect(useUiStore.getState().welcomeDeferred).toBe(false);
  });

  it("opens files the system sends later, and stops listening when unmounted", async () => {
    const { unmount } = renderHook(() => useOpenedFiles());
    await flush();
    onOpened({ payload: "/tmp/Other.gtr" });
    expect(openProjectDialog).toHaveBeenCalledWith("/tmp/Other.gtr");
    unmount();
    expect(off).toHaveBeenCalled();
  });

  it("does not fail outside the app window", async () => {
    invoke.mockRejectedValue(new Error("no tauri"));
    renderHook(() => useOpenedFiles());
    await flush();
    expect(useUiStore.getState().welcomeDeferred).toBe(false);
  });
});
