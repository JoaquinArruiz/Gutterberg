# Sheets and sizes (for 0.9.2)

**Goal:** choosing the sheet is obvious and works for image pieces, the sheet is visible before any piece is on
it, and the two width/height pairs the user edits (the gaps and a piece's size) can be linked or unlinked with a
chain icon.

Read `AGENTS.md` first. The card-size rule still holds: a piece only changes size when the user sets it, and
nothing is stretched or shrunk to fit.

## 1. Sheet size selector

- The Print tab's sheet size (today a dropdown in the folded **Page** section) moves to the top of the **Sheet**
  section, next to the grid, so it is the first thing seen. Orientation and margins stay in **Page**.
- Sizes: **Same as source**, **A3**, **A4**, **A5**, **Letter**, **Legal**, **Tabloid / Ledger** (11 × 17 in),
  **Custom**, **Auto-fit to pieces**. New presets go into `PAGE_PRESETS_MM` (`src/stores/layout-store.ts`) and
  `outputPage` reads them all; the Rust side only ever receives a size in points, so it does not change.
- English and Spanish labels for every size.

## 2. Image pieces fit the sheet

**Bug:** the default sheet is "Same as source". For an images document the source page is the image itself
(e.g. 59 × 86 mm), so the sheet is the size of one piece, and with the margins and the gap the piece does not
fit: the plan fails with "does not fit".

- When images are added (Add images…, Start from images, dropping images) and the sheet size is **Same as
  source**, switch it to **A4** (or **Letter** when the app's language region uses Letter: `en-US`, `en-CA`,
  `es-MX`…; otherwise A4), and say so once in a toast: "Sheet set to A4 so the pieces fit; change it in Print ›
  Sheet."
- The sheet grid **Same as source** is not offered while any printed piece comes from an images document
  (`plannerRequired` in the print request), so such plans always use Auto or Rows × columns.
- Example that must work: 10 Japanese-size images (59 × 86 mm) on A4 with the default margins and gap give
  9 on the first sheet and 1 on the second; with A4 landscape, 0 mm margins and a 0.5 mm gap, all 10 fit on one
  sheet. Orientation, margins and gap stay the user's choice (no automatic orientation).

## 3. A blank sheet before any piece

- In the Print tab, when the plan has nothing to print (a custom selection with no copies, or no pieces yet),
  the sheet preview shows one **white sheet** of the chosen size, orientation and margins (margins as a faint
  dashed line), with a short line under it: "Choose pieces in the library to put them on the sheet."
- "Same as source" with nothing printed uses the first page of the first document; with no document at all,
  A4.

## 4. Chain icon for the gaps

- In `GapFields` (Source gap and Output gap), replace the **Link horizontal / vertical** switch with a chain
  icon button between the two fields: lucide `Link` when linked, `Unlink` when not, `aria-pressed`, a tooltip
  ("Linked: both gaps change together" / "Not linked"). Linked shows one field ("Gap") as today; unlinked shows
  Horizontal and Vertical.
- Same data (`gapLinked`, `sourceGapLinked`), so no migration.

## 5. Chain icon for a piece's width and height

Today a piece's printed width and height are tied (one `scale`). Unlinked, the user can set them separately,
e.g. 63 × 90 mm: an explicit, visible choice, like the real size.

- **Engine (`card-core`):** `Card`, `CardSetting` and `SheetPlacement` get `scale_y: Option<f64>` (absent =
  same as `scale`, so every existing request, project and test means the same). `final_size` uses both;
  `card_transform` becomes `R(turn) · S(scale, scale_y) · R(-source angle)`, which is the current matrix when
  the two are equal. Backs (duplex) take the front's two scales. Tests: a 63 × 88 piece at (1, 90/88) prints
  63 × 90; turned a quarter it prints 90 × 63; the matrix maps the source corners onto the destination.
- **Frontend:** `CardEdits.scalesY` (missing = same as the scale), saved in the project (an optional field, so
  older files open unchanged). `applyEdits`, `finalSizePt`, `formatCardSize` ("63.0 × 90.0 mm (100% × 102.3%)"),
  `planSettings` and the request carry it. `CardImage` sizes the picture to its box, so the preview and the
  library show the stretched piece as it will print.
- **Selected pieces:** a chain icon between Width and Height (linked by default). Linked: as today. Unlinked:
  Width changes only the horizontal scale, Height only the vertical; Scale shows a percentage only when both
  are equal, otherwise "—". "Back to the size on the page" resets both and links them again.
- Never applied automatically, never used to make pieces fit.

## Done when

- The sheet size is in the Sheet section with the new sizes; images added to a project print on A4 (or Letter)
  without the "does not fit" error; the 10-image example above works.
- An empty plan shows a white sheet of the right size.
- Both gap pairs and a piece's width/height have a chain icon that links and unlinks them, in both languages.
- Every check in `AGENTS.md` passes, `CHANGELOG.md` lists the changes under Unreleased, and this brief is deleted
  (what is worth keeping goes into `docs/architecture.md`).
