# Changelog

All notable changes to Gutterberg. Versions follow [Semantic Versioning](https://semver.org/);
the format follows [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Added

- Sticky edges (Source tab): while the grid region is drawn, moved or resized, and while an upright piece is moved or resized, its sides stick to the straight edges in the artwork (piece borders, cut lines, the sides of drawn boxes and pictures, and long contrast lines on a scan). An edge only pulls a side it runs along for at least half of its length, so art inside a piece does not. Ctrl/Cmd held still drags freely, and the sticky edges button next to the magnet turns it off. A help tip at that button explains it the first time a side sticks.
- Rulers (Source tab): the rulers button in the toolbar, or Ctrl/Cmd+R, shows rulers along the top and the left of the page in the Original view and the Original side of Split. They measure from the page's top-left corner in the unit chosen in Preferences (mm, cm or in), with ticks that follow the zoom (1, 5, 10 or 50 mm; 1/16 to 1 in) and a mark that follows the pointer. Off by default; when off they take no room.
- Guides (Source tab, with the rulers on): drag from the top ruler for a horizontal guide or from the left one for a vertical guide (Preferences › Workspace › Invert rulers swaps them, so each ruler gives the guide across it); its distance from the page's corner shows while it is dragged. With the Grid region or Piece tool, press on a guide to move it, or drag it back onto its ruler to delete it; the corner where the rulers meet has Clear guides. The grid region and the pieces snap to guides when the magnet is on. Guides are kept for the session, the same on every page of a PDF; they are not saved in the project.
- The keyboard shortcuts sheet lists Ctrl/Cmd+R and how to make, move and delete a guide.
- Arithmetic in number fields: every number field (sizes, gaps, positions, columns, rows, copies, pages, scale) takes `+`, `-`, `*`, `/` and parentheses, so typing `12/3` gives 4. The sum is worked out on Enter or when the field is left, in the unit shown, with a dot or a comma for decimals, and rounded to the decimals the field shows; the field's limits still apply. A sum that does not work out puts the old value back.

### Changed

- The magnet, sticky edges and rulers are together in their own group in the Source tab's toolbar, after the tools.
- Snapping is sticky: a side that snapped to the page, a piece or an edge stays there until the pointer has moved about 10 pixels on, so it is easier to land on and to leave. The corner of a grid region being drawn now snaps too.

## 0.14.0 (2026-10-14)

### Added

- More control on the page (Source tab): the arrow keys move the picked grid region or pieces 1 mm at a time (Shift: 10 mm; 0.05 and 0.5 in with inches), and change page only when nothing is picked. Shift-click picks several pieces, Ctrl/Cmd+A picks every piece of the page, and dragging one of them moves them all, which helps after Turn into pieces. Ctrl/Cmd+D duplicates the picked pieces and Alt-drag drags a copy. While dragging or resizing, the region and the pieces snap to the page's edges and middle and to each other, with a red guide line; hold Ctrl/Cmd to drag without it, or turn it off with the magnet in the toolbar. The Freeform pieces section sets the angle and size of every picked piece at once and deletes them together.
- A help tip the first time a grid region is drawn says how to drag it, nudge it and snap it.
- Gutterfold pairs can be cut apart instead of folded: Print › Duplex › Backs › Beside the front › Pairs › Cut apart puts each back next to its front with no fold line and cut marks around the front and the back each, so a set that is not double-sided can be laid out front-and-back and cut in one go. With a gap of 0 they share one cut. A back below its front stays upright, unless you turn it.
- Pair backs automatically… can take the backs from another PDF of the project (Backs in another PDF): page 1 of the fronts with page 1 of the backs, piece by piece, with the same mirrored and upside-down options. A backs PDF that is one single piece can be used as the common back of every front.
- Help tips can be turned off: Preferences › Help › Help tips has a “Show help tips” switch, and each tip has a small “Don't show tips” that turns it off and says where to turn it on again. With the switch off no tip or screen tour shows; the welcome tour still opens once and can be replayed. The button that brings tips back is now “Show closed tips again”.
- The keyboard shortcuts sheet (`?`, or Preferences › Help) lists the new controls: the arrow keys and Shift+arrows with a region or pieces picked, Shift-click, Ctrl/Cmd+A and Esc to pick, Ctrl/Cmd+D and Alt-drag to copy, and Ctrl/Cmd held to drag without snapping. The arrows are listed as changing page only with nothing picked, and the sheet now also lists the scroll wheel panning and Esc closing a help tip or a message. The sheet has a search field that stays at the top while the list scrolls, in the sheet (ready to type when it opens) and in Preferences › Help: it keeps the shortcuts whose text or keys match, in either language, ignoring case and accents (“ctrl”, “option”, “página”).

### Changed

- Projects are saved as version 6 (for cutting gutterfold pairs apart); older projects open as before, with their pairs folded, and an older Gutterberg asks to be updated.
- The update toast no longer installs: its “Update…” button opens Preferences › Updates with the Install button focused, next to “Skip this version”, so an update is always installed from where its notes are.
- Release notes scroll inside a box about 14 lines tall, for a newer version and for What's new after updating, so a long changelog no longer pushes the buttons out of view.
- Preferences › Updates › Tell me about is a menu, with the hint of the chosen choice under it.
- The welcome has no black bars at the sides of its clips: the clips are cropped to their 4:3 picture and shown on the left, with the title, text and buttons on the right (stacked, clip on top, on a narrow window), and the first-start choices fit their content.
- Text on the accent colour (primary buttons, the badge on a piece, ticked boxes) is white in the light theme, where black on the blue was 4.06:1, below the 4.5:1 WCAG AA asks for; the hover colour of primary buttons keeps that contrast. The dark theme keeps black.
- With no PDF open the toolbar shows only File, the panels menu and Preferences: the Source / Print tabs, tools, undo and redo, zoom, views and Export PDF appear once a PDF is open, and the status bar no longer says “No document” under the start screen.

## 0.13.0 (2026-10-13)

### Added

- Turn into pieces (Source sidebar › Layout): turns every cell of a page's grid into a piece of its own, at the same place and size, and clears the grid's region so you can draw the next grid. That is how a page with pieces of three sizes is marked: grid, turn into pieces, grid, turn into pieces, grid. A grid shared by several pages asks whether to turn this page only or all of them. The copies, turn, size, back and place in the order you gave each piece stay with it, and it is one undo step. A help tip says that a page can have a grid and pieces together.
- Size presets for the selected pieces (Print settings › Selected pieces › Size preset): the common sleeve sizes (poker, standard, mini American and European, European, Japanese, square, tarot), and your own, which you can save from the selection, rename and delete. A size can fix only the width or only the height, so "62 mm wide" keeps each piece's proportions. A size with both sides asks before it stretches a piece of other proportions, and applying one is a single undo step.
- A button in the sheet preview that shows each piece's reference on the sheet (`p3 · r1 c2`), the same one the piece library shows, so a piece on the sheet is easy to find. With several PDFs each gets a letter (A, B, …) that is shown in front of its references and in the library's filter menu. The references are only on screen, never in the exported PDF.
- A calibration sheet for duplex printing: Print › Duplex › Calibration sheet… saves a front and a back to print on both sides of one sheet of paper. Held up to a light, the crosshairs of the front cross the rulers of the back at the printer's drift between sides, and the two numbers read go into the back offset in one step.
- A link to RefractionHub on GitHub, with its logo, in Preferences › About.
- A log of what Gutterberg did at start and any error, so an app that closes by itself can be diagnosed. Preferences › Help › Copy log copies the end of it for a bug report, and the bug report form has a field for it. The log is added to at each start and kept small: about half a megabyte at most.

### Changed

- The size list of Add images is now the same list of sleeve sizes (it had three), and keeps the size you last used.
- On a Mac, Gutterberg now needs macOS 13 (Ventura) or later, which is what its PDF engine is built for; older Macs say so instead of failing when a PDF is opened.
- On Windows and Linux, Gutterberg's saved settings now live in a folder named `Gutterberg` instead of `dev.joaquinarruiz.gutterberg`. What was in the old folder is moved there the first time you start this version, so your settings, recent projects and tour progress stay.

### Fixed

- Deleting a piece drawn by hand no longer mixes up the height size of the pieces after it when a piece had its width and height set apart.

## 0.10.0 (2026-10-12)

### Added

- On the first start, the welcome begins with a short setup: language, theme and units (inches in the United States, millimetres elsewhere), applied at once and kept in Preferences.
- Pair backs automatically… in Print › Duplex: finds the back of every piece from where it is in the file (alternating pages, backs after fronts, or beside each other on the page), turns upside-down backs and prints only the fronts, in one step you can undo.
- Gutterfold sheets: Print › Duplex › Backs › Beside the front prints each back next to its front (to the right or below), with a dashed fold line, cut marks around the pair and an optional gap at the fold. With pairing, a double-sided file becomes gutterfold and a gutterfold file becomes double-sided.

### Changed

- The welcome tour is larger: its clips show up to 800 px wide, and smaller on a small window so everything still fits.
- A back you turn in the piece library is printed turned that much more, so a back that is upside down in the file can be set right.
- Projects are saved as version 5 (for the gutterfold settings); older projects open as before, and an older Gutterberg asks to be updated.
- Check for updates in Preferences › Updates now also shows the "update available" toast when it finds a newer version, whatever "Tell me about" says.
- Preferences › Updates says when the last check could not reach the update server, so a failed check no longer looks like "up to date".

### Fixed

- Turning on AI Mode (or closing any other window opened from Preferences) no longer closes Preferences, so you can enter your API key right away.
- With Live Preview off, its tip no longer hides the Print tab's help tips: the tour of the Print tab shows first, and the Live Preview tip after it.
- On a Mac with macOS older than 10.15 (Catalina), Gutterberg now says it needs a newer macOS instead of opening a blank window.

## 0.9.3 (2026-10-10)

Version 0.9.2 was skipped: it was never published, and everything planned for it is in this release.

### Added

- A chain icon next to a piece's width and height in Print › Selected pieces. Unlinked, the width and height are set separately (for example 63 × 90 mm), and the library, the sheets and the export show the piece at that size.
- More sheet sizes: A3, A5 and Tabloid / Ledger, next to A4, Letter, Legal, Same as source, Custom and Auto-fit. The sheet size is now the first setting of Print › Sheet.
- Before any piece is on it, the Print tab shows a white sheet of the chosen size, with its margins.

### Changed

- Projects are saved as version 4. Older projects open as before; Gutterberg 0.9.1 and earlier say a version 4 project needs a newer Gutterberg.
- The source and output gaps are linked and unlinked with a chain icon next to the fields, instead of a switch.
- The bug report form no longer has a field for attaching files, and Preferences › Help no longer asks for them.
- Each piece on an exported sheet is drawn through a frame the size of the piece, so PDF viewers draw sheets faster and most no longer flash the whole source page before the pieces appear. The file size stays the same.

### Fixed

- The web view's own right-click menu and shortcuts (reload, print, find…) no longer show up in the app (thanks to Pablo Antuña).
- Image pieces fit on the sheet: adding images while the sheet is "Same as source" (the size of one image) sets it to A4, or Letter where that is the usual paper, and says so. Image pieces never use a sheet the size of their source.

## 0.9.1 (2026-10-10)

### Fixed

- A PDF locked with AES-256 encryption (what current tools write) shows its red lock as soon as it opens. The export already refused it.
- Pages, thumbnails and pieces show in the installed app (Windows, macOS and Linux) instead of broken images.
- The welcome tour's clips play in the Linux app, instead of showing a black box. A clip that still cannot play shows its last frame.

## 0.9.0 (2026-10-10)

The first public release. Gutterberg takes a print-and-play PDF whose pieces are packed edge to edge and gives
every piece its own space, at its exact size, with the original artwork untouched.

### Added

- Source tab: mark the pieces of a page with a grid or one by one with the Piece tool (move, resize, rotate), in mm, cm or inches; skip pages, give page ranges their own grid and save grids as presets.
- Detect pieces proposes the grid or the rectangles of a page, from the PDF's own objects, repeating edges or the shapes in a scan; nothing changes until you apply it.
- Original, Preview and Split views, with the source gap, output gap, margins and page size.
- Print tab: a piece library from several PDFs, copies per piece, auto-fill, turning, sorting by dragging and an explicit real size or percentage per piece. Pieces never shrink to fit; overflow is reported.
- Cut marks, bleed, and duplex printing with a common back or a back per piece.
- PNG, JPEG and WebP images as pieces, never resampled unless you ask, with a warning for soft images.
- `.gtr` project files that find their PDFs again even if they moved; double-clicking one opens Gutterberg.
- Export keeps the vector content, and refuses PDFs whose publisher forbids printing or changes.
- Optional AI Mode, off and hidden by default, for Detect pieces and Sort pages with your own key.
- English and Spanish, a welcome tour, help tips, a keyboard shortcuts sheet and a bug report form.
- Updates from Preferences › Updates, with a notice when a new version is out.

Builds are not code-signed: the first launch shows a warning on macOS and Windows (see the README).
