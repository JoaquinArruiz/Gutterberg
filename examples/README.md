# Examples

Seventeen small PDFs and a folder of images to try Gutterberg on, from the plain case to the awkward ones. In files
01 to 13 every piece is a poker-sized card (63 × 88 mm) unless a file says otherwise, and each one says which way is
up ("▲ TOP"), so you can see at a glance what turning and rotating do. Files 14 to 17 and the images are pieces of
a made-up card game, Lanternfall: cards, round tokens and hex tiles that look like the real thing. All of them were
made for this project: there is no one's game in here.

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
| [`10-fronts.pdf`](10-fronts.pdf) | 18 fronts on two pages, for pairing with the backs of file 11 or 12 |
| [`11-backs.pdf`](11-backs.pdf) | The backs of file 10 in a PDF of their own, columns mirrored as double-sided files have them |
| [`12-common-back.pdf`](12-common-back.pdf) | One back for every front, in a PDF of its own |
| [`13-three-sizes.pdf`](13-three-sizes.pdf) | One page with pieces of three sizes and two orientations |
| [`14-tcg-cards.pdf`](14-tcg-cards.pdf) | A card game: 18 fronts on two pages and their backs on two more |
| [`15-round-tokens.pdf`](15-round-tokens.pdf) | 48 round tokens, 30 mm across, 6 × 8 |
| [`16-hex-tiles.pdf`](16-hex-tiles.pdf) | 24 hexagonal terrain tiles, 4 × 6, 2 mm apart |
| [`17-game-kit.pdf`](17-game-kit.pdf) | A landscape page with cards, hex tiles, tokens and a back lying on its side |
| [`images/`](images/) | Cards, a back, tokens and hex tiles as 300 dpi PNG images |
| [`images/generic/`](images/generic/) | Blank card templates in eight colors and a back, as 300 dpi PNG images |

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

## 10 · Fronts, and 11 · their backs in another PDF

File 10 has 18 fronts (1 to 18) on two A4 pages, 3 × 3 each, edge to edge. File 11 has their backs (B1 to B18) on
two pages of their own, the way many games ship them. As in a double-sided file, the backs' columns are mirrored:
B1 is at the top right, so it lands behind front 1 when the paper is turned over on its long edge.

- **How:** open file 10, then File › Add PDF with file 11. Mark both PDFs with a 3 × 3 grid (draw it on page 1 and
  use "Apply this grid to…" for page 2). In the Print tab, Duplex › Print backs › Pair backs automatically… ›
  Backs in another PDF, choose file 11, with Mirrored on. Turn on the piece references (the tag above the sheet) to
  check the pairs. Then try Backs › Beside the front, with Pairs › Fold or Cut apart.
- **Result:** every front gets the back with its number, and the backs are not printed as fronts of their own.
  With Mirrored off, front 1 gets B3: the switch is what lines them up. Beside the front puts each back next to its
  front; Cut apart leaves out the fold line and adds cut marks between them.

## 12 · One common back

A single back, "COMMON", for every front.

- **How:** with file 10 open, add file 12 and mark its one piece (draw the Grid region around it, 1 × 1). Pair
  backs automatically… › Backs in another PDF, choose file 12.
- **Result:** it is offered as the common back of every front, instead of one back per page.

## 13 · Three sizes on one page

On one A4 page: four poker pieces (P1 to P4, 63 × 88 mm, 2 × 2, touching), ten tokens (T1 to T10, 25 × 25 mm,
2 × 5, 3 mm apart), two minis (M1, M2, 41 × 63 mm, 2 mm apart) and one landscape piece (L1, 88 × 63 mm). The
pieces have strong borders, so their edges are easy to see.

- **How:** draw a grid over the poker pieces (2 × 2) and press Turn into pieces. Draw the next grid over the tokens
  (5 rows, 2 columns, Source gap 3 mm) and turn it into pieces too. Draw the minis and the landscape piece with the
  Piece tool (`C`). Try the editing controls: `Ctrl/Cmd+A` picks every piece, Shift-click adds or takes one out,
  the arrow keys move what is picked, `Ctrl/Cmd+D` copies it, and dragging snaps to the page and the other pieces.
- **Result:** every piece is in the piece library at its own size (the landscape one stays landscape), and pieces
  of each size go on sheets of their own.

## 14 · A card game

Lanternfall, a made-up trading card game: 18 cards of six colors (63 × 88 mm, 3 × 3 per A4 page, edge to edge) on
pages 1 and 2, and one back repeated on pages 3 and 4.

- **How:** draw a 3 × 3 grid on page 1 (or Detect pieces) and use "Apply this grid to…" for the other pages. Skip
  pages 3 and 4 as fronts and pair them as backs in the Duplex section. Set an Output gap of 3 mm and switch on
  Cut marks.
- **Result:** every card keeps its size and its vector art, with room to cut between them.

## 15 · Round tokens

48 round tokens, 30 mm across, in 6 columns and 8 rows whose squares touch: coins, hearts, shields, stars, drops
and damage counters, one kind per row.

- **How:** draw a 6 × 8 grid over them, Source gap 0 mm, and choose an Output gap.
- **Result:** pieces are rectangles, so each token is cut out and printed with its square around it; the circles
  come out 30 mm across and evenly spaced.

## 16 · Hex tiles

24 flat-topped hexagonal terrain tiles (forest, lake, mountain, plains, desert, swamp), 46 mm from corner to corner
and 39.8 mm high, 4 × 6 with 2 mm between their rectangles, labelled A1 to F4.

- **How:** draw a 4 × 6 grid over them with a Source gap of 2 mm, or Detect pieces.
- **Result:** every tile keeps its size inside its rectangle; the corners of the rectangle stay white.

## 17 · A game kit on one page

A landscape A4 page with three cards (touching), two hex tiles, twelve 25 mm tokens (2 mm apart) and a card back
lying on its side.

- **How:** draw a grid over each group (1 × 3 for the cards, 6 × 2 for the tokens, 1 × 2 for the tiles), and mark
  the back with the Piece tool (`C`), turned 90°.
- **Result:** every kind of piece shows up in the piece library at its own size, and each size gets sheets of its
  own.

## Images

The [`images/`](images/) folder has the same pieces as pictures, at 300 dpi: nine cards and their back
(745 × 1040 px, 63 × 88 mm), three hex tiles (544 × 471 px, 46 × 39.8 mm) and three tokens (355 × 355 px, 30 mm).

- **How:** add the card images as pieces and set their size once to 63 × 88 mm; add the tokens and tiles
  separately with their own size.
- **Result:** the images are placed as they are, never resampled, at the size you set.

The [`images/generic/`](images/generic/) folder has eight blank card templates, one per color (red, blue, green,
yellow, purple, black, white, colorless), with "Card Name", placeholder art and placeholder rules text, and a plain
back: 745 × 1040 px, 63 × 88 mm at 300 dpi. They show how a card made as an image goes onto sheets, without being any
particular game.
