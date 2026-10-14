# Welcome tour clips

My exports from Figma, one per step of the welcome tour, in order:

| File | What it shows |
| --- | --- |
| `01-cut.mp4` | A square is cut into 9 rectangles, which spread apart |
| `02-place.mp4` | The rectangles are put on an A4 page |
| `03-arrange.mp4` | Numbered rectangles in a shuffled order are sorted into 1 to 9 |
| `04-done.mp4` | The rectangles in place turn green, and a check appears in the middle |

These are the masters. `scripts/encode-welcome.sh` turns them into the WebM, MP4 and poster
files the app ships in `public/welcome/`. To change a clip, replace its file here (same
name) and run the script again. No text inside the clips: the words come from the language
files.

The masters are 1920 x 1080 with the picture in the 1440 x 1080 middle (4:3) and black at the sides; the script
crops that out. Later masters are better exported from Figma at 4:3, so there is nothing to crop (then the `crop=`
part of `FILTER` in the script goes too).
