# Questions and answers

Short answers to "why does it do that?" questions. Setting names are as they appear in the app (English). For
problems installing or starting the app, see [the README](../README.md#download); for every control, see
[controls.md](controls.md). If your question is not here, ask on [Discord](https://discord.gg/ytBFE9TtRY) or
[open an issue](https://github.com/JoaquinArruiz/Gutterberg/issues/new/choose).

## Cut marks

### The ticks in the gaps are short, or some gaps have none

With **Also in the gaps** on, each tick starts as far from the piece as the ticks in the margins do: the bleed plus
**Distance from the piece**. Both edges of a gap need that room, so a tick can only fill what is left of the gap
after taking it off twice:

> room for the tick = gap − 2 × (bleed + Distance from the piece)

In a 3 mm gap with no bleed and a 1 mm distance, that leaves 1 mm, however long **Tick length** is. When nothing is
left, that gap gets no ticks and the sheet warns that a gap is too narrow. When the ticks from both sides fill the
room, they join into one line across the gap.

To make them longer, lower **Distance from the piece** (under **More options** in Cut marks). 0 starts the tick right
at the piece's edge (or its bleed). A wider output gap, or a smaller bleed, also leaves more room. A smaller gap makes
them shorter.

### Why are the marks outside the bleed and not on the piece's edge?

Ticks start past the bleed, so the cut line stays visible after the bleed is printed and the marks never print on the
art. They are in line with the edge, so a ruler laid across two ticks follows the cut.

## Size and fit

### My pieces don't fit on the sheet. Why doesn't Gutterberg shrink them?

Pieces keep their size: a 63 × 88 mm card prints at 63 × 88 mm, so it still fits its sleeve and matches the rest of
the game. When the layout is larger than the sheet, Gutterberg says by how much and leaves the fix to you: a larger
paper size, the other orientation, smaller gaps or margins, or fewer pieces per sheet. If you do want them smaller,
set a real size or a percentage on the piece or the grid in the Print tab; it is always a visible choice.

### The printed pieces are a little smaller (or larger) than they should be

The printer scaled the page. In the print dialog choose **Actual size** (or 100%), not "Fit to page" or "Shrink to
fit". To check, turn on **Scale check** in the Print tab: it prints a 50 mm ruler in the margin of each sheet. If it
does not measure 50 mm on paper, the page was scaled.

### Can I print round tokens or hex tiles?

Yes, as rectangles. Pieces are always rectangles (they can be turned), so mark the box around the token or tile. It
prints at its size with its art untouched, and the cut marks show its box; cut the round or hex shape by hand.

## Bleed

### "The bleeds of neighbouring pieces overlap"

Each piece's bleed goes into the gap around it, and the piece next to it has its own. The output gap needs to be at
least twice the bleed, for example a 6 mm gap for a 3 mm bleed. The margins need room for it too.

### Does the bleed make my pieces larger?

No. The piece keeps its size; the bleed is extra art around it, so a slightly crooked cut still shows art instead of
white paper.

## Fronts and backs

### The backs don't line up with the fronts

Two settings fix most of it, both in the Duplex section of the Print tab:

1. **Flip on** must match how your printer turns the paper: **Long edge** for most portrait sheets. If the backs are
   upside down or in the wrong column, try the other one.
2. Many printers move the back by a millimeter or two. Press **Calibration sheet…**, print it on both sides at actual
   size, and type the numbers you read; they become the **Back offset**.

If the corners of the calibration sheet give clearly different numbers, the printer also turns or scales the back,
which an offset cannot fix. Gutterfold (Backs: **Beside the front**) avoids double-sided printing altogether.

## Export and colors

### "This PDF can't be exported"

Its publisher locked it against printing or changes. Gutterberg respects that: ask the publisher for an unlocked
print-and-play version, or remove that PDF from the project.

### An image "may not print sharp"

Gutterberg never resamples an image, so an image with few pixels for its printed size looks soft or blurry on paper.
The warning gives its resolution in dpi; about 300 dpi prints sharp. Use a larger image, or print it smaller.

### I chose CMYK but the preview looks the same

The preview always shows screen colors. CMYK changes what Gutterberg adds (cut marks, plain colors, images added as
pieces and Fill with AI pictures); the source PDFs keep their own colors, as their author made them. Choose CMYK only
when a print shop asks for it; RGB is right for home printers and most online services.

### Is the artwork turned into pictures on export?

No. Pieces are placed, turned and clipped from the original PDF, so text and vector art stay as sharp as in the
source.

## Privacy and installing

### Does Gutterberg send my files anywhere?

No. It works offline. The only things that use the network are the check for new versions and, if you turn it on, AI
Mode, which shows what it will send and to which server before it sends it. See [Privacy](../README.md#privacy).

### Microsoft Store or the installer from GitHub?

It is the same app. The Store copy installs without the SmartScreen warning and the Store keeps it up to date.
Install one or the other, not both.
