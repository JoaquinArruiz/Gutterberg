# Gutterberg

Gutterberg turns print-and-play PDFs and card scans into cut-ready sheets: exact card sizes, clean gutters, and the
original artwork untouched.

Desktop app (Tauri 2 + Rust + React 19/TypeScript) that takes a print-and-play PDF whose pieces (cards, tokens,
tiles) are packed edge to edge and re-exports it with configurable spacing, keeping the original piece size and
vector content. See `README.md` for what it does, `docs/architecture.md` for how it is built and why, and
`docs/controls.md` for the controls.

This file is read by AI coding tools and is the shared set of rules for everyone who works on the code, people
included. `CONTRIBUTING.md` is the human version.

## Layout

- `crates/card-core/`: geometry, layout, the sheet engine, PDF export (lopdf), rendering (pdfium-render),
  detection, images and the project file. No Tauri or UI dependency.
- `crates/card-ai/`: the optional AI Mode: provider adapters, prompts and reply checks. The only crate that sends
  a user's data over the network.
- `src-tauri/`: Tauri shell; `src/commands/*` are thin IPC wrappers around `card-core`. It also holds the updater
  plugin, the other thing that uses the network: it sends nothing but the request for `latest.json` and the
  download of a new version.
- `src/`: React frontend. Stores in `src/stores/` (Zustand), helpers in `src/lib/`, components in
  `src/components/`, texts in `src/locales/`.
- `docs/`: `architecture.md` (how it fits together), `controls.md`, `releasing.md` (how a version is released).
  `docs/milestones/` holds the brief of a feature while it is being built (see "Planning" below).
- `examples/`: sample PDFs, with a guide in `examples/README.md`.

## Commands

```sh
pnpm install
scripts/fetch-pdfium.sh        # pdfium into src-tauri/resources/pdfium (pnpm tauri dev runs it when it is missing)
pnpm tauri dev                 # run the app

pnpm lint                      # Biome
pnpm typecheck
pnpm test                      # Vitest
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo test --workspace         # render tests need pdfium (PDFIUM_LIB_PATH=<dir>)
```

Run all of them before proposing a commit.

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
- A user-facing change goes into `CHANGELOG.md` under `Unreleased` (Added, Changed or Fixed).

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

User-facing text lives in `src/locales/en.json` and `src/locales/es.json`: add
every new string to both, never hard-code text in components. Spanish is neutral Latin
American Spanish (`tú`, no voseo, no `vosotros`); I review it.

Pieces are rectangles (optionally rotated). Round or custom shapes are not supported; a round
token is marked and printed with its rectangle.

## Repository rules

These apply to everyone, whether a person or an AI tool is writing the change.

- The package manager is **pnpm**. Never use npm or npx; use `pnpm exec` for one-off tools.
- Commit messages are **one sentence** that says what the change does, for example "Stop native selection
  highlight while dragging on the page canvas".
- Work goes **feature branch → version branch → `main` → tag** (see "Branches and releases" below). Nobody commits
  to `main` or to a `release/*` branch directly, once I have turned on that protection.
- No AI tool is an author or co-author: no `Co-Authored-By` lines, no session links, and no tool's name in commit
  messages, branch names, code or docs. CI fails a push or pull request that has one (`scripts/check-authorship.sh`);
  check `git config user.name` and `user.email` before you commit, since a tool's default identity counts.
- Docs, comments and pull request texts speak as the maintainer in the first person ("I tag `main`"), never about
  "the owner".
- Do not commit, push, create branches or open pull requests unless you were asked to. When asked, branch from the
  version branch the work belongs to, with the names below.
- The project is under the PolyForm Noncommercial License 1.0.0 (`LICENSE`). Never change the `LICENSE` file, and add
  no license headers to source files.

## Branches and releases

```
feature/<name> or fix/<name>  →  release/<x.y.z>  →  main  →  tag v<x.y.z>  →  GitHub release
```

- **One branch per feature or bug fix**, named `feature/<what>` or `fix/<what>` (lowercase, hyphens), started from the
  version branch it belongs to. The name says what it does; it never names a tool, a person or a session.
- **One version branch per release**, `release/<x.y.z>` (for example `release/0.12.0`), started from `main`. Its
  brief in `docs/milestones/` lives on it. Keep it short-lived, and merge `main` into it before it goes to `main`.
- **A feature or fix merges into its version branch with a pull request, squashed**: the pull request title is the
  commit message, one sentence. CI must pass. Merge features one at a time and update your branch from the version
  branch first, since `CHANGELOG.md` (Unreleased) and the version numbers in `docs/milestones/roadmap.md` are shared.
- **The version branch merges into `main` with a pull request and a merge commit**, so a version is one unit in the
  history. Its last commit is "Release x.y.z": the version in `package.json` and `src-tauri/Cargo.toml`, and the
  `CHANGELOG.md` heading (see `docs/releasing.md`).
- **I tag `main`**, with a signed tag (`git tag -s v<x.y.z>`), which builds the release.
- **A fix for a released version** is `fix/<what>` merged into `release/<x.y.z+1>` (a patch version branch started
  from `main`), then into `main` the same way. Merge `main` back into any version branch that is open.
- A tool working here uses these names and these rules like anyone else, and never adds its own name to a branch,
  commit, pull request, tag or file.

## Planning

A feature that is being built may have one brief in `docs/milestones/` (for example `images-v2.md`): the goal, the
steps and what is out of scope. When the feature is done, what is worth keeping moves into `docs/architecture.md`,
its user-facing change goes into `CHANGELOG.md`, and the brief is deleted in the same pull request. Briefs are
working notes, not documentation.
