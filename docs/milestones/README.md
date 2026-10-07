# Milestones

M1–M13, M18 and M20 are done (see the README status list). Each brief below is sized for one session and
leaves the app shippable. Follow `CLAUDE.md` in every milestone.

| # | Milestone | Size | Depends on |
| --- | --- | --- | --- |
| [M8](M8.md) | Foundations: CI, CSP, pinned pdfium | S | — |
| [M9](M9.md) | Render pipeline: open-document cache, stale-request skip, magnifier fix, selectors | M | M8 |
| [M10](M10.md) | Export correctness: page boxes, catalog cleanup, atomic save, limits, rotated pages | M | M8 |
| [M11](M11.md) | Document model: page include/skip, grid per page range, pre-flight, undo/redo | L | M10 |
| [M12](M12.md) | Sheet engine (Rust only): `extract_cards`, `paginate`, `export_sheets` | M | M11 |
| [M13](M13.md) | Print stage UI: Cards → Print switch, card library, quantities, sheet preview | L | M9, M12 |
| [M14](M14.md) | Project files, several PDFs and presets | M | M13 |
| [M15](M15.md) | Rename to Gutterberg, then distribution: installers, GitHub Releases, auto-update (outline) | M | M8 |
| [M16](M16.md) | Print features: cut marks, bleed, duplex (outline) | M | M12 |
| [M17](M17.md) | Auto-detect card grids and card outlines, locally (outline) | L | M11, M18 |
| [M18](M18.md) | Freeform cards: per-card rectangles, rotation, turn, sort, real size (done) | L | M13 |
| [M19*](M19.md) | AI Mode (optional): AI engine for card detection, page sorting, own API key | M | M17 |
| [M20](M20.md) | Hint system: catalog of help tips, `<HintToast hint=… />`, stepped hints, anchored tours with React Joyride | M | M13 |
| [M21](M21.md) | Terminology and languages: Source / Print, "pieces", English and Spanish, dot or comma decimals | M | M18, M20 |

\* Maybe: optional and not scheduled. The owner decides after M18 whether to build it.
  Don't start it or build anything for it unless asked.

M18, M20 and M21 were added after the rest were numbered. Suggested order from here: M21
(small), then M14, M16, M17, M15. The numbers are names, not the order.

## Direction: Cards → Print

The app is heading towards two stages in one window, switched from the toolbar:

- **Cards**: today's editor. Define where the cards are (grid per page or page range, skip
  non-card pages).
- **Print**: pick which cards go on which sheet (all cards in order by default, or a custom
  selection with a quantity per card), plus output spacing, page size and margins.

Today's re-space export is the Print stage's default plan ("all cards in order, sheet grid
= source grid"), so there is one engine, not two:

```
Source PDF → Cards stage → extract_cards → card library
          → Print stage (plan) → paginate → output sheets → export_sheets → PDF
```

## Decisions made by the owner

| Topic | Decision |
| --- | --- |
| Sheet builder UI | Cards / Print tabs at the top (not a popup dialog) |
| Card sources | Cards from any page, and from several PDFs (multi-PDF UI in M14) |
| Quantities and order | Any quantity per card; Grouped / Interleaved toggle |
| Mixed card sizes | Automatic size groups (own sheets per size), with a toggle to turn it off (shared grid, slots sized to the largest card) |
| Distribution | Stays at M15 |
| Name | The app becomes **Gutterberg**; the rename is step 0 of M15, before the first public build |
| Project file | `.gtr`, JSON starting with `"format": "gutterberg-project"` and a `version`; checked on open (not a project / older: migrate / newer: please update). Registered as a file association in M15 |
| Releases | Before the first public release: a license (leaning PolyForm Noncommercial, which includes a no-liability clause) or interim terms of use with a no-warranty disclaimer; ship third-party license notices, respect PDF permission flags (refuse locked files, never strip protection), and explain unsigned-build warnings if builds are unsigned (M15) |
| Help tips | One catalog of hints (`src/lib/hints.ts`), shown with `<HintToast hint=… />`; a hint is one step or a short tour; tours point at the UI with React Joyride (MIT) and advance on app events (M20) |
| Words | Tabs **Source / Print**; views **Original / Preview / Split**; the generic noun is **piece** (cards, tokens, tiles). Glossary in `CLAUDE.md`; renamed in M21 |
| Languages | English and neutral Latin American Spanish (`tú`), chosen in Preferences (System / English / Español); decimal separator is a preference (Automatic / Dot / Comma) and number fields accept both; Rust errors reach the UI as codes (M21) |
| Shapes | Pieces are rectangles (optionally rotated) for now; round or custom shapes are a possible later feature, not planned |
| Sidebar | Split per stage in M13 (output settings move to the Print tab), built from collapsible sections that remember their state |
| Messy scans | Supported: freeform per-card rectangles with rotation, a per-card turn so all cards face the same way, drag-to-sort (M18). Photos taken at an angle (perspective) are out of scope |
| Card size | Cards keep their size unless the user explicitly sets a real size or percentage. Never scaled automatically to fit |
| AI | Optional AI Mode (M19*): off by default and hidden when off; buttons with fixed prompts, no chat; AI is a second engine behind the same "Detect cards" button, results are always editable proposals. Decision after M18 |
| License | Undecided; the owner will choose later. No `LICENSE` file until then (all rights reserved) |
