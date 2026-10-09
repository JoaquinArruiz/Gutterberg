# Controls

| Action | Input |
| --- | --- |
| Grid region / Piece / Pan tool | `V` / `C` / `H` (or hold `Space` to pan temporarily, or middle-mouse drag) |
| Draw selection | drag on the page; drag the body to move, the handles to resize; click empty page to clear |
| Draw freeform pieces (Piece tool) | drag on the page for each piece; drag a piece to move it, its handles to resize, the dot above it to rotate (`Shift` snaps to 15°); `Delete` removes the picked piece; the Freeform pieces section in the Source sidebar has its angle and size |
| Zoom | `+` / `-`, toolbar, or `Ctrl/Cmd` + wheel / trackpad pinch (zooms at the cursor) |
| Fit page | `0` |
| Pan | wheel / trackpad scroll |
| Pages | `PageUp`/`PageDown` or arrow keys |
| Source \| Print | tabs in the toolbar. Print: piece library (click, Ctrl/Cmd-click, Shift-click; Copies field and steppers), sheet preview (the sheet in front is always live) with a hideable row of sheet thumbnails (follows Live Preview, with a refresh button when it is off), and the print settings with Plan, Sheet and Page sections that fold (and remember it) |
| Move the panels | Panels menu in the toolbar, a panel's own menu, or Preferences › Workspace: put each panel on the left, right, top or bottom, or hide it. The Source tab has Pages and Properties around the page; the Print tab has the Piece library and the Print settings around the sheets. Each tab keeps its own layout and sizes, and the Print settings only go left or right |
| Turn, size and sort pieces (Print tab) | piece library: `R` / `Shift+R` turn the selection 90° right / left, "Make all portrait / landscape"; drag pieces to reorder them (the sheets follow); the Selected pieces section of the print settings sets a real size (e.g. 63 × 88 mm) or a percentage, and scaled pieces carry a badge |
| Projects | File menu: New project (`Ctrl/Cmd+N`), Open PDF (`Ctrl/Cmd+O`), Open project (`Ctrl/Cmd+Shift+O`), Add PDF, Save (`Ctrl/Cmd+S`), Save as (`Ctrl/Cmd+Shift+S`) and the recent projects. A project is a `.gtr` file with the page groups, freeform pieces, turns, sizes, order, print plan and output settings of every PDF; it points at the PDFs instead of holding them, and asks where a PDF went if it moved |
| Images as pieces | File › Add images… (or the Add images button in the Source tab's page panel, "Start from images" on the start screen, or dropping image files on the window): PNG, JPEG or WebP, one piece per image, the size chosen once in a dialog. An import is one document named after its first image (rename it with the pencil next to the name) |
| Several PDFs | "Add PDF…" in the page panel adds a PDF to the project; the dropdown above the pages switches the PDF being edited. The piece library shows the pieces of all of them (filter by PDF or group), and the Print tab puts them on the same sheets. The Source tab's export is for the PDF being edited |
| Grid presets | Presets section of the Source sidebar: save the viewed group's rows, columns and source gap under a name, apply it to any other page group. Presets belong to you, not to a project |
| Skip a page / include it | checkbox on its thumbnail (skipped pages are left out of the export) |
| Different grid for some pages | draw the grid on a page, then "Apply this grid to…" (this page, a range, all pages of the same size); edits then apply to the group the viewed page belongs to |
| Undo / redo | `Ctrl/Cmd+Z` / `Shift+Ctrl/Cmd+Z` (also `Ctrl+Y`), or the toolbar buttons. One history for everything, including the Print plan (copies and plan settings): it undoes the last change made in either tab; a whole drag is one step |
| Welcome tour and Help | The welcome tour opens by itself once, over the start screen (Skip, `Esc` or Get started close it for good). Replay it from the start screen or Preferences › Help, which also brings the help tips back, lists every shortcut, copies the app info (version, system, language, pdfium) and opens the GitHub bug report form with the version and system filled in |
| Keyboard shortcuts | `?`, or File › Keyboard shortcuts…: every shortcut by area, in the app's language |
| Start screen | With nothing open: Open PDF, Open project and the recent projects |
| Exact values | Source layout section: columns, rows, piece width/height and selection X/Y. Enter commits, Esc reverts, ↑/↓ nudge. Type `63.5` or `63,5`: both work whatever the decimal separator preference says |
| Language and numbers | Preferences (`Ctrl/Cmd+,`) › General: Language (System / English / Español) and Decimal separator (Automatic / Dot / Comma) |

Geometry is stored normalized (0..1 of the page, top-left origin); all conversions live in
`src/lib/coordinates.ts` and `src/lib/units.ts`. Frontend unit tests: `pnpm test`.
