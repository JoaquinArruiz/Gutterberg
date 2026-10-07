# PDF Card Editor

Desktop tool (Tauri + Rust + React/TS) that takes a Print-and-Play PDF whose pieces
(cards, tokens, tiles) are packed edge to edge and re-exports it with a configurable gap
between them, keeping the original piece size and the original vector content. The app
speaks English and Spanish (Preferences › General › Language).

## Status

- [x] **Milestone 1 – PDF spike** (`crates/card-core`)
- [x] **Milestone 2 – Tauri viewer** (open PDF, pdfium previews, thumbnails, page navigation)
- [x] **Milestone 3 – Selection / zoom / pan** (draw, move, resize; normalized coordinates)
- [x] **Milestone 4 – Grid** (rows, columns, grid overlay, exact piece size in mm)
- [x] **Milestone 5 – Spacing preview** (gap in mm, Original/Preview toggle driven by `compute_layout`)
- [x] **Milestone 6 – Export wiring** (Export PDF button calls `export_document`)
- [x] **Milestone 7 – Source spacing, output page and live preview** (source vs output gaps, margins, page size/orientation/auto-fit, overflow blocks export, Original/Preview/Split views, optional live preview)
- [x] **Milestone 8 – Foundations** (CI workflow, pinned and verified pdfium download, CSP, state locking)
- [x] **Milestone 9 – Render pipeline** (dedicated pdfium thread, open-document cache, stale-request skipping)
- [x] **Milestone 10 – Export correctness** (page boxes, rotated pages, catalog cleanup, atomic save)
- [x] **Milestone 11 – Document model** (page groups: skip pages and give page ranges their own grid, pre-flight check before export, undo/redo, `CardId` / `OrientedRect`)
- [x] **Milestone 12 – Sheet engine** (`extract_cards`, `paginate` with quantities, order, size groups, turn and scale, `export_sheets` from several PDFs, `compute_sheets`; Rust only)
- [x] **Milestone 13 – Print stage** (Source | Print switch, piece library with copies per piece, plan and auto-fill, sheet preview, collapsible inspector, export from the sheets)
- [x] **Milestone 14 – Project files, several PDFs and presets** (`.gtr` project files that save everything but the PDFs, checked in Rust on open as not a project / older, migrated / newer, refused; a File menu with New, Open PDF, Open project, Add PDF, Save, Save as and recent projects; moved or changed PDFs are found by hash; several PDFs in one project, with a switcher in the Source tab and pieces of all of them in the piece library and on the same sheets; named grid presets)
- [x] **Milestone 18 – Freeform pieces** (piece tool: one rectangle per piece, movable, resizable and rotatable; straightened on export; turn, sort by dragging and real size per piece in the Print tab; a page can have a grid and freeform pieces)
- [x] **Milestone 20 – Hint system** (catalog of help tips in `src/lib/hints.ts`, `<HintToast hint=… />`, stepped hints, anchored tours with React Joyride; first-PDF and Print-stage tours. The single tips for the magnifier, pan/zoom, source vs output gap and page groups are still to add)
- [x] **Milestone 21 – Terminology and languages** (tabs Source / Print, views Original / Preview / Split, "pieces" throughout; every text in `src/locales/en.json` and `es.json` with i18next, language chosen in Preferences; Rust errors reach the UI as codes; decimal separator preference with dot or comma accepted in every number field)

## Architecture

`crates/card-core` has no UI/Tauri dependency; the Tauri app will wrap it.

- `layout::calculate_layout` – single source of truth for geometry. Produces
  `CardPlacement { source, destination }` (points, top-left origin). Preview and
  export both consume it. Cards are never scaled; a gap that doesn't fit the
  output page is an error.
- `card` – `CardId` (grid or freeform card, always with its `document_id`), `OrientedRect`
  (a card's source area, rotated about its centre) and the page-group types. Grid cards
  have `angle_deg = 0`; freeform cards are reserved for a later milestone.
- `sheet` – the engine behind every export: `extract_cards` turns page groups into `Card`s,
  `paginate` puts `(Card, quantity)` pairs on `OutputSheet`s (grouped or interleaved order, one
  group of sheets per card size or one shared grid, per-card `turn` and explicit `scale`), and
  `card_transform` is the single piece of matrix maths for placing a card. A card that does
  not fit is an error, never shrunk. `plan_print` is what the Print stage runs: either
  `SameAsSource` (each source page on its own sheet, exactly what the Source tab exports) or
  `plan_sheets` with a sheet grid, per-card copies and `auto_fill`.
- `export` – wraps each source page unmodified as a Form XObject and paints each
  card with `q 1 0 0 1 dx dy cm <rect> re W n /Src Do Q` (translate + clip, no
  rasterisation). `ExportJob` holds a grid per page, so each section of a
  document can have its own grid and skipped pages are simply not listed.
  `validate_export` runs the same per-page checks without writing anything. `export_sheets` builds
  a PDF from any list of sheets and several source documents (one form per source page,
  named `/S{document}_{page}`); `export_document` is a thin wrapper that turns each job's
  `calculate_layout` result into a sheet. Rotated pages and CropBox offsets are handled. Export rebuilds the
  document, so it removes encryption and permissions, outlines and form fields.
- `project` – the `.gtr` envelope: `parse_project` checks that a file is a `gutterberg-project` and
  upgrades older versions step by step (`ProjectTooNew` for a newer one, `NotAProject` for anything
  else), `save_project` writes `format` and `version` first through a temporary file, and `file_hash`
  (SHA-256) is how a project recognises its PDFs. The content between is the UI's own model.
- `units` – mm <-> PDF points (`pt = mm * 72 / 25.4`).
- `sample` – synthetic 3x3 A4 PnP page (63.5 x 88 mm cards) for tests/spike.

### Try the spike

```sh
cargo test
cargo run --example spike -- sample in.pdf
cargo run --example spike -- export in.pdf out.pdf 0.0464 0.0556 0.9071 0.8889 3 3 3   # x y w h rows cols gap_mm
```

### Known limitations (spike)

- Pages with `/Rotate` != 0 are rejected.
- Output page size = source page size, one output page per listed source page.
- Verified with poppler only (0 raster images, text stays text); not yet with
  real-world PnP PDFs or pdfium.

## Running the app

Needs Node 20+, pnpm, Rust, the Tauri Linux deps (webkit2gtk-4.1, gtk3) and a pdfium shared library:

```sh
pnpm install
scripts/fetch-pdfium.sh            # or copy libpdfium into src-tauri/resources/pdfium/
pnpm tauri dev
```

`cargo test` runs the pdfium render test only if the library is found
(`PDFIUM_LIB_PATH=<dir>`); otherwise it is skipped.

## Editor controls

| Action | Input |
| --- | --- |
| Grid region / Piece / Pan tool | `V` / `C` / `H` (or hold `Space` to pan temporarily, or middle-mouse drag) |
| Draw selection | drag on the page; drag the body to move, the handles to resize; click empty page to clear |
| Draw freeform pieces (Piece tool) | drag on the page for each piece; drag a piece to move it, its handles to resize, the dot above it to rotate (`Shift` snaps to 15°); `Delete` removes the picked piece; the Freeform pieces section in the Source sidebar has its angle and size |
| Zoom | `+` / `-`, toolbar, or `Ctrl/Cmd` + wheel / trackpad pinch (zooms at the cursor) |
| Fit page | `0` |
| Pan | wheel / trackpad scroll |
| Pages | `PageUp`/`PageDown` or arrow keys |
| Source \| Print | tabs in the toolbar. Print: piece library (click, Ctrl/Cmd-click, Shift-click; Copies field and steppers), sheet preview (the sheet in front is always live) with a hideable row of sheet thumbnails (follows Live Preview, with a refresh button when it is off), and an inspector with Plan, Sheet and Page sections that fold (and remember it) |
| Turn, size and sort pieces (Print tab) | piece library: `R` / `Shift+R` turn the selection 90° right / left, "Make all portrait / landscape"; drag pieces to reorder them (the sheets follow); the Selected pieces section of the inspector sets a real size (e.g. 63 × 88 mm) or a percentage, and scaled pieces carry a badge |
| Projects | File menu: New project (`Ctrl/Cmd+N`), Open PDF (`Ctrl/Cmd+O`), Open project (`Ctrl/Cmd+Shift+O`), Add PDF, Save (`Ctrl/Cmd+S`), Save as (`Ctrl/Cmd+Shift+S`) and the recent projects. A project is a `.gtr` file with the page groups, freeform pieces, turns, sizes, order, print plan and output settings of every PDF; it points at the PDFs instead of holding them, and asks where a PDF went if it moved |
| Several PDFs | "Add PDF…" in the page panel adds a PDF to the project; the dropdown above the pages switches the PDF being edited. The piece library shows the pieces of all of them (filter by PDF or group), and the Print tab puts them on the same sheets. The Source tab's export is for the PDF being edited |
| Grid presets | Presets section of the Source sidebar: save the viewed group's rows, columns and source gap under a name, apply it to any other page group. Presets belong to you, not to a project |
| Skip a page / include it | checkbox on its thumbnail (skipped pages are left out of the export) |
| Different grid for some pages | draw the grid on a page, then "Apply this grid to…" (this page, a range, all pages of the same size); edits then apply to the group the viewed page belongs to |
| Undo / redo | `Ctrl/Cmd+Z` / `Shift+Ctrl/Cmd+Z` (also `Ctrl+Y`), or the toolbar buttons; a whole drag is one step |
| Exact values | Source layout section: columns, rows, piece width/height and selection X/Y. Enter commits, Esc reverts, ↑/↓ nudge. Type `63.5` or `63,5`: both work whatever the decimal separator preference says |
| Language and numbers | Preferences (`Ctrl/Cmd+,`) › General: Language (System / English / Español) and Decimal separator (Automatic / Dot / Comma) |

Geometry is stored normalized (0..1 of the page, top-left origin); all conversions live in
`src/lib/coordinates.ts` and `src/lib/units.ts`. Frontend unit tests: `pnpm test`.
