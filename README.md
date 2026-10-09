<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/logo-dark.svg">
  <img src="assets/brand/logo.svg" alt="Gutterberg" width="160">
</picture>

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
- [x] **Milestone 16 – Print features** (cut marks as ticks in the margins or lines in the gaps; bleed by mirroring each piece's edge as vectors or from the source gap; duplex with a common back and a back per piece, mirrored for a long or short edge flip, with an X/Y offset for printer drift; project files version 2 with a migration from 1)
- [x] **Milestone 17 – Detect pieces** (a Detect pieces button proposes the grid or the rectangles of the viewed page, found locally from the PDF's own objects, from repeating edges, or from shapes in a scan; shown as a draft with its confidence and applied, in one undo step, only when confirmed)
- [x] **Milestone 18 – Freeform pieces** (piece tool: one rectangle per piece, movable, resizable and rotatable; straightened on export; turn, sort by dragging and real size per piece in the Print tab; a page can have a grid and freeform pieces)
- [x] **Milestone 19 – AI Mode** (opt-in, off and hidden by default: Detect pieces with an AI engine and Sort pages with AI, through Anthropic, OpenAI-compatible, Gemini or Ollama, with your own key kept only in the system keychain; every action asks first which pages go to which server and what it costs, and every result is an editable proposal)
- [x] **Milestone 20 – Hint system** (catalog of help tips in `src/lib/hints.ts`, `<HintToast hint=… />`, stepped hints, anchored tours with React Joyride; first-PDF and Print-stage tours. The single tips for the magnifier, pan/zoom, source vs output gap and page groups are still to add)
- [x] **Milestone 21 – Terminology and languages** (tabs Source / Print, views Original / Preview / Split, "pieces" throughout; every text in `src/locales/en.json` and `es.json` with i18next, language chosen in Preferences; Rust errors reach the UI as codes; decimal separator preference with dot or comma accepted in every number field)
- [x] **Milestone 22 – UI consistency and polish** (shared controls in `src/components/ui`: Button, Switch, Checkbox, Segmented, RadioCard and InfoTip, with no native checkboxes or radios left; AI actions are their own buttons with a spark in the AI colour, and Detect pieces has a Detect with AI button next to the local one; explanations sit behind info tips; the Print tab's piece library and settings are movable panels with a layout of their own; panels at the top or bottom show a full row of thumbnails; Preferences has section icons and an About section with the version and two links that ask before they open the browser; also a keyboard shortcuts sheet on `?`, a start screen when nothing is open, and undo for the Print plan)
- [x] **Milestone 23 – Logo and app icon** (the logo in a light and a dark variant and an app icon on a bone-coloured plate, in `assets/brand/`; icons for every desktop platform made by `scripts/make-icons.sh`, with a simpler 2×2 drawing for the 16 and 32 px sizes; the start screen shows the logo for the app's theme, About, the window and the browser tab use the new icon, and the README switches logo with the reader's theme)
- [x] **Milestone 24 – Images as pieces** (File › Add images…, the Add images button, "Start from images" or dropping image files adds PNG, JPEG and WebP images as pieces, one page per image; a size dialog sets the piece size once for all of them (presets, the size the image says it is, or custom), whether they include bleed, Fit or Fill for images that are not the piece's shape, and shows the resolution each will print at and what it adds to the export, with an opt-in reduction of very large PNG and WebP images to 600 dpi; the pixels are never resampled otherwise, and a JPEG goes into the PDF byte for byte; projects (version 3) keep the images and rebuild the PDF made of them; a missing image keeps its blank page; soft or blurry images are flagged in the library and before export)
- [x] **Milestone 25 – Welcome tour, Help section and bug reports** (a four-step welcome tour made from short clips (`assets/welcome/` masters, `scripts/encode-welcome.sh` makes the WebM, MP4 and poster files in `public/welcome/`) opens once over the start screen, skippable, replayable, with reduced motion respected and help tips waiting while it is open; Preferences › Help holds the tour, the help tips, the shortcuts list and "Found a bug?": Copy app info, Report on GitHub (asks first, opens the issue form with the version and system filled in) and a Discord button for later; issue forms in `.github/ISSUE_TEMPLATE/`)

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
| Source \| Print | tabs in the toolbar. Print: piece library (click, Ctrl/Cmd-click, Shift-click; Copies field and steppers), sheet preview (the sheet in front is always live) with a hideable row of sheet thumbnails (follows Live Preview, with a refresh button when it is off), and the print settings with Plan, Sheet and Page sections that fold (and remember it) |
| Move the panels | Panels menu in the toolbar, a panel's own menu, or Preferences › Workspace: put each panel on the left, right, top or bottom, or hide it. The Source tab has Pages and Properties around the page; the Print tab has the Piece library and the Print settings around the sheets. Each tab keeps its own layout and sizes, and the Print settings only go left or right |
| Turn, size and sort pieces (Print tab) | piece library: `R` / `Shift+R` turn the selection 90° right / left, "Make all portrait / landscape"; drag pieces to reorder them (the sheets follow); the Selected pieces section of the print settings sets a real size (e.g. 63 × 88 mm) or a percentage, and scaled pieces carry a badge |
| Projects | File menu: New project (`Ctrl/Cmd+N`), Open PDF (`Ctrl/Cmd+O`), Open project (`Ctrl/Cmd+Shift+O`), Add PDF, Save (`Ctrl/Cmd+S`), Save as (`Ctrl/Cmd+Shift+S`) and the recent projects. A project is a `.gtr` file with the page groups, freeform pieces, turns, sizes, order, print plan and output settings of every PDF; it points at the PDFs instead of holding them, and asks where a PDF went if it moved |
| Images as pieces | File › Add images… (or the Add images button in the Source tab's page panel, "Start from images" on the start screen, or dropping image files on the window): PNG, JPEG or WebP, one piece per image, the size chosen once in a dialog. An import is one document named after its first image (rename it with the pencil next to the name) |
| Several PDFs | "Add PDF…" in the page panel adds a PDF to the project; the dropdown above the pages switches the PDF being edited. The piece library shows the pieces of all of them (filter by PDF or group), and the Print tab puts them on the same sheets. The Source tab's export is for the PDF being edited |
| Grid presets | Presets section of the Source sidebar: save the viewed group's rows, columns and source gap under a name, apply it to any other page group. Presets belong to you, not to a project |
| Skip a page / include it | checkbox on its thumbnail (skipped pages are left out of the export) |
| Different grid for some pages | draw the grid on a page, then "Apply this grid to…" (this page, a range, all pages of the same size); edits then apply to the group the viewed page belongs to |
| Undo / redo | `Ctrl/Cmd+Z` / `Shift+Ctrl/Cmd+Z` (also `Ctrl+Y`), or the toolbar buttons. One history for everything, including the Print plan (copies and plan settings): it undoes the last change made in either tab; a whole drag is one step |
| Welcome tour and Help | The welcome tour opens by itself once, over the start screen (Skip, `Esc` or Get started close it for good). Replay it from the start screen or Preferences › Help, which also brings the help tips back, lists every shortcut, copies the app info (version, system, language, pdfium) and opens the GitHub bug report form with the version and system filled in |
| Keyboard shortcuts | `?`, or File › Keyboard shortcuts…: every shortcut by area, in the app's language |
| Start screen | With nothing open: Open PDF, Open project and the recent projects |
| Exact values | Source layout section: columns, rows, piece width/height and selection X/Y. Enter commits, Esc reverts, ↑/↓ nudge. Type `63.5` or `63,5`: both work whatever the decimal separator preference says |
| Language and numbers | Preferences (`Ctrl/Cmd+,`) › General: Language (System / English / Español) and Decimal separator (Automatic / Dot / Comma) |

Geometry is stored normalized (0..1 of the page, top-left origin); all conversions live in
`src/lib/coordinates.ts` and `src/lib/units.ts`. Frontend unit tests: `pnpm test`.
