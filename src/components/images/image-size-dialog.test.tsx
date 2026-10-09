// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImagePlacement, ImageProbe } from "../../lib/images";
import { DEFAULT_IMAGE_SIZE } from "../../lib/preferences";
import { useImageImportStore } from "../../stores/image-import-store";
import { usePreferencesStore } from "../../stores/preferences-store";
import { ImageSizeDialog } from "./ImageSizeDialog";

// The engine's plan, in a simple stand-in: the dialog shows what the engine says, so that is what is tested.
const plan = vi.hoisted(() => ({ differ: new Set<string>(), large: new Set<string>() }));
vi.mock("../../lib/images", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/images")>()),
  planImages: vi.fn(async (requests: { probe: ImageProbe; placement: ImagePlacement }[]) =>
    requests.map(({ probe, placement }) => {
      const dpi = plan.large.has(probe.path) ? 1500 : probe.widthPx / (placement.widthMm / 25.4);
      return {
        pageWidthMm: placement.widthMm + 2 * placement.bleedMm,
        pageHeightMm: placement.heightMm + 2 * placement.bleedMm,
        piece: { x: 0, y: 0, width: 1, height: 1 },
        proportionsDiffer: plan.differ.has(probe.path),
        dpi,
        quality: dpi < 150 ? "blurry" : dpi < 300 ? "soft" : "good",
        veryLarge: dpi > 1200,
        reducedToDpi: placement.reduceLarge && dpi > 600 ? 600 : null,
        storedBytes: plan.large.has(probe.path) ? 28 * 1_048_576 : 2_000_000,
      };
    }),
  ),
}));

const probe = (name: string, over: Partial<ImageProbe> = {}): ImageProbe => ({
  path: `/art/${name}`,
  name,
  format: "png",
  widthPx: 744,
  heightPx: 1039,
  dpi: 300,
  nativeWidthMm: 63,
  nativeHeightMm: 88,
  bytes: 1000,
  hash: "0".repeat(64),
  storedBytes: 1000,
  ...over,
});

let answered: { placements: ImagePlacement[] } | null | undefined;

async function open(probes: ImageProbe[]) {
  answered = undefined;
  render(<ImageSizeDialog />);
  // The store's answer is what the import waits for.
  void useImageImportStore
    .getState()
    .ask(probes)
    .then((c) => {
      answered = c;
    });
  await act(async () => {});
  await act(async () => {});
}

const add = () => screen.getByRole("button", { name: /^Add images?$/ });
const typeNumber = (input: HTMLElement, text: string) => {
  act(() => input.focus());
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
};
async function choose(name: string, option: RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name }));
  fireEvent.click(screen.getByRole("option", { name: option }));
  await act(async () => {});
}
async function confirmDialog() {
  await act(async () => {
    fireEvent.click(add());
  });
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
  Element.prototype.scrollIntoView = vi.fn();
  plan.differ.clear();
  plan.large.clear();
  usePreferencesStore.getState().resetToDefaults();
  usePreferencesStore.getState().setImageSize(DEFAULT_IMAGE_SIZE); // the last size is kept by a reset
  useImageImportStore.setState({ pending: null });
});
afterEach(cleanup);

describe("the size dialog", () => {
  it("starts at the standard card size and hands back one placement per image", async () => {
    await open([probe("a.png"), probe("b.png")]);
    expect(screen.getByRole("heading", { name: "Add 2 images" })).toBeTruthy();
    expect(screen.getByTestId("image-piece-size").textContent).toBe("Pieces print at 63 × 88 mm.");
    await confirmDialog();
    expect(answered?.placements).toEqual([
      { widthMm: 63, heightMm: 88, bleedMm: 0, fit: "fit", reduceLarge: false },
      { widthMm: 63, heightMm: 88, bleedMm: 0, fit: "fit", reduceLarge: false },
    ]);
  });

  it("offers the presets by name", async () => {
    await open([probe("a.png")]);
    await choose("Piece size", /^Tarot/);
    expect(screen.getByTestId("image-piece-size").textContent).toBe("Pieces print at 70 × 120 mm.");
    await choose("Piece size", /^Small card/);
    expect(screen.getByTestId("image-piece-size").textContent).toBe("Pieces print at 59 × 86 mm.");
    await confirmDialog();
    expect(answered?.placements[0]).toMatchObject({ widthMm: 59, heightMm: 86 });
  });

  it("takes the size the image says it is only when every file has a resolution", async () => {
    await open([probe("a.png", { nativeWidthMm: 50.8, nativeHeightMm: 70.9 })]);
    await choose("Piece size", /^From the image/);
    expect(screen.getByTestId("image-piece-size").textContent).toBe("Pieces print at 50.8 × 70.9 mm.");
    cleanup();
    useImageImportStore.setState({ pending: null });

    await open([probe("a.png"), probe("b.png", { dpi: null, nativeWidthMm: null, nativeHeightMm: null })]);
    fireEvent.click(screen.getByRole("combobox", { name: "Piece size" }));
    const option = screen.getByRole("option", { name: /^From the image/ });
    expect(option.getAttribute("aria-disabled")).toBe("true");
  });

  it("sets a custom size, and keeps the image's proportions when locked", async () => {
    await open([probe("a.png", { widthPx: 700, heightPx: 1000 })]);
    await choose("Piece size", /^Custom/);
    fireEvent.click(screen.getByRole("checkbox", { name: "Keep the image's proportions" }));
    typeNumber(screen.getByRole("textbox", { name: "Width" }), "50");
    expect((screen.getByRole("textbox", { name: "Height" }) as HTMLInputElement).value).toBe("71.40");
    // Unlocked, the other side stays.
    fireEvent.click(screen.getByRole("checkbox", { name: "Keep the image's proportions" }));
    typeNumber(screen.getByRole("textbox", { name: "Width" }), "60");
    expect((screen.getByRole("textbox", { name: "Height" }) as HTMLInputElement).value).toBe("71.40");
    await confirmDialog();
    expect(answered?.placements[0]).toMatchObject({ widthMm: 60, heightMm: 71.4 });
  });

  it("puts the bleed around the piece, 3 mm to start with", async () => {
    await open([probe("a.png")]);
    fireEvent.click(screen.getByRole("switch", { name: /The images include bleed/ }));
    expect((screen.getByRole("textbox", { name: "Bleed" }) as HTMLInputElement).value).toBe("3.00");
    await confirmDialog();
    expect(answered?.placements[0]).toMatchObject({ widthMm: 63, heightMm: 88, bleedMm: 3 });
  });

  it("takes the bleed out of the size the image says it is", async () => {
    await open([probe("a.png", { nativeWidthMm: 69, nativeHeightMm: 94 })]);
    await choose("Piece size", /^From the image/);
    fireEvent.click(screen.getByRole("switch", { name: /The images include bleed/ }));
    expect(screen.getByTestId("image-piece-size").textContent).toBe("Pieces print at 63 × 88 mm.");
  });

  it("lists images whose proportions do not match and lets each be fitted or filled", async () => {
    plan.differ.add("/art/wide.png");
    await open([probe("a.png"), probe("wide.png")]);
    const list = screen.getByRole("region", { name: "Proportions don't match" });
    expect(within(list).getByText("wide.png")).toBeTruthy();
    expect(within(list).queryByText("a.png")).toBeNull();
    expect(list.textContent).toContain("never stretched");
    fireEvent.click(within(list).getByRole("radio", { name: "Fill" }));
    await confirmDialog();
    expect(answered?.placements.map((p) => p.fit)).toEqual(["fit", "fill"]);
  });

  it("says nothing about proportions when every image matches", async () => {
    await open([probe("a.png")]);
    expect(screen.queryByRole("region", { name: "Proportions don't match" })).toBeNull();
  });

  it("notes images that print soft and warns about ones that will look blurry, without blocking", async () => {
    // 744 px over 63 mm is 300 dpi; over 90 mm 210 dpi (soft); 400 px over 63 mm is 161 dpi... 300 px is blurry.
    await open([
      probe("good.png", { widthPx: 800 }),
      probe("soft.png", { widthPx: 500 }),
      probe("blur.png", { widthPx: 300 }),
    ]);
    const list = screen.getByRole("region", { name: "Resolution" });
    expect(within(list).queryByText("good.png")).toBeNull();
    expect(list.textContent).toContain("soft.png");
    expect(list.textContent).toContain("may print a little soft");
    expect(list.textContent).toContain("blur.png");
    expect(list.textContent).toContain("will look blurry");
    expect(add().hasAttribute("disabled")).toBe(false);
  });

  it("shows what the images add to the export, and offers to reduce only the very large ones", async () => {
    await open([probe("a.png")]);
    expect(screen.getByTestId("image-export-size").textContent).toBe("Adds about 1.9 MB to the exported PDF.");
    expect(screen.queryByRole("switch", { name: /Reduce very large images/ })).toBeNull();
    cleanup();
    useImageImportStore.setState({ pending: null });

    plan.large.add("/art/huge.png");
    await open([probe("huge.png", { widthPx: 4000, heightPx: 5600 })]);
    expect(screen.getByTestId("image-export-size").textContent).toBe("Adds about 28 MB to the exported PDF.");
    const region = screen.getByRole("region", { name: "Size in the export" });
    expect(region.textContent).toContain("much sharper than any printer needs");
    const reduce = screen.getByRole("switch", { name: /Reduce very large images to 600 dpi/ });
    expect(reduce.getAttribute("aria-checked")).toBe("false"); // off unless asked
    expect(region.textContent).toContain("JPEG images are never reduced");
    await confirmDialog();
    expect(answered?.placements[0].reduceLarge).toBe(false);
  });

  it("reduces very large images when asked", async () => {
    plan.large.add("/art/huge.png");
    await open([probe("huge.png")]);
    fireEvent.click(screen.getByRole("switch", { name: /Reduce very large images/ }));
    await confirmDialog();
    expect(answered?.placements[0].reduceLarge).toBe(true);
  });

  it("remembers the last size for the next import", async () => {
    await open([probe("a.png")]);
    await choose("Piece size", /^Tarot/);
    fireEvent.click(screen.getByRole("switch", { name: /The images include bleed/ }));
    await confirmDialog();
    expect(usePreferencesStore.getState().prefs.images.size).toMatchObject({
      preset: "tarot",
      bleed: true,
      bleedMm: 3,
    });
    cleanup();
    useImageImportStore.setState({ pending: null });
    await open([probe("b.png")]);
    expect(screen.getByTestId("image-piece-size").textContent).toBe("Pieces print at 70 × 120 mm.");
    expect(screen.getByRole("switch", { name: /The images include bleed/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("hands back nothing when cancelled", async () => {
    await open([probe("a.png")]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(answered).toBeNull();
  });
});
