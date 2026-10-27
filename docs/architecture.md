# Architecture

How Gutterberg is put together and why. For what it does, see the [README](../README.md); for the words the
interface uses, the glossary in [AGENTS.md](../AGENTS.md); for shipping a version,
[releasing.md](releasing.md).

## The shape of it

Gutterberg takes PDFs whose pieces (cards, tokens, tiles) are packed on a page, lets the user say where the pieces
are, and writes new sheets with the pieces re-spaced. Two ideas shape everything:

- **The original content is never touched.** A piece is the source page placed in the output as a PDF form
  XObject, clipped to the piece's rectangle, moved, turned or scaled with a transformation matrix. Nothing is
  rasterised on export, so text and vector art stay sharp. Pieces keep their size unless the user explicitly sets a
  real size or a percentage; a layout that does not fit is an error, never a reason to shrink.
- **One engine, written once.** Geometry lives in Rust, in one place. The interface asks the engine over IPC and
  draws the answer; it never re-derives layout maths. Preview and export run the same planner, so what you see is
  what you get.

```
Source PDFs ─► Source tab ─► extract_cards ─► piece library
                                              │
                      Print tab (plan) ─► paginate ─► finish ─► export_sheets ─► PDF
```

## The parts

| Part | Where | What it is |
| --- | --- | --- |
| `card-core` | `crates/card-core/` | Geometry, layout, the sheet engine, PDF export (`lopdf`), rendering (`pdfium-render`), detection, images, the project file, permission flags. No Tauri and no UI. |
| `card-cli` | `crates/card-cli/` | `gutterberg-cli`, the command line: exports or checks a saved project without the app. Only `card-core` and `lopdf`; no pdfium, no window. |
| `card-ai` | `crates/card-ai/` | The optional AI Mode: provider adapters, prompts, reply checks. The only crate that sends a user's data over the network. |
| Tauri shell | `src-tauri/` | The window and the glue. `src/commands/*` are thin IPC wrappers around `card-core` and `card-ai`; it also owns the system keychain, the updater, the file association and the render thread's state. |
| Frontend | `src/` | React 19 and TypeScript. Zustand stores in `src/stores/`, pure helpers in `src/lib/`, components in `src/components/`, texts in `src/locales/`. |

The dependency runs one way: the frontend knows the IPC commands, the commands know the crates, and `card-core`
knows nothing of Tauri. That is what keeps the engine testable on its own (`crates/card-core/tests/`).

The updater plugin is the only network use besides `card-ai`. It sends nothing but the request for `latest.json`
and the download of a new version.

## The engine (`card-core`)

### Pieces and page groups (`card`)

A piece is identified by a `CardId`: a grid piece (document, page, grid, row, column) or a freeform piece (document,
page, index), always carrying its `DocumentId` so several PDFs can share a project. An `OrientedRect` is a piece's
source area, rotated about its centre; grid pieces have an angle of 0. The pages of a document are covered by
`PageGroup`s with no gaps: `grid` (pages and a list of 1 to 9 grids, each with rows, columns, gaps and a selection
that may be empty), `skip`, and `freeform`. A page removed from view is a `skip` group marked `removed`, never joined
with pages that are only skipped: it is left out of the export like them, and also out of the Pages panel and the
page-by-page keys (`lib/removed-pages.ts`), so restoring it is including it and undo covers both. Edits apply to the group the viewed page belongs to, and to its active grid
(`activeGrid` in the layout store: session state, not undone, back to 0 when the viewed page moves to another group);
"Apply this grid to…" copies the active grid, or all of them, onto other pages as separate groups.

**The grid number.** A grid piece's id carries the grid's place in its group. It is left out when it is 0, in the
JSON (`skip_serializing_if`) and in the key of per-piece edits (`g:doc:page:row:col`, `g:doc:page:row:col:n` for
n > 0), so ids and edits from before several grids keep their meaning and need no migration. A grid with no region
is sent to the engine as `null`, so the grids after it keep their numbers. Deleting a grid renumbers the ones after
it: `keyAfterGridDelete` re-keys the edits, and `onGridDeleted` the Print stage's copies, selection and common back.
Pieces come out page by page, grid by grid (each row by row), then the page's freeform pieces; pairing backs
matches pieces grid by grid.

**Names, colours, folders and hiding.** A grid can carry a `name`, a `color` (one of `GRID_COLORS`), a `folder` and
`hidden`, saved in the project and copied by "Apply this grid to…"; none of them reaches the engine or a piece's id,
so they change no key, and a hidden grid still prints. A folder is a name its grids share; the group's `folders` list
also keeps empty ones, which the list shows first. Renaming or ungrouping a folder rewrites that name on its grids
(`renameFolder`). The Grids list (`gridList`) shows a folder where its first grid is, so moving rows
(`moveInGridList`, dragged with pointer events like the piece library) puts a folder's grids together and renumbers
the grids in list order; the list is its own panel (`grids` in `PANEL_DEFS`, `GridsPanel`), with the page's freeform
pieces after the grids. The pieces' keys follow through `keyAfterGridRenumber` and the `onGridsRenumbered` listener,
as when a grid is deleted. `pickedFolder` in the layout store, session state beside `activeGrid`, is the
folder picked in the list: a drag on one of its grids (the `grids-move` drag) and the arrow keys move its regions
together through `moveRectsTogether`, which stops them as one at the page's edge. Picking a single grid
(`setActiveGrid`) drops the folder. A page can
have a grid and freeform pieces together (`toRustGroups` puts a page's freeform pieces after its grid pieces).
"Turn into pieces" (`turnGridIntoPieces` in the layout store, `lib/grid-to-pieces.ts`) takes the cells the engine
extracts for the page (`compute_cards`), appends them as freeform pieces, clears the group's region and re-keys the
per-piece edits (`editsAfterRekey`) and the Print stage's copies, selection and common back (`onCardKeysMoved`), in one
undo step; on one page of a shared group, the page first leaves the group.

### Layout (`layout`)

`calculate_layout` is the single source of truth for geometry. It turns a source page, a grid and gaps into
`CardPlacement { source, destination }` in points with a top-left origin. A gap that does not fit the output page is
an error. `calculate_fitting_layout` is the variant that sizes the page around the pieces.

### Sheets (`sheet`)

The engine behind every export, in four steps:

1. **Extract.** `extract_cards` turns page groups into `Card`s: `{ id, source, scale, scale_y, turn }`. `turn` is 0,
   90, 180 or 270 degrees clockwise; `scale` is 1 unless the user chose a real size. `scale_y` is absent unless the
   user set the width and height apart (the chain icon), in which case `scale` is the factor along the piece's own
   width and `scale_y` along its height.
2. **Paginate.** `paginate` puts `(Card, quantity)` pairs on `OutputSheet`s. Order is grouped or interleaved. Pieces
   are grouped by size (each size gets its own sheets; a slot is the group's largest width by largest height, and
   smaller pieces are centred in it), or share one grid if grouping is off. Pieces are laid out row by row, the block
   centred inside the margins. Asking for more rows or columns than fit, or a piece larger than the page, is
   `DoesNotFit`. Auto-fill repeats pieces to fill the last sheet.
3. **Finish** (`finish`). Cut marks, bleed, background colours and duplex backs are added to the planned sheets. With everything off the
   sheets pass through untouched, and the exported content stream is the same as before.
4. **Export** (`export`). `export_sheets` builds a PDF from any list of sheets and several source documents.

The plan the Print tab runs is `plan_print`: either `SameAsSource` (each drawn grid of a page becomes one sheet through
`calculate_layout`, so a page with three grids gives three sheets; byte-identical to what the Source tab exports) or `plan_sheets` with a sheet grid, copies and
auto-fill. `card_transform` (and `card_transform_xy` for two factors) is the one place that does the matrix maths for
placing a piece: `R(turn) · S(scale, scale_y) · R(-source angle)` about the piece's centre, then move the centre onto
its slot. The piece is stretched along its own sides before it is turned; with equal factors it is a plain rotation
and scale.

### The print request (`print_request`)

The Print tab's plan, as the project saves it, becomes the planner's input in one place. `print_request` reads the
parts of a project body that printing needs (`PrintProject`: the documents' page groups and freeform pieces, the
piece edits, the plan and the output settings, in the UI's camelCase and normalized coordinates) and builds the
`PrintRequest`: the page groups in points (a page's freeform pieces become a one-page group right after its grid
pieces), the per-piece settings in the user's order, the sheet layout ("same as source" only for the default plan;
freeform, edited, image or gutterfold pieces need the planner) and the finishing, with backs that name a gone piece
left out. Values are pulled back into what the interface allows, as opening a project does, so a hand-edited file
prints the same in the app and from the command line.

The app sends its live stores in that shape (`printProject` in `src/lib/print-request.ts`) to `compute_sheets`,
`validate_print` and `export_print`, with the page sizes it shows; the command line reads it from the file, with the
page sizes in the PDFs (`lopdf`). The two agree on every example PDF (`crates/card-cli/tests/export.rs` compares the
bytes with pdfium's sizes when pdfium is there). `tests/print_request.rs` checks the request against the one the
TypeScript built before the step moved here, for nine projects (`tests/data/print-requests/`).

### Export (`export`)

Each source page becomes a Form XObject named `/S{document}_{page}`, stored once however many pieces and copies use it.
Each piece is painted with `q <matrix> cm /C{n} Do Q`, where `/C{n}` is a small *card form* whose `/BBox` is the
piece's area and whose content is `<clip> W n /S… Do` (a translate-and-clip for axis-aligned pieces, a rotated clip
path for tilted ones). Copies of a piece share its card form. The tight box lets a viewer draw only the piece's area
instead of the whole page for every piece: faster, and no flash of the whole page before the clip applies. The text
outside a piece is still in the file (it is the publisher's page, untouched), so a viewer may still find it when
searching. `drawn_content` writes the card forms out in place, for tests and for looking into a file. Details that
matter:

- Page boxes are resolved with inheritance (MediaBox and CropBox separately, then intersected), `/Rotate` of 90, 180
  and 270 is handled, `/UserUnit` other than 1 is refused, and the page's transparency group is kept.
- Page content is decompressed with a size cap, and a decode failure is an error, never a raw copy.
- The catalog's outlines, named destinations, structure tree, form fields and open action are dropped before
  unreachable objects are pruned, so the old pages really leave the file.
- What a source says about itself is kept. With one PDF its document information and XMP stay as they are. With
  several, each text entry of the document information (title, author, copyright, ...) lists every used PDF's value
  once, in source order, and the dates and producing tools are the first used PDF's. The catalog then drops the first
  PDF's XMP, which no longer describes the whole file, and each PDF's XMP (or the page's own) goes on the forms of its
  pages, so no publisher's notice is lost or credited to another file.
- The file is written to a temporary file in the output folder and renamed, so a failed export leaves nothing, and
  the output may never be the file that is open.
- `validate_export` and `validate_sheets` run the same checks without writing, one `PageIssue` per failing page
  (with its document, an error code and its values). The interface lists them before the save dialog opens.

### Finishing (`finish`)

- **Cut marks:** ticks in the margins at every piece edge, or lines down the middle of each gap (too narrow a gap
  gives a warning and no line). Ticks can add a cross (`MarkOptions::inner_crosses`) in the middle of each place
  where a gap between columns meets one between rows and a piece has a corner, its arms the tick length. Drawn as strokes, last: solid, dashed or dotted (`MarkLine`). The engine puts the
  dash pattern in points on `SheetMarks.dash` (dots are dashes of length 0 with round caps), so the preview and the
  export read the same pattern. Back sheets get none (you cut through both sides from the front, and a printer's
  drift would put them beside the cut) unless `MarkOptions.on_backs`: then `marks_for` runs on the back placements,
  so the marks follow the mirroring and the back offset.
- **Bleed:** taken either by mirroring each piece's own edge (4 strips and 4 corners, as vectors, using the piece's
  oriented edge so tilted pieces work) or from the gap that is already in the source. A bleed bigger than half a piece
  is an error; a source gap smaller than the bleed is a page issue that blocks export.
- **Background:** `BackgroundOptions` holds two optional colours, `sheet` and `pieces`, carried on every sheet (front
  and back) as `OutputSheet.background`. Export paints them first, as plain vector fills: the whole page, then one
  rectangle per placement grown by the bleed; the bleed and the pieces go on top. They only show where the source
  paints nothing. So the preview can show them, the Print tab's piece crops are rendered with a clear background
  (`render_region_png_on(.., transparent: true)`), over the sheet or piece colour (white when none).
- **Duplex:** backs are mirrored left to right for a long-edge flip on a portrait sheet (or a short-edge flip on a
  landscape one), otherwise top to bottom, with the back's turn adjusted so a front corner and its back corner pair
  up. A common back or a back per piece, with an X/Y offset for printer drift. `calibration.rs` writes the sheet that
  measures that drift: a front with a crosshair at the four corners and the centre, and a back with a ruler beside
  each place (placed with the same mirroring, `finish::mirrors_x`), in the back sheet's own frame, so the number read
  where a front line crosses a ruler is the offset to type, with no sign to work out. The words come from the UI.
- **Gutterfold:** with `layout: Gutterfold`, pagination reserves a **pair slot** for every front (its size plus a
  room the same size past the fold, plus the fold gap) and places slots exactly like pieces: grid, gaps, margins,
  grouping by size, `DoesNotFit` for a pair too large, never shrinking. Finishing then puts the back in that room,
  turned a half turn when the fold is horizontal (or as `back_upside_down` says), and adds the fold lines
  (`OutputSheet.folds`, drawn dashed and grey by export and the preview). Cut marks and bleed warnings use the pair
  outlines, so no mark crosses the fold. With `cut_apart` the pairs are not folded but cut into two pieces: the same
  slots and placement, no fold lines, outlines for the front and the back each (so marks also run along the line
  between them), and a back below its front stays upright unless `back_upside_down` says otherwise. "Same as source"
  has no room for the backs, so the interface switches to the planner and the engine refuses that combination.
- **A back's own turn:** each `BackPair` (and the common back) carries the turn the user gave the back piece in the
  library, added to the turn the flip or the fold needs. That is how upside-down backs in a file are set right.
- **Automatic pairing** (`src/lib/pairing.ts`) is pure data over piece ids, in the interface: pages in order per PDF,
  then rows and columns (mirrored columns for duplex files; the piece it meets when folded for "beside each other");
  freeform pieces by their order. Applying writes the backs and the backs' turns into the per-piece edits and sets
  the backs' copies to 0, as one undo step (`together` in `stores/history.ts` joins the layout and plan timelines).
  "Backs in another PDF" pairs page *n* of the fronts' PDF with page *n* of the chosen PDF, piece by piece, or uses a
  one-piece backs PDF as the common back. Nothing changes in the project: a back is stored by its full piece id
  (`cardIdKey`), which names the document, and the common back is a `CardId`.

### Permission flags (`access`)

A PDF's publisher may lock it. A PDF locked against printing or modifying is refused (`PdfLocked`) before anything
is written, from the pre-flight check, and the interface shows a lock badge from the moment the file is opened. Any
other restriction (for example no copying) is kept: the output is encrypted (AES-128, opens without a password)
with the same flags, or the most restrictive of them when several PDFs share the sheets. A PDF without restrictions
exports as before. The badge reads the flags through pdfium; the export reads them through `lopdf`.
AI Mode refuses a PDF with any restriction at all (`access_of_file(..).is_restricted()`, in the AI commands before
anything is rendered), since it hands the pages, or their text, to another company.

### Images (`images`)

Images become pieces by building a one-page-per-image PDF, cached under the app's cache folder and rebuilt from the
project's images when needed. `probe_image` reads headers only (format, size as shown, resolution, SHA-256, limits
of 100 megapixels and 200 MB). `plan_image` is the one place with the arithmetic: the page, the piece inside it,
whether proportions differ, the resolution at the printed size and its grade (soft under 300 dpi, blurry under 150),
and the estimated size in the export. A JPEG goes into the PDF as its own bytes; PNG and WebP are decoded and stored
losslessly. Pixels are never resampled, except by an opt-in reduction of very large PNG and WebP images to 600 dpi.
The dialog, the library badge and the pre-flight warning only show what the engine says.

### Rendering (`render`, `render_worker`)

pdfium renders previews, thumbnails and piece crops, for the interface only: export never touches it. `PdfDocument`
borrows `Pdfium`, so one dedicated thread owns the pdfium library and every open document, and serves requests over
a channel (`RenderWorker`). That serialises pdfium and lets the thread drop requests that a newer one of the same
kind has superseded: viewport and magnifier requests are tagged with a generation, and a stale one is rejected as
`superseded`. Thumbnails and whole-page base layers are never dropped. Documents are opened once and kept open, by
document id, so scrolling 100 thumbnails parses the file once. Pdfium is bound at first use, so a missing library is
an error in the interface and not a crash at startup.

### Detection (`detect`)

**Detect pieces** ("Detect on this page", at the bottom of the Layout section, whose grid it fills) proposes where the pieces are on the
viewed page, locally. It returns proposals, best first, each
a grid or a list of rectangles with a confidence, the engine that found it and notes (missing cells, crop marks,
uneven sizes...). Three engines run in order, and the search stops at a confidence of 0.85:

1. **Objects:** the page's images and four-corner paths, read from their own points, gridded by clustering lefts and
   tops. Exact when the pitch is regular. Inside a form it only reads when the form is the page's single form.
2. **Edges:** a grey render, profiles of the gradient, peaks merged when closer than 1.2 mm, a regular comb found by
   autocorrelation and least squares, tried as touching pieces and as pieces with a gap.
3. **Blobs:** for scans: foreground by Otsu against the page border's median, morphological clean-up, connected
   components, and each blob's convex hull and minimum-area rectangle, so tilted pieces come out straight.

When one engine finds two or more good grids (confidence 0.7 or more) that do not overlap, such as blocks of pieces of
different sizes, it also offers them together as one `Grids` proposal (up to 9, in reading order, with the lowest of
their confidences), ahead of the grids one by one. Applied, they become the page group's grids.

A proposal is never applied by itself. It is a draft drawn on the page (dashed outlines, its confidence and engine in
words) that the user applies in one undo step, steps through ("Next proposal") or discards. Once the page's grid is
drawn, a grid proposal is either added as new grids (`addDetectedGrids`, the first one picked) or replaces the grid
being edited, or all of them for several grids; nothing is replaced without that choice. The weights were tuned
on generated fixtures; they are constants at the top of each engine.

**Page edges** (`detect::page_edges`, for sticky edges) reads the same `PageData` for a different answer: the strong
straight edges of the page, vertical and horizontal segments in points with a strength 0..1. The sides of the page's
drawn rectangles, images and cut lines come first, exact, joined where they touch on one line. The grey render adds
runs of strong, same-sign contrast down every pixel column (and along every row), found with a central difference so
an edge between two pixels gives its whole step, merged across columns no more than two pixels apart (so a diagonal in
the art cannot chain into a long edge), placed at the contrast-weighted mean and kept from 5 mm long (`MIN_EDGE_MM`).
A render edge an object already explains is dropped, and each axis keeps its strongest 300. The `page_edges` command
runs it on the render worker; the UI asks once per page and keeps the answer for the session (`lib/edges-api.ts`,
forgotten when a PDF is opened or closed under that id).

### Errors

`Error` serialises to `ErrorInfo { code, message, ...values }`: a stable code, the values the message needs (page
numbers 1-based) and the English message as a fallback. The interface words every error from `errors.<code>` in the
active language; an unknown code shows the English message. Technical details from `lopdf`, the OS or pdfium stay
in English inside a translated frame.

## The project file (`project`, `src/lib/project.ts`)

A `.gtr` file is JSON that starts with `"format": "gutterberg-project"` and a `version`. It holds everything but the
PDFs: for each document its path, content hash, page groups, freeform pieces and viewed page, plus the active
document, the output settings, the per-piece edits (turns, sizes, order, backs) and the whole print plan. It does not
hold the undo history, zoom, tool or hint state. Images documents hold their images instead of a path, and are
rebuilt on open.

- **Checked in Rust, on open** (`parse_project`): not a project (not JSON, no or a different `format`, a bad
  `version`, not text, over 64 MiB) is refused; an older version is migrated one step at a time; a newer one is
  refused whole (`ProjectTooNew`, "please update"). Nothing is ever opened partially. Migrations are a list of
  functions, each taking one version to the next (`v1_to_v2` adds the print finishing, `v2_to_v3` adds the document
  kind, `v3_to_v4` changes nothing: version 4 only adds values, A3/A5/Tabloid sheets and `scalesY` in the edits, and
  the new number makes an older Gutterberg say "please update" instead of failing on them, `v4_to_v5` adds the
  gutterfold settings of the duplex finish, `v5_to_v6` adds `cutApart`, false, so older pairs still fold, `v6_to_v7` turns a grid group's
  `grid` and `selection` into a list of one in `grids`); the current version is 7. A change to the format adds a version and a migration with a test file.
- **Opening is all or nothing.** The file is checked and every PDF found (by hash, so a moved PDF is recognised, and
  the user is asked "Where is this file now?" if it is gone) before any store changes. A PDF whose page count no
  longer fits its saved groups gets that PDF's layout reset, with a notice.
- The interface's model is camelCase with normalised coordinates, not the Rust shapes; `src/lib/project.ts` has the
  Zod schema and clamps out-of-range values back into what the interface allows.
- **Unsaved work.** Closing the window with unsaved changes asks Save, Don't save or Cancel (`confirmClose`, from
  the window's close-requested event). While there are unsaved changes, `src/lib/recovery.ts` writes the project
  every 30 s to `recovery/<run id>.gtr` in the app's data folder, with a `.json` saying where it was saved and when
  (`card_core::recovery`). Each run has its own id, so two windows never overwrite each other. A copy not written
  for 90 s belongs to a run that ended; the next start offers the newest (`offerRecovery`), restored unsaved and
  still pointing at its file. Saving, closing on purpose, Restore and Discard remove the copy.
- The file association (`.gtr`, type `dev.joaquinarruiz.gutterberg.project`) opens a project at startup (command-line
  argument on Windows and Linux, the "opened" event on macOS) through the same open path, with the same checks.

## The command line (`card-cli`)

`gutterberg-cli export my-game.gtr -o sheets.pdf` writes what the app's Export writes for that project;
`gutterberg-cli check my-game.gtr` plans the same sheets and lists what would stop the export, writing nothing.
It reads the project with `read_project` (so an older one is migrated and a newer one refused, with the app's error
codes), finds the PDFs at their saved paths and checks their hashes: a PDF that is gone stops it, and one that changed
stops it unless `--force` (the app asks in both cases). An images document's PDF is rebuilt in the system's temporary
folder; a missing image leaves its page blank with a warning, as in the app. Settings are never changed from the
command line. Messages are in English, each error with its code.

It is a separate binary rather than a subcommand of the app: the app is a GUI program on Windows (no console to print
to), and a binary with only `card-core` also runs on a machine with no screen. Its version is the app's
(`build.rs` reads `src-tauri/Cargo.toml`). The release workflow builds it for each target and puts it next to the app
in the installers (Tauri's `externalBin`, added only for the release by `src-tauri/tauri.cli.conf.json`, so
`pnpm tauri dev` and `cargo test` do not need it), and attaches it to the release on its own.

## Coordinates and units

The interface works in normalised coordinates (0 to 1 of the page, top-left origin); `layout.rs` works in points
with a top-left origin. Every conversion goes through `src/lib/coordinates.ts` or `src/lib/units.ts`; mm and points
convert with `pt = mm * 72 / 25.4`. Numbers shown follow the user's unit (mm, cm, inches) and decimal separator
(`formatDecimal`/`parseDecimal` in `lib/measurement.ts`: one `.` or `,`, no thousands separators or exponents).

## The interface (`src/`)

**Two tabs, one engine.** The Source tab edits the pages of the source PDFs (where the pieces are, which pages to
skip) and shows the page as it is (**Original**), the re-spaced result (**Preview**, of the active grid when the page has several) or both (**Split**). The Print
tab chooses what goes on the sheets (the piece library, copies, order, the sheet and page, marks, bleed, duplex) and
exports. The Source tab's own export is the Print tab's default plan.

**Size presets.** `lib/size-presets.ts` holds the built-in sleeve sizes (shared by Selected pieces and Add images) and
the helpers for the sizes a user saves (`sizePresets` in preferences). A preset sets an explicit per-piece scale like
typing a size does (`presetScales`: both sides set each; one side keeps the proportions), so it is one undo step and
is shown wherever a size is shown. A size with both sides is asked about first when it would stretch a piece.

**Piece references.** A piece is named `p3 · r1 c2` (grid), `p3 · g2 · r1 c2` (grid on a page with several grids,
`cu2` in Spanish) or `p4 · #2` (freeform) in the library, in the Selected
pieces section and, when the switch in the sheet preview's header is on (`print.showReferences`), on the large sheet
(`SheetReferences`: a chip at each piece's corner, shortened or left out when the piece is too small for it, never in
the exported file). `pieceReference` and `documentLetter` in `lib/card.ts` build the text; with several PDFs each gets
a letter by its place in the project (A, B, …) that goes in front.

**Editing on the page.** Four tools: Select (`pick`) takes whatever is pressed, a piece over a grid, and draws
nothing; Grid (`grid`) draws and edits grid regions; Piece (`card`) draws and edits pieces; Pan. Select only routes a
press to the Grid or Piece tool's own handling by what was hit (`data-card` or `data-hit`), so the drags are the same.
The editor store keeps what is picked: `selectedCard` (the piece whose handles and fields
show), `pickedCards` (every picked piece of that page) and `pickedRegion` (the page whose grid region the arrow keys
move). `lib/editor-actions.ts` holds what the keys do to them (nudge, with a burst of presses held open as one undo
step; duplicate; pick all; delete), so `App.tsx` and the viewport's Alt-drag call the same functions. Snapping is pure
maths in `lib/snap.ts`: the moving thing's upright box gives its edges and middle, which snap per axis to the page and
to the other pieces and the region within a few screen pixels (`snapTolerance`), and the viewport draws the guides.
The switch is `editor.snap` in preferences; `Ctrl/Cmd` held turns it off for a drag, which is why only `Shift`-click
adds a piece to the picked ones.

**Precision aids** (0.15.0) build on that. Sticky edges (`editor.snapEdges`) add the page's edges as targets, normalized
by `edgesToNormalized`; `edgeTargets` keeps only those running along at least half of the moving box's side, so art
inside a piece never pulls a border. Every snap is sticky: `stickyOffset` is the same search with hysteresis, as a
pure function of the previous move's state, holding a line on its target until the pointer has moved `RELEASE_PX` from
where it snapped, then refusing that target until the lines are clear of it. The magnet decides the page, the pieces
and the guides; sticky edges decide the artwork's edges. The rulers (`editor.rulers`, `Ctrl/Cmd+R`) sit outside the
canvas element, so turning them on shrinks the canvas instead of covering the page, and their tick maths is pure
(`lib/rulers.ts`); the pointer mark is moved by the canvas through a handle, without a render. Guides live in the
editor store, by document id, in points from the page's corner (`lib/guides.ts`), so they stay at the same distance
on pages of different sizes; which ruler gives which guide is `guideFrom`/`rulerOf`, swapped by `editor.invertRulers`; they are session state, outside undo and the project file. They show, take presses and
are snapped to only while the rulers are on, and are drawn under the region and the pieces so a guide along a side
never takes their handles.

**Stores** (Zustand, read with per-field selectors, never the whole store): documents, the layout of the PDF being
edited (the others are parked and swapped in), the print plan, editor session state, preferences, project state, the
hint manager, update and toast state, and UI state. History is `zundo` on the layout and the print plan, joined by one
ordered journal so Ctrl+Z undoes the last thing done in either tab; a whole drag is one step. History is cleared when
a document opens.

**Panels** are placed by a layout registry (`workspace-layout.ts`): each tab has its own panels (Pages and
Properties; piece library and print settings), positions (left, right, top, bottom, hidden), sizes and presets,
remembered in preferences. A strip's height is built from its content, so a row of thumbnails is never cropped.

**The sheet.** The sheet size is the first setting of Print › Sheet: Same as source, A3, A4, A5, Letter, Legal, Tabloid /
Ledger, Custom or Auto-fit (presets in `PAGE_PRESETS_MM`; Rust only ever gets a size in points). Image pieces always go
through the card planner (`plannerRequired`), because their source page is the image itself; adding images while the
size is still "Same as source" sets the usual paper of the user's region (`usualPaper`: Letter in the Americas that
use it, A4 elsewhere) and says so in a toast. With nothing to print, the preview shows a white sheet of the chosen
size with its margins dashed. Orientation, margins and gap are always the user's: nothing turns or shrinks to fit.

**Shared controls** live in `src/components/ui` (Button, Switch, Checkbox, Segmented, RadioCard, InfoTip, Toast,
ChainToggle, ...). Pairs of values that can follow each other (the horizontal and vertical gaps, a piece's width and
height) have a chain icon beside them (`ChainToggle`, `ChainedFields`), pressed while linked;
no native checkboxes or radios are left. Long explanations sit behind info tips; warnings and the reasons a control
is off stay visible. AI actions are their own buttons, with a spark in the AI colour. Right-click menus go through
`ContextMenu`: `openContextMenu(event, entries)` from any element, drawn once by `ContextMenuHost` in `App.tsx`, one
menu at a time; the entries are built where the right-click lands (the page, a row of the Grids list, a colour), so a
menu only ever repeats actions that have a button or a key of their own.

**Previews and caching.** The main view is tiled (one request in flight at a time) and the magnifier is debounced
and renders at quarter-octave scale steps so small zoom changes reuse an image. Piece thumbnails are `render_region`
crops cached by piece, crop geometry and width (400 images, least recently used). Sheet previews: the sheet in front
is always live; the row of previews obeys **Live Preview** (on, it follows the plan; off, it shows the last refresh
with a "previews out of date" mark). Tilted pieces are straightened in previews with CSS; the export does the same
with matrices.

**Windowing and limits.** The library is a windowed grid that mounts only the rows in view. The window has a minimum
size of 900 x 560, and the layout is checked there in both themes and both languages.

## Help (`hints`, welcome)

Every help tip is in one catalog, `src/lib/hints.ts`: plain data (a hint is one step or a short tour; a step has text,
an optional action named in a registry, an optional target element and an optional app event that advances it).
`<HintToast hint="…" />` shows one; the call site decides when and where, the catalog decides what. One hint shows at
a time. A tour step with a target points at it with a spotlight (React Joyride, MIT) and moves on when the app emits
the matching event (`hint-events.ts`), however the user did it. If a target is not on screen, it falls back to a
toast. Dismissals are stored with the hint's version, so a changed tip can come back; "Show closed tips again" brings them all
back. `help.tipsOn` (Preferences › Help, or "Don't show tips" on a tip) turns every tip and tour off with one check in
`useHint`; the welcome tour is not a tip. Tips can be turned off for good, so messages that matter (an update, how an update went) are not tips: they use
the general toast (`Toast`), a queue that shows one at a time.

**Colour on the accent.** `--accent-fg` is the text colour on `--accent` (black in the dark theme, white in the light
one, where black on `#2563eb` is 4.06:1, under WCAG AA's 4.5:1): primary buttons and accent badges use it, never
`text-black`. **The empty toolbar:** with no document open the toolbar shows only File, the panels menu and
Preferences; everything that needs a document appears when one is open.

The **welcome tour** is four short clips (masters in `assets/welcome/`, encoded by `scripts/encode-welcome.sh` into
`public/welcome/`) in a dialog that opens once over the start screen. Help tips wait while it is open. Preferences ›
Help holds the tour, the tip reset, the shortcuts and the tutorials; Preferences › About holds "Found a bug?", which
copies the app info or opens the GitHub issue form after asking, with the version and system filled in, or the
Discord invitation. Every address the app opens is in `src/lib/external-links.ts` and in the opener permission.

The tour's clips are cropped to their 4:3 picture (`crop=1440:1080:240:0` in the encode script; the masters have black
at the sides, so a future export of the Figma frames should be 4:3) and shown beside the text; below about 720 px
wide the dialog stacks with the clip on top. The keyboard shortcuts sheet is the catalog `src/lib/shortcuts.ts`
(chords of key names, `Mod` being Ctrl or Command) plus a text per entry in both languages. It is written by hand,
so a shortcut added or changed in a `keydown` handler changes there too; `shortcuts.test.tsx` checks the catalog and
the texts have the same ids. `ShortcutsList` (the sheet and Preferences › Help) has a sticky search field that filters by
the translated text and the key names (`Mod` also matches Ctrl, Cmd and Command; `Alt` also Option).

**Tutorials.** A tutorial is a walkthrough that the user starts, not one the app picks: the catalog `src/lib/tutorials.ts`
has an id, a group (Source, Print, Duplex, App), what it `needs` (nothing, a PDF, or a PDF with pieces) and its steps,
which are `HintStep`s with the same targets, events and actions as a tip; the texts are `tutorials.<id>.…` in both
languages (`mark-and-export` reuses the steps of `first-pdf-tour` and `print-stage-intro` instead of repeating them).
`HintCard.tsx` holds what a tip and a tutorial share, the card and the Joyride spotlight (`HintStepView`) and the
`advanceOn` subscription; `HintToast` and `TutorialHost` decide when and what to show. `ui-store` holds the running
tutorial (`tutorial: { id, step }`) and starts it from the list (`startTutorial`, which also closes the list and
Preferences); one `TutorialHost` is mounted in `App.tsx`. It ignores `help.tipsOn` and the closed tips, and holds every
tip while it runs (`hintsHeld`, as for the welcome tour, and a check in `useHint`), and for a moment after. Done, the ×
and `Esc` end it. If its need is not met, `TutorialHost` shows the need (`NEEDS_STEPS`: Open PDF…, or start “Mark pieces
and export”) in place of the step, and goes on by itself when the PDF or the pieces are there; a tutorial never opens
a sample or changes the project. A step for a place the user is already in (the Print tab) is skipped. A modal dialog
(Preferences, the calibration sheet, the pairing, the image size) covers the page, so while one is open the card sits
inside it instead of pointing at something behind it. Nothing is saved: no preference or project field, so tutorials
do not change either version. The list (`TutorialsList`: a sticky search field over the translated title and summary,
ignoring case and accents) is in the Tutorials dialog, opened from the `?` Help menu in the toolbar (`HelpMenu`, which
also has the shortcuts, the welcome tour and Report a problem), and in Preferences › Help above the tips switch.

## Languages (`i18n`)

English and neutral Latin American Spanish (`tú`), chosen in Preferences (System, English, Español), with the decimal
separator a separate preference (Automatic, dot, comma). Every user-facing text is a key in `src/locales/en.json` and
`es.json`, typed so a wrong key is a compile error; a test checks both files have the same keys and placeholders.
Components use `useTranslation`; stores and `lib` code use the exported `t`, and keep errors as data so a message on
screen changes language with the app.

## AI Mode (`card-ai`)

Optional, off and hidden by default (the one Preferences entry is the switch). Buttons with fixed prompts, no chat:
**Detect with AI** is a second engine behind the Detect pieces button (one grid, several grids or rectangles, the
shapes the local engines propose), **Sort pages** labels every page (cards, backs, rules, cover, other) and offers to
skip the ones without pieces, and **Pair backs with AI** (a choice in Pair backs automatically…) sends a picture of
each piece of the library, cut out by `render_pieces_in` at 256 px, named by where it is, and gets back which pieces
are fronts, which are backs and the back of each front (`card-ai/src/pairing.rs`, then `pairingFromSides` in
`src/lib/pairing.ts`). It is one request, so a front and its back are seen together, of at most 100 pieces, and needs
pictures. A result is always an editable proposal, or for pairing, a summary to apply or not.

- **Providers:** Anthropic, OpenAI-compatible, Gemini and Ollama, behind one request shape. Replies are validated
  (inside the page, plausible sizes and counts, grids that do not overlap, every page labelled and every piece
  answered exactly once, a front's back a piece called a back); an unusable reply changes nothing.
- **The switch is checked in Rust.** `Gate` is set from the preference and checked before the keychain is read and
  before anything is sent, so a stale interface cannot send while it is off (tested with a local listener).
- **Keys** live only in the system keychain (`keyring`: Keychain, Credential Manager, Secret Service), written and
  read in Rust. The interface can ask whether a key exists, set it and delete it; it can never read it. A keychain
  that fails means AI Mode cannot send; there is no fallback.
- **An action asks first** (provider, server, whether pages or pieces go as pictures or text, how many requests) and
  sends nothing until the user presses Send. "Don't ask again" in that notice saves the server (`ai.trustedHost`)
  once Send is pressed; only that server skips the notice, so another provider or address is asked about again, and
  Preferences › AI Mode › Ask before sending clears it. No price is shown: list prices change and a stale one would
  mislead. Only plain `http://` to local or private addresses is accepted.
- **The model list** (`card-ai/src/models.rs`) is one GET to the provider's own list (`/v1/models`, `/models`,
  `/v1beta/models`, `/api/tags`), made when Preferences › AI Mode shows a provider, through the same gate and
  address checks, with the key if one is saved and no body. Anthropic and Gemini are not asked without a key. The
  Model field (`ModelPicker.tsx`) filters that list as the user types and keeps any typed id, so a failed or empty
  list leaves an ordinary text field. Lists are saved in `ai-models.json` in the app's cache folder
  (`card-ai/src/model_cache.rs`), by provider, address, workspace and whether a key was saved (never the key), and
  used for a week; only the reload button or an older list asks again, and a failed request shows the saved list.
- Requests carry a page summary (sizes and object boxes, or a page image if the user allows it), or pictures of the
  pieces for pairing, never the PDF.

## Updates and releases

A tag such as `v1.1.0` builds the app for Windows, macOS (Apple silicon and Intel) and Linux with `tauri-action`, and
leaves a draft GitHub release with the installers, their updater signatures, `latest.json` and the notes from
`CHANGELOG.md`; publishing the draft is what makes installed apps see it. My steps are in
[releasing.md](releasing.md). Builds are not code-signed; the updater verifies downloads with its own key.

In the app, the Tauri updater checks about 10 seconds after start, at most once a day, never during an export and not
at all when "Tell me about" is Never; a
failed or offline check is silent, but Preferences › Updates says the last check did not get through. The "Check for
updates" button there shows the result and also the toast for a newer version. Preferences › Updates shows the installed and the newer version with its notes and
the "Tell me about" setting (all updates, new features, major versions only, never), which decides the toast. The
logic that needs no app (version order including pre-releases, who is told about what, what to say after an update) is
in `src/lib/updates.ts`; `update-actions.ts` talks to the plugins. The toast never installs: its "Update…" button opens Preferences › Updates with the Install button focused, so an update is installed only where its notes (`ReleaseNotes`, in a box of about 14 lines that scrolls) are. Before installing, the version is written down so
the next start can say whether it worked. Experimental features are switches listed in `src/lib/experimental.ts`.

The Windows build also goes to the Microsoft Store, as an MSIX package that `scripts/make-msix.mjs` makes from the
same exe with `src-tauri/msix/AppxManifest.xml` (the identity Partner Center gave the product, the `.gtr` file
association, and an alias so `gutterberg-cli` works in a terminal). The Store signs and updates that package, so the
app asks Windows whether it runs from a package (`src-tauri/src/store.rs`): when it does, the updater plugin is not
registered, `app_info` says `store`, and the web side never checks, hides Preferences › Updates and the Update
Gutterberg tutorial, and adds "(Microsoft Store)" to the app info. One build serves both, so there is nothing to keep
in step but the manifest.

Third-party notices are collected at release time (`scripts/third-party-licenses.mjs`: `cargo about`, `pnpm
licenses`, and the licenses pdfium ships with) into `THIRD_PARTY_LICENSES`, built into the app and shown in
Preferences › About with Gutterberg's own license.

## The log (`src-tauri/src/app_log.rs`)

A plain text log, `gutterberg.log`, so that "the app opens and closes" can be diagnosed: `start` (before anything
else), `ready` (set up), `running` (the event loop is up), the window being closed, `exit`, and for a failure the error
or a panic's message with a backtrace. A start with no `ready` died while starting. It lives in `~/Library/Logs/Gutterberg`
on macOS and in the `logs` folder of the `Gutterberg` data folder elsewhere. It is added to across starts, never
cleared, so the record of a run that crashed is there at the next start. It is bounded: a run writes at most 64 KB, a
file over 256 KB is moved to `gutterberg.old.log` at the next start (replacing the previous one), so the folder holds
about half a megabyte at most. Every write failure is ignored; logging never stops or slows the app. "Copy log" in
Preferences › About (the `read_log` command) hands over the last 24,000 characters, from a whole line, which keeps a
bug report under GitHub's 65,536-character limit. Only the Rust side logs; the web view's own errors are not in it.

## Preferences

One versioned model (`src/lib/preferences.ts`), kept in the webview's storage. `normalizePreferences` is the only way
raw data becomes preferences: it merges onto the defaults, drops invalid values and repairs invariants, so the rest
of the app never sees an invalid state. The user's own grid colours (`gridColors`, version 16) are preferences, not
project data, so they are offered in every project; a grid keeps the hex it was given even when that colour is deleted. A newer version's added setting appears with its default for existing users,
and a migration only exists where meaning changed. Document settings (gaps, page, margins) are never preferences.
The key is `gutterberg:preferences`; the old `pdf-card-editor:preferences` is read once and removed. On Windows and
Linux the webview keeps its storage in a folder named `Gutterberg` (`app.appDirectoriesOverride` in `tauri.conf.json`;
the default would be named after the identifier). `src-tauri/src/data_dirs.rs` moves the old `dev.joaquinarruiz.gutterberg`
folder there once, before the webview opens, and never overwrites or merges into a `Gutterberg` that already exists.
macOS keeps its storage under the bundle identifier whatever the override says, so nothing moves there. The identifier
itself is not changed after a release: it is the app's identity for the installers, the updater and the `.gtr` file type.

The window (`PreferencesDialog`) has one section per subject: General (unit, language, decimals), Workspace (the views),
Layout (the panels of each tab), Display (theme, Live preview, rulers, the Select tool after a grid), AI Mode, Help (tour, tutorials, tips, shortcuts),
Updates and About (version, links, bug report, license). A setting shows one short line at most; a longer explanation
goes behind an InfoTip next to its title (`Field`'s `info`). A link into Preferences (a help tip's "Open Preferences")
names the section and the setting (`setPrefsOpen(true, section, target)`); the `Field` with that `target` scrolls into
view and pulses twice, then clears `prefsPulse`.

## Decisions

Decisions that shaped the product, so they are not re-argued by accident.

| Topic | Decision |
| --- | --- |
| Two tabs | Source and Print at the top of the window, not a popup. One engine behind both. |
| Piece sources | Pieces from any page, and from several PDFs (and images) in one project. |
| Quantities and order | Any quantity per piece; grouped or interleaved order. |
| Mixed sizes | Automatic size groups (their own sheets per size), with a switch for one shared grid sized to the largest piece. |
| Piece size | Pieces keep their size unless the user explicitly sets a real size or a percentage. Never scaled to fit; overflow is reported. |
| Shapes | Rectangles, optionally rotated. Round or custom shapes are not supported (a round token is marked and printed with its rectangle). |
| Messy scans | Supported: freeform rectangles with rotation, a per-piece turn so all face one way, drag to sort. Perspective correction is out of scope. |
| Words | Source / Print tabs; Original / Preview / Split views; the generic noun is **piece**. The glossary is in `AGENTS.md`. |
| Languages | English and neutral Latin American Spanish; decimal separator is a preference and number fields accept both. Number fields also take arithmetic (`src/lib/arithmetic.ts`: a small parser for `+ - * /` and parentheses, never `eval`). |
| Project file | `.gtr`, JSON with a `gutterberg-project` signature and a version, checked on open: not a project / older, migrate / newer, refuse. |
| Locked PDFs | Locked against printing or modifying: refused. Other restrictions: kept on the output. Never stripped. |
| AI | Optional, off and hidden by default; fixed prompts, no chat; a second engine behind the same button; results are editable proposals; keys only in the keychain; asks before sending to a server until told not to. |
| Command line | A separate binary, `gutterberg-cli`, with export and check only; settings change in the app. |
| Help tips | One catalog; tours point at the interface with React Joyride (MIT); shown at the moment of need, never as a long tour at first launch except the short welcome. |
| Images | Each import is a one-page-per-image PDF; pixels never resampled; the user picks the size, never stretched. |
| Logo | The logo for light backgrounds, a dark variant, and an app icon on a bone-coloured plate (not pure white). |
| License | PolyForm Noncommercial 1.0.0 in `LICENSE` (official text, unchanged). Personal and noncommercial use, changes and free forks are allowed; commercial use needs my permission. No warranty, no liability. |
| Versions | Semantic Versioning, tags `vX.Y.Z`, one place for the version (`package.json`); a tag builds a draft release and I publish it. |
| Updates | The Tauri updater from GitHub Releases; the toast obeys "Tell me about"; a beta channel is for later. |
| Signing | Builds are unsigned (no Apple or Windows certificate); the README explains the first-launch warnings. |
| Planning | A feature being built may have one brief in `docs/milestones/`; when done, what is worth keeping moves here, the user-facing change goes into `CHANGELOG.md`, and the brief is deleted. |
