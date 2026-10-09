# Contributing to Gutterberg

Thanks for wanting to help. Bug reports, ideas, fixes and new features are all welcome.

## Report a bug or suggest something

Open an [issue](https://github.com/JoaquinArruiz/Gutterberg/issues/new/choose) and pick the form. For a bug, the
version and your system are what help most: in the app, **Preferences › Help › Report on GitHub** opens the form with
both filled in, and **Copy app info** gives you the line to paste. A PDF that does not work is the best test case,
if you are allowed to share it.

## Set up

You need Node 20 or later, [pnpm](https://pnpm.io/), Rust, and on Linux the Tauri dependencies (`webkit2gtk-4.1`,
`gtk3`; see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```sh
git clone https://github.com/JoaquinArruiz/Gutterberg.git
cd Gutterberg
pnpm install
scripts/fetch-pdfium.sh        # downloads pdfium into src-tauri/resources/pdfium
pnpm tauri dev                 # runs the app
```

The package manager is pnpm: please do not use npm or npx.

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
- Open the pull request against `main` and say what it does and why. A maintainer reviews it.

## Contributor license agreement

Gutterberg is under the [PolyForm Noncommercial License 1.0.0](LICENSE), and the owner can license it for commercial
use. For that, contributions need a contributor license agreement (CLA). When you open your first pull request, a
bot ([CLA Assistant](https://github.com/cla-assistant/cla-assistant)) asks you to read and agree to it once, with a
click. A pull request cannot be merged before that.

## AI-assisted contributions

Contributions written with the help of an AI coding tool are welcome, under the same rules as any other: the tools read
[AGENTS.md](AGENTS.md), you are responsible for what you submit, it must pass the same checks, and it is reviewed like
any other change. Please do not add a tool as an author or co-author in commit messages.

## License

By contributing you agree that your contribution is covered by the license above and the CLA. For anything about
commercial use, contact joaquinarruiz@gmail.com.
