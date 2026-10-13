# Roadmap after 0.10.0

The order of the next versions and why. Each version has its own brief in this folder; when a version is released,
its brief is deleted (see "Planning" in `AGENTS.md`) and its line here goes with it. When the last one is done, this
file is deleted too.

| Version | Brief | What it brings | Project file | Preferences |
| --- | --- | --- | --- | --- |
| 0.13.0 | `0.13-cutting-machines.md` | Registration marks for cutting machines and a cut file (SVG, DXF) | 6 | unchanged |
| 0.14.0 | `0.14-grid-to-pieces.md` | Turn a grid into freeform pieces, so a second grid can be drawn on the page | unchanged | unchanged |
| 0.15.0 | `0.15-several-grids.md` | Several grids on one page | 7 | unchanged |
| 0.16.0 | `0.16-command-line.md` | Export a saved project from the command line | unchanged | unchanged |
| any | `signing.md` | Signed builds for macOS and Windows | | |

The project and preferences numbers assume this order; whichever version changes the format first takes the next
number.

## Why this order

- **0.11.0 first and soon.** `Unreleased` already holds the start-up log, the macOS 13 requirement and the new
  settings folder. The log exists to diagnose an app that closes by itself, so it should reach people quickly.
  Piece references are small and the most wanted request, so they ride along. The macOS requirement and the
  settings move make this a minor version, not a patch.
- **0.12.0 and 0.13.0 are about the paper.** Presets and calibration need no project change; the cutting-machine
  settings do, so they get a version of their own.
- **Several grids come in two versions.** 0.14.0 is a small step that already lets someone mark two sizes on one
  page (draw a grid, turn it into pieces, draw the next grid). 0.15.0 is the real thing: a grid number in every
  piece's id, a project migration and a new way to edit the Source tab. Splitting them gives the requester
  something early and keeps the big migration in one place.
- **The command line comes last.** Today the UI builds the print request (`src/lib/print-request.ts`). A command
  line needs that in `card-core`, and moving it is the bulk of the work. Doing it after 0.15.0 moves it once, with
  the final shape of page groups, instead of moving it and then changing it for several grids.
- **Signing is not a version.** It is mostly the owner buying certificates and adding secrets; the code side is the
  release workflow. It lands in whichever release is next once the certificates exist, ideally before a 1.0.0.

Already possible today, worth a help tip or a line in the docs in 0.14.0: a page can have its grid **and** freeform
pieces (`toRustGroups` puts a page's freeform pieces right after its grid pieces), and the same PDF can be added to a
project twice (File › Add PDF) with a different grid on each copy.
