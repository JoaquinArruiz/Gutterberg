# Changelog

All notable changes to Gutterberg. Versions follow [Semantic Versioning](https://semver.org/);
the format follows [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

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
