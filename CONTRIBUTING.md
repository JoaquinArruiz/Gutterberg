# Contributing to Gutterberg

Thanks for wanting to help. Bug reports, ideas, fixes and new features are all welcome.

## Report a bug or suggest something

Open an [issue](https://github.com/JoaquinArruiz/Gutterberg/issues/new/choose) and pick the form. For a bug, the
version and your system are what help most: in the app, **Preferences › Help › Report on GitHub** opens the form with
both filled in, **Copy app info** gives you the line to paste, and **Copy log** gives you the end of the log
(useful when the app closed by itself or showed an error). A PDF that does not work is the best test case,
if you are allowed to share it.

## Set up

You need Node 20 or later, [pnpm](https://pnpm.io/), Rust, and on Linux the Tauri dependencies (`webkit2gtk-4.1`,
`gtk3`; see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```sh
git clone https://github.com/JoaquinArruiz/Gutterberg.git
cd Gutterberg
pnpm install
pnpm tauri dev                 # runs the app; the first time it also fetches pdfium (see below)
```

The package manager is pnpm: please do not use npm or npx.

### What `pnpm tauri dev` runs

Before it starts the app, `pnpm tauri dev` runs the `beforeDevCommand` of `src-tauri/tauri.conf.json`:
`node scripts/ensure-pdfium.mjs && pnpm dev` (`pnpm dev` is just the Vite dev server). If you would rather know what
that does before you run it, this is all of it:

1. `scripts/ensure-pdfium.mjs` looks for the pdfium library (`libpdfium.so`, `libpdfium.dylib` or `pdfium.dll`) in
   `src-tauri/resources/pdfium`. If it is there, or if you set `PDFIUM_LIB_PATH` (a folder with your own copy) or
   `GUTTERBERG_SKIP_PDFIUM_FETCH=1`, it does nothing and prints nothing.
2. If it is not there, it says so and runs `scripts/fetch-pdfium.sh` for your platform. That script is short and
   readable: it downloads one file, `pdfium-<platform>.tgz`, from a pinned release of
   [pdfium-binaries](https://github.com/bblanchon/pdfium-binaries) (the `tag` at the top of the script), refuses it
   unless its SHA-256 matches the one written in the script, and copies the library and its licenses into
   `src-tauri/resources/pdfium`. That folder is ignored by git. Nothing else is downloaded, installed or changed
   outside the repository.
3. If the download fails, it says what to run by hand and still starts; the app then shows its own "could not load
   the pdfium library" message.

Without pdfium the app opens but cannot show any PDF, so a fresh checkout needs it. To do the same thing yourself,
without `pnpm tauri dev` running a script: run `scripts/fetch-pdfium.sh` once (read it first), or download pdfium
from pdfium-binaries and point `PDFIUM_LIB_PATH` at the folder that has the library. You can also change
`beforeDevCommand` to `pnpm dev` in your own checkout; the app works the same once pdfium is in place.

How the code is organised, and why, is in [docs/architecture.md](docs/architecture.md). The words the interface uses
(a **piece**, not a card; **Source** and **Print** tabs; **source gap** and **output gap**) are in the glossary in
[AGENTS.md](AGENTS.md).

## Before you open a pull request

Run all of these; CI runs them too:

```sh
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo test --workspace         # the render tests need pdfium: PDFIUM_LIB_PATH=<dir containing libpdfium>
```

- Keep the change focused, with tests next to the code it covers (`*.test.ts`, `crates/card-core/tests/`).
- Geometry lives in `card-core` only; the interface asks it and draws the answer. Pieces keep their size unless the
  user explicitly sets another, and nothing is rasterised on export.
- Every text the user sees goes in both `src/locales/en.json` and `src/locales/es.json`, never in a component.
- A user-facing change gets a line under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).
- The commit message is one sentence that says what the change does.
- Branch from the version branch the change belongs to (`release/<x.y.z>`, the next version in
  [docs/milestones/roadmap.md](docs/milestones/roadmap.md); if there is none open, from `main` and ask in the issue),
  name the branch `feature/<what>` or `fix/<what>`, and open the pull request against that version branch. Say what
  it does and why; a maintainer reviews it. It is squashed into one commit, so the pull request title is the commit
  message: one sentence. The full flow (feature → version branch → `main` → tag) is in "Branches and releases" in
  [AGENTS.md](AGENTS.md).

## Contributor license agreement

Gutterberg is under the [PolyForm Noncommercial License 1.0.0](LICENSE), and the owner can license it for commercial
use. For that, contributions need a contributor license agreement (CLA). When you open your first pull request, a
bot ([CLA Assistant](https://github.com/cla-assistant/cla-assistant)) asks you to read and agree to it once, with a
click. A pull request cannot be merged before that.

## AI-assisted contributions

Contributions written with the help of an AI coding tool are welcome, under the same rules as any other: the tools read
[AGENTS.md](AGENTS.md), you are responsible for what you submit, it must pass the same checks, and it is reviewed like
any other change. Please do not add a tool as an author or co-author in commit messages, and check that `git config user.name` and `user.email` are yours before you commit: a tool's default identity makes it a contributor on GitHub. CI runs `scripts/check-authorship.sh` and fails a commit that names a tool as author, committer or co-author, or links to a session.

## License

By contributing you agree that your contribution is covered by the license above and the CLA. For anything about
commercial use, contact joaquinarruiz@gmail.com.
