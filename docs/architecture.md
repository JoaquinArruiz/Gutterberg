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
| `card-ai` | `crates/card-ai/` | The optional AI Mode: provider adapters, prompts, reply checks. The only crate that sends a user's data over the network. |
| Tauri shell | `src-tauri/` | The window and the glue. `src/commands/*` are thin IPC wrappers around `card-core` and `card-ai`; it also owns the system keychain, the updater, the file association and the render thread's state. |
| Frontend | `src/` | React 19 and TypeScript. Zustand stores in `src/stores/`, pure helpers in `src/lib/`, components in `src/components/`, texts in `src/locales/`. |

The dependency runs one way: the frontend knows the IPC commands, the commands know the crates, and `card-core`
knows nothing of Tauri. That is what keeps the engine testable on its own (`crates/card-core/tests/`).

The updater plugin is the only network use besides `card-ai`. It sends nothing but the request for `latest.json`
and the download of a new version.

## The engine (`card-core`)

### Pieces and page groups (`card`)

A piece is identified by a `CardId`: a grid piece (document, page, row, column) or a freeform piece (document,
page, index), always carrying its `DocumentId` so several PDFs can share a project. An `OrientedRect` is a piece's
source area, rotated about its centre; grid pieces have an angle of 0. The pages of a document are covered by
`PageGroup`s with no gaps: `grid` (pages, rows, columns, a selection), `skip`, and `freeform`. Edits apply to the
group the viewed page belongs to; "Apply this grid to…" copies a grid onto other pages as separate groups.

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
3. **Finish** (`finish`). Cut marks, bleed and duplex backs are added to the planned sheets. With everything off the
   sheets pass through untouched, and the exported content stream is the same as before.
4. **Export** (`export`). `export_sheets` builds a PDF from any list of sheets and several source documents.

The plan the Print tab runs is `plan_print`: either `SameAsSource` (each grid page becomes one sheet through
`calculate_layout`, byte-identical to what the Source tab exports) or `plan_sheets` with a sheet grid, copies and
auto-fill. `card_transform` (and `card_transform_xy` for two factors) is the one place that does the matrix maths for
placing a piece: `R(turn) · S(scale, scale_y) · R(-source angle)` about the piece's centre, then move the centre onto
its slot. The piece is stretched along its own sides before it is turned; with equal factors it is a plain rotation
and scale.

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
- The file is written to a temporary file in the output folder and renamed, so a failed export leaves nothing, and
  the output may never be the file that is open.
- `validate_export` and `validate_sheets` run the same checks without writing, one `PageIssue` per failing page
  (with its document, an error code and its values). The interface lists them before the save dialog opens.

### Finishing (`finish`)

- **Cut marks:** ticks in the margins at every piece edge, or lines down the middle of each gap (too narrow a gap
  gives a warning and no line). Drawn as strokes, last.
- **Bleed:** taken either by mirroring each piece's own edge (4 strips and 4 corners, as vectors, using the piece's
  oriented edge so tilted pieces work) or from the gap that is already in the source. A bleed bigger than half a piece
  is an error; a source gap smaller than the bleed is a page issue that blocks export.
- **Duplex:** backs are mirrored left to right for a long-edge flip on a portrait sheet (or a short-edge flip on a
  landscape one), otherwise top to bottom, with the back's turn adjusted so a front corner and its back corner pair
  up. A common back or a back per piece, with an X/Y offset for printer drift.

### Permission flags (`access`)

A PDF's publisher may lock it. A PDF locked against printing or modifying is refused (`PdfLocked`) before anything
is written, from the pre-flight check, and the interface shows a lock badge from the moment the file is opened. Any
other restriction (for example no copying) is kept: the output is encrypted (AES-128, opens without a password)
with the same flags, or the most restrictive of them when several PDFs share the sheets. A PDF without restrictions
exports as before. The badge reads the flags through pdfium; the export reads them through `lopdf`.

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

**Detect pieces** proposes where the pieces are on the viewed page, locally. It returns proposals, best first, each
a grid or a list of rectangles with a confidence, the engine that found it and notes (missing cells, crop marks,
uneven sizes...). Three engines run in order, and the search stops at a confidence of 0.85:

1. **Objects:** the page's images and four-corner paths, read from their own points, gridded by clustering lefts and
   tops. Exact when the pitch is regular. Inside a form it only reads when the form is the page's single form.
2. **Edges:** a grey render, profiles of the gradient, peaks merged when closer than 1.2 mm, a regular comb found by
   autocorrelation and least squares, tried as touching pieces and as pieces with a gap.
3. **Blobs:** for scans: foreground by Otsu against the page border's median, morphological clean-up, connected
   components, and each blob's convex hull and minimum-area rectangle, so tilted pieces come out straight.

A proposal is never applied by itself. It is a draft drawn on the page (dashed outlines, its confidence and engine in
words) that the user applies in one undo step, steps through ("Next proposal") or discards. The weights were tuned
on generated fixtures; they are constants at the top of each engine.

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
  the new number makes an older Gutterberg say "please update" instead of failing on them); the current version is 4. A change to the format adds a version and a migration with a test file.
- **Opening is all or nothing.** The file is checked and every PDF found (by hash, so a moved PDF is recognised, and
  the user is asked "Where is this file now?" if it is gone) before any store changes. A PDF whose page count no
  longer fits its saved groups gets that PDF's layout reset, with a notice.
- The interface's model is camelCase with normalised coordinates, not the Rust shapes; `src/lib/project.ts` has the
  Zod schema and clamps out-of-range values back into what the interface allows.
- The file association (`.gtr`, type `dev.joaquinarruiz.gutterberg.project`) opens a project at startup (command-line
  argument on Windows and Linux, the "opened" event on macOS) through the same open path, with the same checks.

## Coordinates and units

The interface works in normalised coordinates (0 to 1 of the page, top-left origin); `layout.rs` works in points
with a top-left origin. Every conversion goes through `src/lib/coordinates.ts` or `src/lib/units.ts`; mm and points
convert with `pt = mm * 72 / 25.4`. Numbers shown follow the user's unit (mm, cm, inches) and decimal separator
(`formatDecimal`/`parseDecimal` in `lib/measurement.ts`: one `.` or `,`, no thousands separators or exponents).

## The interface (`src/`)

**Two tabs, one engine.** The Source tab edits the pages of the source PDFs (where the pieces are, which pages to
skip) and shows the page as it is (**Original**), the re-spaced result (**Preview**) or both (**Split**). The Print
tab chooses what goes on the sheets (the piece library, copies, order, the sheet and page, marks, bleed, duplex) and
exports. The Source tab's own export is the Print tab's default plan.

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
is off stay visible. AI actions are their own buttons, with a spark in the AI colour.

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
toast. Dismissals are stored with the hint's version, so a changed tip can come back; "Reset help tips" brings them all
back. Tips can be turned off for good, so messages that matter (an update, how an update went) are not tips: they use
the general toast (`Toast`), a queue that shows one at a time.

The **welcome tour** is four short clips (masters in `assets/welcome/`, encoded by `scripts/encode-welcome.sh` into
`public/welcome/`) in a dialog that opens once over the start screen. Help tips wait while it is open. Preferences ›
Help holds the tour, the tip reset, the shortcuts and "Found a bug?", which copies the app info or opens the GitHub
issue form after asking, with the version and system filled in.

## Languages (`i18n`)

English and neutral Latin American Spanish (`tú`), chosen in Preferences (System, English, Español), with the decimal
separator a separate preference (Automatic, dot, comma). Every user-facing text is a key in `src/locales/en.json` and
`es.json`, typed so a wrong key is a compile error; a test checks both files have the same keys and placeholders.
Components use `useTranslation`; stores and `lib` code use the exported `t`, and keep errors as data so a message on
screen changes language with the app.

## AI Mode (`card-ai`)

Optional, off and hidden by default (the one Preferences entry is the switch). Buttons with fixed prompts, no chat:
**Detect with AI** is a second engine behind the Detect pieces button, and **Sort pages** labels every page (cards,
backs, rules, cover, other) and offers to skip the ones without pieces. A result is always an editable proposal.

- **Providers:** Anthropic, OpenAI-compatible, Gemini and Ollama, behind one request shape. Replies are validated
  (inside the page, plausible sizes and counts, every page labelled exactly once); an unusable reply changes nothing.
- **The switch is checked in Rust.** `Gate` is set from the preference and checked before the keychain is read and
  before anything is sent, so a stale interface cannot send while it is off (tested with a local listener).
- **Keys** live only in the system keychain (`keyring`: Keychain, Credential Manager, Secret Service), written and
  read in Rust. The interface can ask whether a key exists, set it and delete it; it can never read it. A keychain
  that fails means AI Mode cannot send; there is no fallback.
- **Every action asks first** (provider, server, whether pages go as pictures or text, requests, tokens, cost when
  known) and sends nothing until the user says so. Only plain `http://` to local or private addresses is accepted.
- Requests carry a page summary (sizes and object boxes, or a page image if the user allows it), never the PDF.

## Updates and releases

A tag such as `v1.1.0` builds the app for Windows, macOS (Apple silicon and Intel) and Linux with `tauri-action`, and
leaves a draft GitHub release with the installers, their updater signatures, `latest.json` and the notes from
`CHANGELOG.md`; publishing the draft is what makes installed apps see it. The owner's steps are in
[releasing.md](releasing.md). Builds are not code-signed; the updater verifies downloads with its own key.

In the app, the Tauri updater checks about 10 seconds after start, at most once a day and never during an export; a
failed or offline check is silent. Preferences › Updates shows the installed and the newer version with its notes and
the "Tell me about" setting (all updates, new features, major versions only, never), which only decides the toast. The
logic that needs no app (version order including pre-releases, who is told about what, what to say after an update) is
in `src/lib/updates.ts`; `update-actions.ts` talks to the plugins. Before installing, the version is written down so
the next start can say whether it worked. Experimental features are switches listed in `src/lib/experimental.ts`.

Third-party notices are collected at release time (`scripts/third-party-licenses.mjs`: `cargo about`, `pnpm
licenses`, and the licenses pdfium ships with) into `THIRD_PARTY_LICENSES`, built into the app and shown in
Preferences › About with Gutterberg's own license.

## Preferences

One versioned model (`src/lib/preferences.ts`), kept in the webview's storage. `normalizePreferences` is the only way
raw data becomes preferences: it merges onto the defaults, drops invalid values and repairs invariants, so the rest
of the app never sees an invalid state. A newer version's added setting appears with its default for existing users,
and a migration only exists where meaning changed. Document settings (gaps, page, margins) are never preferences.
The key is `gutterberg:preferences`; the old `pdf-card-editor:preferences` is read once and removed. The
application's identifier decides where the webview stores data, so it is not changed after a release.

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
| Languages | English and neutral Latin American Spanish; decimal separator is a preference and number fields accept both. |
| Project file | `.gtr`, JSON with a `gutterberg-project` signature and a version, checked on open: not a project / older, migrate / newer, refuse. |
| Locked PDFs | Locked against printing or modifying: refused. Other restrictions: kept on the output. Never stripped. |
| AI | Optional, off and hidden by default; fixed prompts, no chat; a second engine behind the same button; results are editable proposals; keys only in the keychain; every action asks first. |
| Help tips | One catalog; tours point at the interface with React Joyride (MIT); shown at the moment of need, never as a long tour at first launch except the short welcome. |
| Images | Each import is a one-page-per-image PDF; pixels never resampled; the user picks the size, never stretched. |
| Logo | The logo for light backgrounds, a dark variant, and an app icon on a bone-coloured plate (not pure white). |
| License | PolyForm Noncommercial 1.0.0 in `LICENSE` (official text, unchanged). Personal and noncommercial use, changes and free forks are allowed; commercial use needs the owner's permission. No warranty, no liability. |
| Versions | Semantic Versioning, tags `vX.Y.Z`, one place for the version (`package.json`); a tag builds a draft release and the owner publishes it. |
| Updates | The Tauri updater from GitHub Releases; the toast obeys "Tell me about"; a beta channel is for later. |
| Signing | Builds are unsigned (no Apple or Windows certificate); the README explains the first-launch warnings. |
| Planning | A feature being built may have one brief in `docs/milestones/`; when done, what is worth keeping moves here, the user-facing change goes into `CHANGELOG.md`, and the brief is deleted. |
