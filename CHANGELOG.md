# Changelog

All notable changes to Gutterberg. Versions follow [Semantic Versioning](https://semver.org/);
the format follows [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Fixed

- Sheets made from several PDFs keep every PDF's title, author and copyright notice. Before, only the first PDF's were kept, so the file named one author for everyone's pieces.

## 1.2.0 (2026-10-21)

1.2.0 is about where Gutterberg comes from and what it says to the internet. On Windows it is now on the Microsoft Store, which installs it without the SmartScreen warning and keeps it up to date. Setting Tell me about to Never now really means the app never checks for updates by itself, and a privacy policy says in one place what the app sends and where.

### Added

- Gutterberg for Windows is on the Microsoft Store too. The Store copy installs without the SmartScreen warning and the Store keeps it up to date, so it has no update check of its own and no Preferences › Updates; Help › Copy app info says "(Microsoft Store)". Opening `.gtr` files and `gutterberg-cli` work as with the installer from GitHub. A privacy policy, [PRIVACY.md](PRIVACY.md), now says in one place what the app sends and where.

### Changed

- Preferences › Updates › Tell me about › Never now means Gutterberg doesn't check for updates by itself at all. Before, it still asked GitHub once a day and only kept quiet about it; now nothing goes out until you press Check for updates.

## 1.1.0 (2026-10-20)

### Added

- Cut marks on back sheets: with Backs on the other side, Print settings › Cut marks › Also on back sheets puts the marks around the backs too, following the mirrored layout and the back offset. It is for backs you cut on their own, like tokens glued to both sides of a board or backs printed on separate sheets; it is off by default, since for double-sided printing you cut from the front. Saved projects open with it off, and the command line exports it as saved.
- AI Mode's Model field lists the chosen provider's models: with AI Mode on, picking a provider in Preferences › AI Mode asks it for its list of models, which costs no tokens (Anthropic and Gemini once a key is saved; OpenAI-compatible servers such as OpenRouter or LM Studio, and Ollama, without one), and typing narrows it down. OpenRouter models that do not read images are marked text only. Any model id can still be typed, and is all there is when the list cannot be loaded. The list is saved on your computer and used for a week, so opening Preferences or restarting the app does not ask again; the reload button next to the field does, and if that fails the saved list stays. The request carries your key and nothing else, and the README's Privacy section now says so.

### Fixed

- Test connection and the AI actions failed with "the answer was cut off" on Gemini models that think before they answer, such as gemini-3.8-flash: their thinking used up the reply's token limit. Gemini now gets room to think, and its thinking tokens count in the tokens shown.

## 1.0.0 (2026-10-17)

Gutterberg has done what I built it for since the first versions: take a print-and-play PDF, find the pieces and lay them out again with real gutters, without touching the art. 1.0.0 says it is ready. It adds the two things people asked about most once that worked. When a publisher updates a PDF, a saved project can now be exported again without opening the app, with a command line, `gutterberg-cli`, that writes the same PDF as the app. And help no longer only comes as tips at the right moment: twelve Tutorials, started from a new Help menu, walk through a task on the real controls when you need it. Cut marks can also be dashed or dotted, and AI Mode learns two things: finding several grids on a page, and pairing backs by looking at the pieces.

### Added

- A command line, `gutterberg-cli`, installed next to the app and attached to each release on its own: `gutterberg-cli export my-game.gtr -o sheets.pdf` writes the same PDF as the app's Export for that project, and `gutterberg-cli check my-game.gtr` lists what would stop the export without writing anything. A PDF or image that is not the file the project was saved with stops it unless `--force`; a PDF that is gone stops it; a missing image leaves its page blank, as in the app. Settings are not changed from the command line. It needs no pdfium and no screen.
- Tutorials: step-by-step walkthroughs that you start when you need them, from the new `?` Help menu in the toolbar (Tutorials…, Keyboard shortcuts, Welcome tour and Report a problem, there with or without a PDF open) or from Preferences › Help, above the tips switch. The Tutorials list is grouped by tab (Source tab, Print tab, Duplex, App) and has a search field that ignores case and accents. Picking one starts it: a card points at the real control with a spotlight, with Back and Next, and moves on by itself when you do the step; Done, the ×, or `Esc` end it. There are twelve: Make pieces bigger or smaller, Line up fronts and backs, Print gutterfold or turn it into double-sided, Pair fronts with their backs, Choose the paper size, Add cut marks, Find a piece on the sheet, Mark pieces of different sizes on one page, Use images as pieces, Mark pieces and export, Update Gutterberg and Report a problem.
- Cut marks can be dashed or dotted: Print settings › Cut marks › Line (Solid, Dashed or Dotted), for ticks and for lines in the gaps. The sheet preview and the export draw them the same way, still as vector lines, and the command line exports them as saved in the project. Projects without the setting open with solid lines.
- A tutorial works with help tips turned off, no help tip shows while one runs, and nothing about it is saved. One that needs a PDF, or a PDF with pieces, says so and offers Open PDF… or the Mark pieces and export tutorial; it never opens a file or changes the project by itself.
- Detect with AI can find several grids on one page, like the other engines: a page with blocks of pieces of different sizes gets one proposal with a grid per block, and applying it makes them the page's grids, in one undo step.
- Pair backs with AI: with AI Mode on, Pair backs automatically… has By picture, with AI, for backs no rule can find, such as a back per deck or backs in another order. Find backs with AI sends a small picture of every piece (up to 100), and the dialog shows how many fronts got a back before you apply it. Applying gives each front its back, turns only the backs that are upside down, and stops printing every piece found to be a back, in one undo step.
- The Discord button in Preferences › About › Found a bug? opens Gutterberg's Discord server (after showing its address, like every link), to ask questions, share layouts and talk about what comes next.

### Changed

- The notice before an AI action no longer shows tokens or a price, which went stale as list prices changed and was only known for one model. It still names the server and what is sent, and its "Don't ask again" now works for every AI action and is kept: it stops the notice for that server only, so a new provider or address is asked about again. Preferences › AI Mode › Ask before sending turns the notice back on.

## 0.16.0 (2026-10-15)

### Added

- Several grids on one page (Source tab): the Grids and pieces panel lists the viewed page group's grids, each with its own region, rows, columns and gaps, with Add grid (up to 9) and a delete button. The picked grid is edited on the page as before and the others are drawn dimmer; with the Select or the Grid tool, pressing a dimmer grid picks it and moves it. Layout, presets and "Apply this grid to…" act on the picked grid, and "Apply this grid to…" can also copy all of them. A page with cards of three sizes can be marked with three grids that stay grids, instead of turning each into freeform pieces.
- The Grids and pieces panel in the Source tab, under Properties on the right (the Panels menu moves or hides it): the page's grids, their folders and its freeform pieces in one list. Pressing a piece picks it with the Piece tool, and every grid and piece has a bin (the last grid only loses its region).
- Grids can have a name and a color: double-click a name to change it, and click the dot at its left for the colors: the suggested ones, then your own, which the + adds from the system's picker and a right-click or the × on hover deletes (they are kept in Preferences for every project). The colors close when you press outside them; the pencil has the name, the color and the folder together. The name shows in the list and above the grid on the page, and the grid's lines are drawn in its color.
- Folders of grids: the folder-and-plus button in the panel's header adds a folder, and grids dragged onto it go in. Pressing the folder in the list picks its grids, and dragging one of them on the page, or the arrow keys, moves them all as one. Pressing one grid picks it alone, even inside a folder. Folders can be renamed with a double-click, folded away in the list and ungrouped.
- Grids and folders are put in another order by dragging them in the list; the order of the list is the order the pieces come out.
- The eye next to a grid or a folder hides it on the page; it still exists and prints.
- Right-click menus: on the page, a grid has Hide and Delete and a piece has Delete, whichever tool is on; in the Grids and pieces list, a grid has Rename, Change color, Hide, Move up, Move down, Move to a folder (or a new one), Take out of its folder and Delete, a folder has Rename, Hide, Move up, Move down and Ungroup (Delete when empty), and a piece has Delete.
- The Select tool (`V`, the arrow): press any grid or piece on the page to pick it and drag it, and resize it from its handles, whichever it is; a press on the empty page draws nothing. The grid region tool is now the Grid tool, on `G` with a grid icon, and the Piece tool stays on `C`. A PDF still opens with the Grid tool, and once a grid is drawn the app switches to the Select tool with it picked; Preferences › Display › Tools turns that off.
- Pages can be removed from view: right-click a page in the Pages panel for Remove page, or Remove the other pages to keep only that one. Removed pages are skipped and leave the panel and the arrow keys, but stay in the PDF and the project; Removed pages (n), folded at the bottom of the panel, brings them back with a click or a right-click. A page's right-click menu can also skip or include it.
- Applying a detected grid on a page whose grid is already drawn asks first: Add as new grid, or Replace it (named, for example Replace Grid 2). Enter adds it. Several grids at once offer Add as new grids or Replace grids; freeform pieces keep a single Apply.
- Detect pieces offers several grids at once when it finds blocks of pieces of different sizes on a page, as one proposal ahead of the grids one by one. Applying it makes them the page's grids, in one undo step.
- With several grids on a page, piece references name the grid (`p3 · g2 · r1 c2`) in the piece library, Selected pieces and on the sheet preview.

### Changed

- Detect on this page is at the bottom of the Layout section, the grid it fills, instead of a section of its own in Properties; Output is now the last section of Properties.
- Remove PDF in the Pages panel is red, since it takes the PDF out of the project, and there is more room between the Pages buttons and the first page.
- Folding a panel or opening it again slides its contents up or down instead of jumping (no movement with reduced motion).
- Projects are saved as version 7 (for several grids); older projects open as before with their edits intact, and an older Gutterberg asks to be updated.
- With "Same as source", and in the Source tab's export, each grid of a page gives its own sheet.
- Pieces come out page by page, grid by grid, then the page's freeform pieces, and Pair backs automatically… pairs them grid by grid.

## 0.15.0 (2026-10-15)

### Added

- Sticky edges (Source tab): while the grid region is drawn, moved or resized, and while an upright piece is moved or resized, its sides stick to the straight edges in the artwork (piece borders, cut lines, the sides of drawn boxes and pictures, and long contrast lines on a scan). An edge only pulls a side it runs along for at least half of its length, so art inside a piece does not. Ctrl/Cmd held still drags freely, and the sticky edges button next to the magnet turns it off. A help tip at that button explains it the first time a side sticks.
- Rulers (Source tab): the rulers button in the toolbar, or Ctrl/Cmd+R, shows rulers along the top and the left of the page in the Original view and the Original side of Split. They measure from the page's top-left corner in the unit chosen in Preferences (mm, cm or in), with ticks that follow the zoom (1, 5, 10 or 50 mm; 1/16 to 1 in) and a mark that follows the pointer. Off by default; when off they take no room.
- Guides (Source tab, with the rulers on): drag from the top ruler for a horizontal guide or from the left one for a vertical guide (Preferences › Display › Invert rulers swaps them, so each ruler gives the guide across it); its distance from the page's corner shows while it is dragged. With the Grid region or Piece tool, press on a guide to move it, or drag it back onto its ruler to delete it; the corner where the rulers meet has Clear guides. The grid region and the pieces snap to guides when the magnet is on. Guides are kept for the session, the same on every page of a PDF; they are not saved in the project.
- The keyboard shortcuts sheet lists Ctrl/Cmd+R and how to make, move and delete a guide.
- Arithmetic in number fields: every number field (sizes, gaps, positions, columns, rows, copies, pages, scale) takes `+`, `-`, `*`, `/` and parentheses, so typing `12/3` gives 4. The sum is worked out on Enter or when the field is left, in the unit shown, with a dot or a comma for decimals, and rounded to the decimals the field shows; the field's limits still apply. A sum that does not work out puts the old value back.

### Changed

- Preferences is reorganized: Workspace keeps the views, the new Layout section has the panels of each tab, and the new Display section brings together the theme, Live preview and the rulers (Preview and Appearance are gone). Longer explanations moved behind the ⓘ next to each title, and "Found a bug?" moved from Help to About.
- A help tip's "Open Preferences" now opens the setting it talks about, which pulses twice so it is easy to spot.
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
