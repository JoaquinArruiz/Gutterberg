import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "../stores/document-store";
import { useLayoutStore } from "../stores/layout-store";
import { useProjectStore } from "../stores/project-store";
import { currentSignature } from "./project-state";
import { dropRecoveryCopy, keepRecoveryCopy } from "./recovery";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async (_command: string, _args?: unknown) => null) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const A4 = { width_pt: 595.2756, height_pt: 841.8898 };
const calls = () => invoke.mock.calls.map((c) => c[0] as string);

beforeEach(async () => {
  invoke.mockClear();
  await dropRecoveryCopy();
  invoke.mockClear();
  useDocumentStore.getState().setDocuments([{ id: 0, path: "/games/a.pdf", pages: [A4, A4], hash: "h" }], 0);
  useLayoutStore.getState().resetDocument(2);
  useLayoutStore.getState().setGapX(3);
  useProjectStore.getState().setSaved("/games/kit.gtr", currentSignature());
});

describe("the recovery copy", () => {
  it("is not written while everything is saved", async () => {
    await keepRecoveryCopy();
    expect(calls()).toEqual([]);
  });

  it("is written at every tick while there are unsaved changes, with where the project lives", async () => {
    useLayoutStore.getState().setGapX(4);
    await keepRecoveryCopy();
    await keepRecoveryCopy();
    expect(calls()).toEqual(["write_recovery", "write_recovery"]);
    const args = invoke.mock.calls[0][1] as { id: string; path: string; project: { output: { gapXMm: number } } };
    expect(args.path).toBe("/games/kit.gtr");
    expect(args.id).toMatch(/^run-[a-z0-9-]+$/);
    expect(args.project.output.gapXMm).toBe(4);
  });

  it("is removed once the changes are saved, and only once", async () => {
    useLayoutStore.getState().setGapX(4);
    await keepRecoveryCopy();
    useProjectStore.getState().setSaved("/games/kit.gtr", currentSignature());
    await keepRecoveryCopy();
    await keepRecoveryCopy();
    expect(calls()).toEqual(["write_recovery", "clear_recovery"]);
  });
});
