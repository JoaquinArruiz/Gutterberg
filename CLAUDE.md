# PDF Card Editor

Desktop app (Tauri 2 + Rust + React 19/TypeScript) that takes a Print-and-Play PDF whose
cards are packed edge to edge and re-exports it with configurable spacing, keeping the
original card size and vector content. See `README.md` for features and controls.

## Layout

- `crates/card-core/`: geometry, layout, PDF export (lopdf) and rendering (pdfium-render).
  No Tauri or UI dependency.
- `src-tauri/`: Tauri shell; `src/commands/*` are thin IPC wrappers around `card-core`.
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
- Cards are never scaled, and content is never rasterised on export.
- UI coordinates are normalized (0..1 of the page, top-left origin); `layout.rs` works in
  points with a top-left origin. Every conversion goes through `src/lib/coordinates.ts` or
  `src/lib/units.ts`.
- Zustand: read stores with per-field selectors (`useXStore((s) => s.field)`), never
  `useXStore()` whole.
- Match the surrounding code's style and comment density. Add tests next to the code they
  cover (`*.test.ts`, `crates/card-core/tests/`).
- When a milestone is finished, tick it in the README status list and update its brief if
  the plan changed.

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
- Do not add a `LICENSE` file or license headers; the owner will choose the license later.
