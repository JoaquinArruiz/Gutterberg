# Releasing Gutterberg

How a new version gets to people. Pushing a tag builds the app for Windows, macOS (Apple silicon and
Intel) and Linux and leaves a **draft** GitHub release; installed apps only see it once you publish it.

## Versions

[Semantic Versioning](https://semver.org/), `MAJOR.MINOR.PATCH`:

- **PATCH** (`1.1.1`): bug fixes only.
- **MINOR** (`1.2.0`): new features; old `.gtr` files keep working.
- **MAJOR** (`2.0.0`): big or breaking changes (a project migration, a redesign).

Tags have a `v` (`v1.1.0`), the versions in the files don't (`1.1.0`). A pre-release is `v1.2.0-beta.1`.
The version lives in two files you edit, `package.json` and `src-tauri/Cargo.toml`
(`src-tauri/tauri.conf.json` reads `package.json`). The workflow fails early if the tag and these disagree.

## Release notes

`CHANGELOG.md` has an `## Unreleased` section at the top with `### Added`, `### Changed` and `### Fixed`.
Write notes there as you work. At release time the heading becomes `## 1.1.0 (2026-11-02)` and an empty
`## Unreleased` goes above it. The workflow copies the section of the tag's version into the release text
and `latest.json` (what the app shows under "What's new"). English only.

## Once, before the first release

1. **The updater key.** Generate it with `pnpm tauri signer generate -w ~/.tauri/gutterberg.key`. The public
   key (`gutterberg.key.pub`) is already in `src-tauri/tauri.conf.json`. Put the private key and its password
   in the repo's secrets (Settings › Secrets and variables › Actions): `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **Keep a backup of both in a password manager.** If the key is lost,
   installed copies can never update again, and a new key means everyone must install by hand once.
2. **The repository must be public**, so apps can download `latest.json` and the installers without a token.
3. Settings › Actions › General › Workflow permissions: **Read and write**.

4. **CLA Assistant** (for contributors), before accepting outside pull requests: install it on the repository
   from <https://github.com/cla-assistant/cla-assistant> and point it at the contributor agreement. Only the
   owner can do this.

Builds are not code-signed (no Apple or Windows certificate). The updater works anyway; it checks its own key.

## To release

A version has its own branch, `release/1.1.0`, started from `main`; features and fixes are squashed into it with pull
requests (see "Branches and releases" in `AGENTS.md`). When it holds everything the version needs:

1. On `release/1.1.0`, merge `main` into it. Move the `Unreleased` notes under the new version in `CHANGELOG.md`;
   bump `version` in `package.json` and `src-tauri/Cargo.toml`; run `cargo build` to refresh `Cargo.lock`; delete the
   version's brief from `docs/milestones/` and its row from `roadmap.md`. To check before pushing:
   `scripts/check-release.sh v1.1.0`. Commit it as "Release 1.1.0".
2. Open a pull request from `release/1.1.0` to `main` and merge it with a **merge commit** once CI passes.
3. Tag `main` with a signed tag and push it:
   ```sh
   git switch main && git pull
   git tag -s v1.1.0 -m "Release 1.1.0"
   git push origin v1.1.0
   ```
4. Watch the run in the Actions tab (four builds). If one fails: fix it on a `fix/<what>` branch into the version
   branch, merge to `main` as before, delete the tag (`git tag -d v1.1.0`, `git push origin :refs/tags/v1.1.0`) and the
   draft release, and tag again.
5. Open the draft release and check the files (`.msi`/`.exe`, `.dmg` and `.app.tar.gz`, `.AppImage` and
   `.deb`, their `.sig` files and `latest.json`) and the notes. Press **Publish**. Only then do apps see it:
   GitHub's `releases/latest` skips drafts and pre-releases.
6. Delete the version branch. A fix for this version is a `release/1.1.1` branch started from `main`.

CI runs on pull requests, on pushes to `main` and `release/**`, and on tags; a branch is not built twice.
Protect `main` and `release/*` in Settings › Branches (a pull request and a passing `check` are required) so nothing
is pushed to them directly.

To fix the notes after a release, edit `CHANGELOG.md` and re-run the workflow for that tag (it replaces the
release's files). Editing the text on GitHub alone does **not** change `latest.json`.

## Licenses in every build

The workflow runs `node scripts/third-party-licenses.mjs` before building. It writes
`src-tauri/resources/THIRD_PARTY_LICENSES` from `cargo about` (the Rust crates, using `about.toml` and
`about.hbs`), `pnpm licenses` (the web packages) and the licenses `scripts/fetch-pdfium.sh` collects for
pdfium and the libraries inside it. The file is built into the app (Preferences › About › Third-party
licenses) and bundled with every installer, next to `LICENSE`, which the Windows installers show. The file
in the repository is only a placeholder. If a new dependency is under a license that `about.toml` does not
list, the build fails until the owner has decided about it. To try it on your machine:
`cargo install cargo-about --locked --features cli`, `scripts/fetch-pdfium.sh`, then
`node scripts/third-party-licenses.mjs --out /tmp/THIRD_PARTY_LICENSES`.

## Testing the updater

Before going public: release `0.9.0`, install it, release `0.9.1`, and check that 0.9.0 offers it (a toast
about 10 seconds after start, or Preferences › Updates › Check for updates), installs it, restarts and says
"Updated to 0.9.1".

## What people see

- The app checks about 10 seconds after start, at most once a day, never during an export. A failed or
  offline check is silent, but Preferences › Updates says the last check could not reach the server. The
  **Check for updates** button there shows the result and also the toast for a newer version.
- Preferences › Updates shows the installed version, a newer one with its notes, and **Tell me about**
  (all updates, new features, major versions only, never). That setting only decides the toast.
- On Windows the installer closes the app, so the project is saved first (the app asks if there are unsaved
  changes). Linux `.deb` users update by downloading the new `.deb`; the AppImage updates itself.
- Double-clicking a `.gtr` file opens it in Gutterberg.
