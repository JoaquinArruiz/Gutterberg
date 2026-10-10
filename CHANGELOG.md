# Changelog

All notable changes to Gutterberg. Versions follow [Semantic Versioning](https://semver.org/);
the format follows [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Changed

- Each piece on an exported sheet is drawn through a frame the size of the piece, so PDF viewers draw sheets faster and most no longer flash the whole source page before the pieces appear. The file size stays the same.

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
