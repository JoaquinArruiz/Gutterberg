# Milestones

M1–M14, M16 to M22 are done (see the README status list). Each brief below is sized for one session and
leaves the app shippable. Follow `CLAUDE.md` in every milestone.

| # | Milestone | Size | Depends on |
| --- | --- | --- | --- |
| [M8](M8.md) | Foundations: CI, CSP, pinned pdfium | S | — |
| [M9](M9.md) | Render pipeline: open-document cache, stale-request skip, magnifier fix, selectors | M | M8 |
| [M10](M10.md) | Export correctness: page boxes, catalog cleanup, atomic save, limits, rotated pages | M | M8 |
| [M11](M11.md) | Document model: page include/skip, grid per page range, pre-flight, undo/redo | L | M10 |
| [M12](M12.md) | Sheet engine (Rust only): `extract_cards`, `paginate`, `export_sheets` | M | M11 |
| [M13](M13.md) | Print stage UI: Source → Print switch, piece library, quantities, sheet preview | L | M9, M12 |
| [M14](M14.md) | Project files, several PDFs and presets (done) | M | M13 |
| [M15](M15.md) | Rename to Gutterberg, releases and updates (tag → build → release, in-app updates), license, README and examples, then the repo cleanup | L | M23, M24, M25 |
| [M16](M16.md) | Print features: cut marks, bleed, duplex (done) | M | M12 |
| [M17](M17.md) | Detect pieces on a page, locally (done) | L | M11, M18 |
| [M18](M18.md) | Freeform pieces: per-piece rectangles, rotation, turn, sort, real size (done) | L | M13 |
| [M19](M19.md) | AI Mode (done): AI engine for piece detection, page sorting, own API key | M | M17 |
| [M20](M20.md) | Hint system: catalog of help tips, `<HintToast hint=… />`, stepped hints, anchored tours with React Joyride | M | M13 |
| [M21](M21.md) | Terminology and languages: Source / Print, "pieces", English and Spanish, dot or comma decimals (done) | M | M18, M20 |
| [M22](M22.md) | UI consistency and polish (done): shared controls, AI buttons, info tips, movable Print panels, panel-height fix, Preferences icons and About | M | M19 |
| [M23](M23.md) | Logo and app icon: light, dark and on a bone-coloured plate; icons for every platform | S | M22 |
| [M24](M24.md) | Images as pieces: PNG, JPEG, WebP, with a size dialog, bleed, Fit / Fill and a resolution check | L | M14, M16 |
| [M25](M25.md) | Welcome tour from video clips, Preferences › Help (tour, tips, shortcuts) and "Found a bug?" with a GitHub issue form | M | M20, M22 |

M18 and M20–M25 were added after the rest were numbered. Order from here: M23, M24, M25, then M15 (last, before the first public release). The numbers are names, not the order.

## Direction: Source → Print

The app is two tabs in one window, switched from the toolbar:

- **Source**: the editor for the pages of the source PDFs. Define where the pieces are (grid per
  page or page range, skip pages with no pieces).
- **Print**: pick which pieces go on which sheet (all pieces in order by default, or a custom
  selection with a quantity per piece), plus the output gap, page size and margins.

Today's re-space export is the Print tab's default plan ("all pieces in order, sheet grid
= source grid"), so there is one engine, not two:

```
Source PDF → Source tab → extract_cards → piece library
          → Print tab (plan) → paginate → output sheets → export_sheets → PDF
```

## Decisions made by the owner

| Topic | Decision |
| --- | --- |
| Sheet builder UI | Source / Print tabs at the top (not a popup dialog) |
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
| AI | Optional AI Mode (M19): off by default and hidden when off (the one Preferences entry is the switch); buttons with fixed prompts, no chat; AI is a second engine behind the same "Detect pieces" button, results are always editable proposals; keys only in the system keychain |
| License | Undecided; the owner will choose later. No `LICENSE` file until then (all rights reserved) |
| Before the release | Logo (M23), images as pieces (M24) and the welcome tour (M25) come before M15 |
| Logo | Three variants: the owner's logo for light backgrounds, a dark variant, and the app icon on a bone-coloured plate (not pure white) (M23) |
| Images | Each import becomes a one-page-per-image PDF in the cache; pixels never resampled; the user picks the size, never stretched (M24) |
| Welcome and help | A clip-based welcome tour on first start, replayable from Preferences › Help, which also holds the help tips reset, the shortcuts and "Found a bug?" (GitHub issue form; Discord later) (M25) |
| Releases | Semantic Versioning, tags `vX.Y.Z`; a tag builds a draft release with tauri-action, the owner publishes it; notes from `CHANGELOG.md` (M15) |
| Updates | Tauri updater from GitHub Releases; Preferences › Updates shows the installed and available versions; a toast when one is available (filtered by "Tell me about": all / features / major / never) and another after updating; experimental features as switches; a beta channel later (M15) |
| Repo cleanup | Last step of M15: `docs/architecture.md`, `AGENTS.md` + one-line `CLAUDE.md`, `CONTRIBUTING.md`, a `pre-cleanup` tag, then the briefs are deleted; later features get one brief, deleted when done |
