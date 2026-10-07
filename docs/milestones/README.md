# Milestones

M1–M7 are done (see the README status list). Each brief below is sized for one session and
leaves the app shippable. Follow `CLAUDE.md` in every milestone.

| # | Milestone | Size | Depends on |
| --- | --- | --- | --- |
| [M8](M8.md) | Foundations: CI, LICENSE, CSP, pinned pdfium | S | — |
| [M9](M9.md) | Render pipeline: open-document cache, stale-request skip, magnifier fix, selectors | M | M8 |
| [M10](M10.md) | Export correctness: page boxes, catalog cleanup, atomic save, limits, rotated pages | M | M8 |
| [M11](M11.md) | Document model: page include/skip, grid per page range, pre-flight, undo/redo | L | M10 |
| [M12](M12.md) | Sheet engine (Rust only): `extract_cards`, `paginate`, `export_sheets` | M | M11 |
| [M13](M13.md) | Print stage UI: Cards → Print switch, card library, quantities, sheet preview | L | M9, M12 |
| [M14](M14.md) | Project files and presets | M | M13 |
| [M15](M15.md) | Distribution: installers, GitHub Releases, auto-update (outline) | M | M8 |
| [M16](M16.md) | Print features: cut marks, bleed, duplex (outline) | M | M12 |
| [M17](M17.md) | Auto-detect the card grid (outline) | L | M11 |

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
