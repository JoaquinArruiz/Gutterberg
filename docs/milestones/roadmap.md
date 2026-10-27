# Roadmap after 1.0.0

The order of the next versions and why. Each version has its own brief in this folder; when a version is released,
its brief is deleted (see "Planning" in `AGENTS.md`) and its line here goes with it. When the last one is done, this
file is deleted too.

| Version | Brief | What it brings | Project file | Preferences |
| --- | --- | --- | --- | --- |
| 1.3.0 | `1.3.0.md` | Community requests: cut marks where gaps cross, sheet and piece background colours, edge fill (Edge colour and AI), a readme for shared projects, and smaller Print and Source tab changes | 8 | |
| any | `signing.md` | Signed builds for macOS and Windows | | |

The project and preferences numbers assume this order; whichever version changes the format first takes the next
number.

## Why this order

- **Signing is not a version.** It is mostly me buying certificates and adding secrets; the code side is the
  release workflow. It lands in whichever release is next once the certificates exist.

## Not planned

- **Cutting machines** (registration marks for a print-and-cut machine, and a cut file in SVG or DXF) were in this
  roadmap as 0.13.0. No user asked for them, and how a machine such as the Silhouette reads marks from a PDF is not
  settled, so the brief was dropped. If someone asks, start from what they use and what they do today.
