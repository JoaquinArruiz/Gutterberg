// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useHint } from "../stores/hint-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { useUiStore } from "../stores/ui-store";
import type { HintId } from "./hints";

beforeEach(() => {
  usePreferencesStore.getState().resetToDefaults();
  useUiStore.setState({ hintsHeld: false });
});
afterEach(cleanup);

/** A component that mounts hint `id`; unmounting it (cleanup) unregisters it again. */
function mounted(id: HintId) {
  return renderHook(() => {
    const hint = useHint(id);
    // biome-ignore lint/correctness/useExhaustiveDependencies: register is a fresh closure each render; only the id matters
    useEffect(hint.register, [id]);
    return hint;
  });
}

describe("whether help tips show (help.tipsOn)", () => {
  it("shows a mounted tip by default", () => {
    const { result } = mounted("freeform-tool");
    expect(result.current.visible).toBe(true);
  });

  it("hides every tip with the switch off, and brings them back with it on, none of them closed", () => {
    const { result } = mounted("print-stage-intro");
    act(() => usePreferencesStore.getState().setTipsOn(false));
    expect(result.current.visible).toBe(false);
    expect(usePreferencesStore.getState().prefs.help.dismissedHints).toEqual({});
    act(() => usePreferencesStore.getState().setTipsOn(true));
    expect(result.current.visible).toBe(true);
  });

  it("starts over with the defaults when preferences are reset", () => {
    usePreferencesStore.getState().setTipsOn(false);
    usePreferencesStore.getState().resetToDefaults();
    expect(usePreferencesStore.getState().prefs.help.tipsOn).toBe(true);
  });
});
