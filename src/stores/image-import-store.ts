import { create } from "zustand";
import type { ImagePlacement, ImageProbe } from "../lib/images";

/** What the size dialog hands back: how each image is placed (in the order of the files). */
export type ImportChoice = { placements: ImagePlacement[] };

type PendingImport = { probes: ImageProbe[]; resolve: (choice: ImportChoice | null) => void };

type ImageImportState = {
  pending: PendingImport | null;
  /** Opens the size dialog for these images; resolves to the user's choice, or null when they cancel. */
  ask: (probes: ImageProbe[]) => Promise<ImportChoice | null>;
  /** The dialog was answered: closes it and settles the question. */
  answer: (choice: ImportChoice | null) => void;
};

export const useImageImportStore = create<ImageImportState>((set, get) => ({
  pending: null,
  ask: (probes) => {
    // A second question while one is open cancels the first.
    get().pending?.resolve(null);
    return new Promise((resolve) => set({ pending: { probes, resolve } }));
  },
  answer: (choice) => {
    get().pending?.resolve(choice);
    set({ pending: null });
  },
}));
