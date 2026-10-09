# Gutterberg

Gutterberg turns print-and-play PDFs and card scans into cut-ready sheets: exact card sizes, clean gutters, and the original artwork untouched.

Desktop app (Tauri 2 + Rust + React 19/TypeScript) that takes a Print-and-Play PDF whose
cards are packed edge to edge and re-exports it with configurable spacing, keeping the
original card size and vector content. See `README.md` for features and `docs/controls.md` for controls.

## Layout

- `crates/card-core/`: geometry, layout, PDF export (lopdf) and rendering (pdfium-render).
  No Tauri or UI dependency.
- `crates/card-ai/`: the optional AI Mode (M19): provider adapters, prompts and reply checks. The only
  crate that sends a user's data over the network.
- `src-tauri/`: Tauri shell; `src/commands/*` are thin IPC wrappers around `card-core`. It also holds the
  updater plugin, the other thing that uses the network: it sends nothing but the request for
  `latest.json` and the download of a new version.
- `src/`: React frontend. Stores in `src/stores/` (Zustand), helpers in `src/lib/`,
  components in `src/components/`.
- `docs/milestones/`: one brief per upcoming milestone. When asked to "do M<n>", read
  `docs/milestones/M<n>.md` and follow it.

## Commands

```sh
pnpm install
scripts/fetch-pdfium.sh        # pdfium into src-tauri/resources/pdfium
pnpm tauri dev                 # run the app

pnpm lint                      # Biome
pnpm typecheck
pnpm test                      # Vitest
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo test --workspace         # render tests need pdfium (PDFIUM_LIB_PATH=<dir>)
```

Run all of them before proposing a commit. Until M8 lands, `cargo fmt` and `clippy` may
report existing issues; don't let them hide new ones.

## Code rules

- Geometry lives only in `card-core`. `layout::calculate_layout` is the single source of
  truth for preview and export. The frontend never re-derives layout maths; it calls the
  Rust engine over IPC and draws the result.
- Cards keep their size unless the user explicitly changes it. The default is 100%;
  scaling is only an explicit, visible per-card or per-group setting ("real size" in mm, or
  a percentage), never applied automatically to make cards fit. Overflow is reported,
  never fixed by shrinking.
- Content is never rasterised on export. Rotation, translation and scaling are PDF
  transformation matrices on the original content.
- UI coordinates are normalized (0..1 of the page, top-left origin); `layout.rs` works in
  points with a top-left origin. Every conversion goes through `src/lib/coordinates.ts` or
  `src/lib/units.ts`.
- Zustand: read stores with per-field selectors (`useXStore((s) => s.field)`), never
  `useXStore()` whole.
- Match the surrounding code's style and comment density. Add tests next to the code they
  cover (`*.test.ts`, `crates/card-core/tests/`).
- When a milestone is finished, add its user-facing changes to `CHANGELOG.md` (Unreleased) and update
  its brief if the plan changed.

## Glossary (words the user sees)

Use these in every label, hint, message and doc. Internal names (`CardId`, `card-core`, file
and type names) stay as they are.

| Use (English) | Español (neutral) | Meaning | Not |
| --- | --- | --- | --- |
| **Source** tab | **Origen** | Working on the pages of the source PDFs: mark where the pieces are, skip pages | "Cards" tab |
| **Print** tab | **Imprimir** | Choosing what goes on the sheets, and exporting | |
| **Original / Preview / Split** | **Original / Vista previa / Dividida** | The views inside the Source tab: the page as it is, the re-spaced result, both | "Source / Output" views |
| **piece** | **pieza** | Anything cut out of a page: a card, token, tile, board segment | "card" (except in examples, e.g. "poker cards") |
| **piece library**, **piece tool**, **freeform pieces** | **biblioteca de piezas**, **Herramienta Pieza**, **piezas libres** | The Print tab's list, the tool that draws one piece, pieces drawn one by one | card library, card tool, freeform cards |
| **sheet** | **hoja** | One page of the output PDF | "output page" in the UI |
| **source gap / output gap** | **separación de origen / separación de salida** | Space between pieces already in the PDF / wanted in the output | |
| **help tip** | **consejo** | A hint toast or tour step | |
| **front / back** | **frente / dorso** | The two sides of a piece, and of a duplex sheet | obverse / reverse, face |
| **cut marks** | **marcas de corte** | Lines on the sheet that show where to cut | crop marks, trim marks |
| **bleed** | **sangrado** | Art that extends past a piece's edge | |
| **AI Mode** | **Modo IA** | The opt-in setting that adds AI buttons, using the user's own key; off and hidden by default | AI assistant, chat |
| **proposal** | **propuesta** | What Detect pieces offers: shown as a draft on the page, applied only when the user says so | result, guess |

User-facing text lives in `src/locales/en.json` and `src/locales/es.json` (from M21): add
every new string to both, never hard-code text in components. Spanish is neutral Latin
American Spanish (`tú`, no voseo, no `vosotros`); the owner reviews it.

Pieces are rectangles (optionally rotated). Round or custom shapes are not supported; a round
token is marked and printed with its rectangle.

## Git and tooling rules (set by the owner)

- The package manager is **pnpm**. Never use npm or npx; use `pnpm exec` for one-off tools.
- Commit only when the owner tells you to. Show the proposed commit message first and wait
  for approval. The message is a single sentence, e.g.
  "Stop native selection highlight while dragging on the page canvas".
- Do not push unless the owner says so.
- Commit as `Cac0 <joaquinarruiz@gmail.com>`. Never add Claude as author or co-author, and
  never put Claude's name in commit messages, branch names, code or docs. No
  `Co-Authored-By` or session-link lines.
- Do not create branches or pull requests unless asked.
- The project is under the PolyForm Noncommercial License 1.0.0 (`LICENSE`). Never change the
  `LICENSE` file, and add no license headers to source files.
