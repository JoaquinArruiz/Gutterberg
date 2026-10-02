# PDF Card Editor

Desktop tool (Tauri + Rust + React/TS) that takes a Print-and-Play PDF whose cards
are packed edge to edge and re-exports it with a configurable gap between cards,
keeping the original card size and the original vector content.

## Status

- [x] **Milestone 1 – PDF spike** (`crates/card-core`)
- [x] **Milestone 2 – Tauri viewer** (open PDF, pdfium previews, thumbnails, page navigation)
- [x] **Milestone 3 – Selection / zoom / pan** (draw, move, resize; normalized coordinates)
- [x] **Milestone 4 – Grid** (rows, columns, grid overlay, exact card size in mm)
- [ ] Milestone 5 – Spacing preview
- [ ] Milestone 6 – Export wiring

## Architecture

`crates/card-core` has no UI/Tauri dependency; the Tauri app will wrap it.

- `layout::calculate_layout` – single source of truth for geometry. Produces
  `CardPlacement { source, destination }` (points, top-left origin). Preview and
  export both consume it. Cards are never scaled; a gap that doesn't fit the
  output page is an error.
- `export` – wraps each source page unmodified as a Form XObject and paints each
  card with `q 1 0 0 1 dx dy cm <rect> re W n /Src Do Q` (translate + clip, no
  rasterisation). `ExportJob` holds a grid per page, so mixed layouts are
  possible later.
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
| Select / Pan tool | `V` / `H` (or hold `Space` to pan temporarily, or middle-mouse drag) |
| Draw selection | drag on the page; drag the body to move, the handles to resize; click empty page to clear |
| Zoom | `+` / `-`, toolbar, or `Ctrl/Cmd` + wheel / trackpad pinch (zooms at the cursor) |
| Fit page | `0` |
| Pan | wheel / trackpad scroll |
| Pages | `PageUp`/`PageDown` or arrow keys |
| Exact values | Layout panel: columns, rows, card width/height (mm) and selection X/Y. Enter commits, Esc reverts, ↑/↓ nudge |

Geometry is stored normalized (0..1 of the page, top-left origin); all conversions live in
`src/lib/coordinates.ts` and `src/lib/units.ts`. Frontend unit tests: `pnpm test`.
