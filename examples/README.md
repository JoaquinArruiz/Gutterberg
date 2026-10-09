# Examples

Nine small PDFs to try Gutterberg on, from the plain case to the awkward ones. Every piece is a poker-sized
card (63 × 88 mm) unless a file says otherwise, and each one says which way is up ("▲ TOP"), so you can see at a
glance what turning and rotating do. All of them were made for this project: there is no one's game in here.

Open one with File › Open PDF (`Ctrl/Cmd+O`). In the Source tab, draw the **Grid region** (tool `V`) around the
pieces and set the rows and columns, or press **Detect pieces** to have them proposed. **Source gap** is the space
already between the pieces in the PDF, and **Output gap** (Print tab) is the space you want in the export. The
**Split** view shows the page and the re-spaced result side by side.

| File | Shows |
| --- | --- |
| [`01-default-3x3-a4.pdf`](01-default-3x3-a4.pdf) | The basic case: 3 × 3 pieces on A4, packed edge to edge |
| [`02-gaps-cropmarks-a4.pdf`](02-gaps-cropmarks-a4.pdf) | Pieces that already have a gap, with crop marks |
| [`03-letter-landscape-4x2.pdf`](03-letter-landscape-4x2.pdf) | A US Letter landscape sheet, 4 × 2 |
| [`04-multipage-mixed.pdf`](04-multipage-mixed.pdf) | Six pages of different kinds: skipped pages and page groups |
| [`05-rotated-page-90.pdf`](05-rotated-page-90.pdf) | A page that is stored turned 90° |
| [`06-cropbox-offset.pdf`](06-cropbox-offset.pdf) | A page whose visible area does not start at the page's corner |
| [`07-locked-no-modify.pdf`](07-locked-no-modify.pdf) | A PDF its publisher locked against changes |
| [`08-raster-3x3-a4.pdf`](08-raster-3x3-a4.pdf) | A scanned sheet: one picture instead of vector content |
| [`09-bad-scan.pdf`](09-bad-scan.pdf) | A messy scan: crooked pieces of different sizes |

## 01 · Default 3 × 3 on A4

Nine numbered pieces of 63 × 88 mm, touching each other, on one A4 page. Text and shapes are vector.

- **How:** open it, draw the Grid region over all nine pieces (or Detect pieces), 3 rows and 3 columns, Source gap
  0 mm. In the Print tab set an Output gap of 3 mm and export.
- **Result:** one A4 sheet with the nine pieces still 63 × 88 mm and 3 mm apart. The numbers stay sharp when
  you zoom in the exported PDF, because the original content is placed, never turned into a picture.

## 02 · Gaps and crop marks

The same nine pieces, but they already have 3 mm between them, each has a thin frame, and crop marks sit in the
margins.

- **How:** draw the grid as before and set the Source gap to 3 mm. Detect pieces also notices that the crop marks
  line up with the grid. Then try an Output gap of 5 mm, or switch on Cut marks in the Print tab.
- **Result:** the pieces keep their size and their frames; only the space between them changes (66 mm from one
  piece to the next in the original, 63 mm plus whatever Output gap you choose in the export).

## 03 · Letter landscape, 4 × 2

Eight pieces, packed edge to edge, on a US Letter page turned landscape.

- **How:** draw the Grid region over all eight, 2 rows and 4 columns. Set the Output gap to 3 mm.
- **Result:** the sheet stays Letter landscape. If the gap you ask for makes the pieces not fit the page (try
  15 mm), the export is blocked and tells you how much room the pieces need: they are never shrunk to fit.

## 04 · Several pages, mixed

Six A4/Letter pages, described on the first page itself: page 1 is a rulebook, pages 2 and 3 hold 18 poker
fronts (3 × 3 each), page 4 holds their backs (for the Duplex section), page 5 has 4 tarot cards (2 × 2, 70 × 120 mm) and page 6 is a
US Letter page with 3 × 3 poker pieces.

- **How:** skip page 1 (the checkbox on its thumbnail). Draw one grid on page 2 and use "Apply this grid to…" for
  page 3. Give page 5 its own grid (2 × 2) and page 6 its own as well. In the Print tab the piece library lists
  every piece of the included pages.
- **Result:** the rulebook is left out; each group of pages keeps its own grid and piece size; tarot cards stay
  70 × 120 mm next to poker cards at 63 × 88 mm.

## 05 · Rotated page

The 3 × 3 sheet of file 01, but the page is stored with a 90° rotation, so it shows turned on its side.

- **How:** open it, draw the grid over the nine pieces as you see them, and export.
- **Result:** the pieces are placed as the page displays them, nothing mirrored or shifted: the page's
  rotation is taken into account, not ignored.

## 06 · CropBox offset

The 3 × 3 sheet again, but the PDF's full page is larger than the visible A4 area (its crop box), and its
origin is not at the corner.

- **How:** open it; the app shows the visible A4 area. Draw the grid and export.
- **Result:** the pieces land where they appear in the app, not shifted by the hidden margin of the full page.

## 07 · Locked: no changes allowed

Looks like file 01, but its publisher set permissions that allow printing and copying and forbid changes
(the way some game publishers lock a print-and-play file). It opens without a password.

- **How:** open it. A red **Locked** badge appears next to the file's name. Try to export.
- **Result:** the export is refused before the save dialog, and the list of problems says: "This PDF's publisher
  doesn't allow changes. Contact them for an unlocked print-and-play version." Gutterberg never strips a
  publisher's protection. A PDF that only forbids something else (for example copying text) can be exported, and
  the new PDF keeps those restrictions.

## 08 · Raster scan, 3 × 3

A 300 dpi picture of a 3 × 3 sheet of pieces, with no vector content.

- **How:** draw the grid over the nine pieces (or Detect pieces; it works from the picture's shapes) and export
  with an Output gap of 3 mm.
- **Result:** the pieces keep their size, 63 × 88 mm. The scan's picture is placed in the new PDF as it is, never
  resampled, so the result is only as sharp as the scan.

## 09 · A bad scan

Seven pieces (A to G) lying at different angles on a grey background, and not all the same size (a 63 × 88 mm
one, a 44 × 68 mm one, a 70 × 120 mm one and so on).

- **How:** a single grid cannot describe this. Use Detect pieces on the page, check the proposal, and apply it;
  or choose the Piece tool (`C`) and draw one rectangle per piece, turning each with the handle above it. Then
  open the Print tab.
- **Result:** every piece comes out straightened and at its own size, and shows up in the piece library. Pieces
  that do not share a size go on sheets of their own, or share one grid if you turn size grouping off. The pieces
  are only as sharp as the picture.
