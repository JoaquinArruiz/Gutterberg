# Roadmap after 0.13.0

The order of the next versions and why. Each version has its own brief in this folder; when a version is released,
its brief is deleted (see "Planning" in `AGENTS.md`) and its line here goes with it. When the last one is done, this
file is deleted too.

| Version | Brief | What it brings | Project file | Preferences |
| --- | --- | --- | --- | --- |
| 0.14.0 | `0.14-editing-controls.md` | Arrow keys, several pieces picked, duplicate, snapping; backs from another PDF; gutterfold pairs cut apart; help tips off; update toast, notes and welcome polish; the shortcuts sheet | 6 | 14 |
| 0.15.0 | `0.15-several-grids.md` | Several grids on one page | 7 | unchanged |
| 0.16.0 | `0.16-command-line.md` | Export a saved project from the command line | unchanged | unchanged |
| any | `signing.md` | Signed builds for macOS and Windows | | |

The project and preferences numbers assume this order; whichever version changes the format first takes the next
number.

## Why this order

- **Editing controls before several grids.** Several grids needs a way to pick one grid among several on a page and
  move it. 0.14.0 settles picking, the arrow keys, several pieces at once and snapping on what exists today (one
  region and freeform pieces), so 0.15.0 builds on them instead of inventing them. 0.13.0 made several pieces at
  once more urgent: a grid turned into pieces is otherwise moved one piece at a time. The smaller items (backs from
  another PDF, pairs cut apart, help, updates, welcome) are what users and testing asked for since 0.10.0.
- **Several grids come in two versions.** 0.13.0 (turn a grid into pieces) is done; it already lets someone mark two
  sizes on one page (draw a grid, turn it into pieces, draw the next grid). 0.15.0 is the real thing: a grid number in every
  piece's id, a project migration and a new way to edit the Source tab. Splitting them gives the requester
  something early and keeps the big migration in one place.
- **The command line comes last.** Today the UI builds the print request (`src/lib/print-request.ts`). A command
  line needs that in `card-core`, and moving it is the bulk of the work. Doing it after 0.15.0 moves it once, with
  the final shape of page groups, instead of moving it and then changing it for several grids.
- **Signing is not a version.** It is mostly me buying certificates and adding secrets; the code side is the
  release workflow. It lands in whichever release is next once the certificates exist, ideally before a 1.0.0.

## Not planned

- **Cutting machines** (registration marks for a print-and-cut machine, and a cut file in SVG or DXF) were in this
  roadmap as 0.13.0. No user asked for them, and how a machine such as the Silhouette reads marks from a PDF is not
  settled, so the brief was dropped. If someone asks, start from what they use and what they do today.
