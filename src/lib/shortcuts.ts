// The keyboard shortcuts the app has, by area, for the shortcuts sheet (opened with `?`). Each shortcut lists its
// alternatives; each alternative is a chord of key names. `Mod` is Ctrl, or Command on a Mac. When a shortcut is
// added or changed in the code, change it here too: the sheet is what the user reads.

export type ShortcutArea = "general" | "source" | "print" | "fields";

export type ShortcutId =
  | "preferences"
  | "newProject"
  | "openPdf"
  | "openProject"
  | "save"
  | "saveAs"
  | "undo"
  | "redo"
  | "shortcuts"
  | "closeDialog"
  | "gridRegionTool"
  | "pieceTool"
  | "panTool"
  | "panHeld"
  | "zoomIn"
  | "zoomOut"
  | "fitPage"
  | "zoomCursor"
  | "nextPage"
  | "previousPage"
  | "deletePiece"
  | "putDownPiece"
  | "snapRotation"
  | "applyProposal"
  | "discardProposal"
  | "turnRight"
  | "turnLeft"
  | "selectMore"
  | "selectRange"
  | "cancelBack"
  | "commitNumber"
  | "revertNumber"
  | "nudgeNumber"
  | "nudgeFine"
  | "nudgeCoarse";

/** A chord: the keys pressed together. */
export type Chord = string[];
export type Shortcut = { id: ShortcutId; keys: Chord[] };

export const SHORTCUT_AREAS: ShortcutArea[] = ["general", "source", "print", "fields"];

export const SHORTCUTS: Record<ShortcutArea, Shortcut[]> = {
  general: [
    { id: "preferences", keys: [["Mod", ","]] },
    { id: "newProject", keys: [["Mod", "N"]] },
    { id: "openPdf", keys: [["Mod", "O"]] },
    { id: "openProject", keys: [["Mod", "Shift", "O"]] },
    { id: "save", keys: [["Mod", "S"]] },
    { id: "saveAs", keys: [["Mod", "Shift", "S"]] },
    { id: "undo", keys: [["Mod", "Z"]] },
    {
      id: "redo",
      keys: [
        ["Mod", "Shift", "Z"],
        ["Mod", "Y"],
      ],
    },
    { id: "shortcuts", keys: [["?"]] },
    { id: "closeDialog", keys: [["Esc"]] },
  ],
  source: [
    { id: "gridRegionTool", keys: [["V"]] },
    { id: "pieceTool", keys: [["C"]] },
    { id: "panTool", keys: [["H"]] },
    { id: "panHeld", keys: [["Space"]] },
    { id: "zoomIn", keys: [["+"]] },
    { id: "zoomOut", keys: [["-"]] },
    { id: "fitPage", keys: [["0"]] },
    { id: "zoomCursor", keys: [["Mod", "Wheel"]] },
    { id: "nextPage", keys: [["PageDown"], ["→"]] },
    { id: "previousPage", keys: [["PageUp"], ["←"]] },
    { id: "deletePiece", keys: [["Delete"], ["Backspace"]] },
    { id: "putDownPiece", keys: [["Esc"]] },
    { id: "snapRotation", keys: [["Shift"]] },
    { id: "applyProposal", keys: [["Enter"]] },
    { id: "discardProposal", keys: [["Esc"]] },
  ],
  print: [
    { id: "turnRight", keys: [["R"]] },
    { id: "turnLeft", keys: [["Shift", "R"]] },
    { id: "selectMore", keys: [["Mod", "Click"]] },
    { id: "selectRange", keys: [["Shift", "Click"]] },
    { id: "cancelBack", keys: [["Esc"]] },
  ],
  fields: [
    { id: "commitNumber", keys: [["Enter"]] },
    { id: "revertNumber", keys: [["Esc"]] },
    { id: "nudgeNumber", keys: [["↑"], ["↓"]] },
    {
      id: "nudgeFine",
      keys: [
        ["Alt", "↑"],
        ["Alt", "↓"],
      ],
    },
    {
      id: "nudgeCoarse",
      keys: [
        ["Shift", "↑"],
        ["Shift", "↓"],
      ],
    },
  ],
};

/** Whether this is a Mac, where the shortcuts use Command and Option. */
export const isMac = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The key names that are words of the user's language (the rest are shown as they are). */
export const WORD_KEYS = ["Space", "Wheel", "Click"] as const;
export type WordKey = (typeof WORD_KEYS)[number];
export const isWordKey = (key: string): key is WordKey => (WORD_KEYS as readonly string[]).includes(key);

/** How a key name is shown on this platform: `Mod` and `Alt` are symbols on a Mac. */
export function keyCap(key: string, mac = isMac()): string {
  if (key === "Mod") return mac ? "⌘" : "Ctrl";
  if (key === "Alt") return mac ? "⌥" : "Alt";
  return key;
}

/** Whether a key press is the `?` that opens the sheet: not while typing, not with Ctrl, Command or Alt. */
export function isShortcutsKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "target">): boolean {
  if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return false;
  const typing =
    e.target instanceof HTMLElement && (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable);
  return !typing;
}
