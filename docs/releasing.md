# Releasing Gutterberg

How a new version gets to people. Pushing a tag builds the app for Windows, macOS (Apple silicon and
Intel) and Linux and leaves a **draft** GitHub release; installed apps only see it once you publish it. The
command line, `gutterberg-cli`, is built in the same run: it goes into every installer and is attached to the
release on its own (`gutterberg-cli-<target>`), with the app's version.

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

From 1.0.0 on, the section opens with a short paragraph on why the version exists and what it changes, before
the usual lists, so it also reaches the release text and "What's new". A version may get a name later; it would go
after the date, `## 1.1.0 (2026-11-02) · Name`, since `scripts/check-release.sh` finds the section by the second
word of the heading.

## Once, before the first release

1. **The updater key.** Generate it with `pnpm tauri signer generate -w ~/.tauri/gutterberg.key`. The public
   key (`gutterberg.key.pub`) is already in `src-tauri/tauri.conf.json`. Put the private key and its password
   in the repo's secrets (Settings › Secrets and variables › Actions): `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **Keep a backup of both in a password manager.** If the key is lost,
   installed copies can never update again, and a new key means everyone must install by hand once.
2. **The repository must be public**, so apps can download `latest.json` and the installers without a token.
3. Settings › Actions › General › Workflow permissions: **Read and write**.

4. **Contributor license agreement**: `.github/workflows/cla.yml` asks the author of every outside pull request to
   sign [CLA.md](../CLA.md) with a comment, and records the signatures in `signatures/cla.json` on the
   `cla-signatures` branch. That branch must exist and must not be protected, since the workflow commits to it. If
   CLA.md changes in a way that matters, raise its version so that new signatures name it.

5. **The Discord release post**: `.github/workflows/discord-release.yml` posts every published release (not
   pre-releases) in the Discord server's `#announcements`, pinging the Release pings role, and publishes the post to
   the servers that follow the channel. It needs the secrets `DISCORD_BOT_TOKEN` (Gutterbot's token),
   `DISCORD_ANNOUNCEMENTS_CHANNEL_ID` and `DISCORD_RELEASE_ROLE_ID` (the last two may be variables instead), and
   Gutterbot needs View Channel, Send Messages and Manage Messages in `#announcements`. The post is made from the
   release's lists (Added as New, Changed, Fixed), each bullet cut to its name and first sentence; I can edit it in
   Discord afterwards. Run the workflow by hand with a tag to see the post (a dry run, the default) or to post a
   release again.

Builds are not code-signed (no Apple or Windows certificate). The updater works anyway; it checks its own key. The
Microsoft Store package is the exception: the Store signs it (see "Microsoft Store" below).

## To release

A version has its own branch, `release/1.1.0`, started from `main`; features and fixes are squashed into it with `git merge --squash`
(see "Branches and releases" in `AGENTS.md`). When it holds everything the version needs:

0. **Security updates first**, on a `fix/` branch into the version branch: pdfium reads every PDF a user opens, so
   move `tag` in `scripts/fetch-pdfium.sh` to the newest [pdfium-binaries](https://github.com/bblanchon/pdfium-binaries/releases)
   release and put the five new SHA-256 sums beside it (`sha256sum` of each `.tgz`); then `cargo install cargo-audit`
   once and `cargo audit`, and `cargo update -p <crate>` whatever it reports with a fix.
1. On `release/1.1.0`, merge `main` into it. Move the `Unreleased` notes under the new version in `CHANGELOG.md`;
   bump `version` in `package.json` and `src-tauri/Cargo.toml`; run `cargo build` to refresh `Cargo.lock`; delete the
   version's brief from `docs/milestones/` and its row from `roadmap.md`. To check before pushing:
   `scripts/check-release.sh v1.1.0`. Commit it as "Release 1.1.0".
2. Once CI has passed on `release/1.1.0` and I have tested it, merge it into `main` with a **merge commit**:
   `git switch main && git pull && git merge --no-ff release/1.1.0 && git push`.
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
   GitHub's `releases/latest` skips drafts and pre-releases. Publishing also posts the release on Discord.
6. Delete the version branch. A fix for this version is a `release/1.1.1` branch started from `main`.

CI runs on pull requests, on pushes to `main` and `release/**`, and on tags; a branch is not built twice. Feature and
fix branches are merged locally into their version branch (no pull request), so CI checks them when the version branch
is pushed.

To fix the notes after a release, edit `CHANGELOG.md` and re-run the workflow for that tag (it replaces the
release's files). Editing the text on GitHub alone does **not** change `latest.json`.

## Microsoft Store

Gutterberg is on the Microsoft Store as an MSIX package. The Store signs it (no certificate needed), hosts it and
updates it; the Store copy turns its own updater off. The product is in Partner Center (partner.microsoft.com) under
my individual developer account; its identity is in `src-tauri/msix/AppxManifest.xml` and must not change.

**Each release.** The tag's run packs `Gutterberg_<version>_x64.msix` on the Windows build and keeps it with the run
(Actions › the run › Artifacts › `microsoft-store`, a zip with the `.msix` inside); it is not on the GitHub release,
since an unsigned MSIX does not install by double-clicking. Pre-releases get none. To get a package without a tag (to try it, or for a first submission), run the
"Microsoft Store package" workflow by hand from the Actions tab; it also runs on any push that changes the manifest or
the script. If the artifact is missing, the
"Pack the Microsoft Store package" step's log says why; the rest of the release is not affected. After publishing the
GitHub release: in Partner Center, open Gutterberg, **Start update** (or the open submission), **Packages**, drop the
`.msix`, remove the previous one, and **Submit to the Store**. Certification usually takes one to three days; the
Store then updates installed copies by itself.

**Before the first submission, or after changing the manifest**, try the package on a Windows PC. It has to be signed
to install outside the Store, so sign a copy with a test certificate whose subject is the manifest's publisher (in
PowerShell as administrator, with the Windows SDK's `signtool` on the path):

```powershell
$cert = New-SelfSignedCertificate -Type Custom -Subject "CN=11D978E9-4283-4274-B6A5-2A5B34C44A34" `
  -KeyUsage DigitalSignature -FriendlyName "Gutterberg MSIX test" -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
Export-Certificate -Cert $cert -FilePath gutterberg-test.cer
Import-Certificate -FilePath gutterberg-test.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
Copy-Item Gutterberg_1.2.0_x64.msix test.msix
signtool sign /fd SHA256 /sha1 $cert.Thumbprint test.msix
Add-AppxPackage test.msix
```

Then check: it starts from Start; opening a PDF and exporting works (pdfium is found); double-clicking a `.gtr` opens
it; `gutterberg-cli --help` works in a new terminal; Preferences has no Updates section and Help › Copy app info says
"(Microsoft Store)"; AI Mode saves its key. Remove it with `Get-AppxPackage *Gutterberg* | Remove-AppxPackage`.
Never upload the test-signed copy; upload the one from the run.

**The listing** (description, screenshots without AI Mode, logo, age rating, privacy policy) is edited in Partner
Center, not here. The privacy policy URL is
`https://github.com/JoaquinArruiz/Gutterberg/blob/main/PRIVACY.md`; when what the app sends changes, `PRIVACY.md` and
the README's Privacy section change together.

## Licenses in every build

The workflow runs `node scripts/third-party-licenses.mjs` before building. It writes
`src-tauri/resources/THIRD_PARTY_LICENSES` from `cargo about` (the Rust crates, using `about.toml` and
`about.hbs`), `pnpm licenses` (the web packages) and the licenses `scripts/fetch-pdfium.sh` collects for
pdfium and the libraries inside it. The file is built into the app (Preferences › About › Third-party
licenses) and bundled with every installer, next to `LICENSE`, which the Windows installers show. The file
in the repository is only a placeholder. If a new dependency is under a license that `about.toml` does not
list, the build fails until I have decided about it. To try it on your machine:
`cargo install cargo-about --locked --features cli`, `scripts/fetch-pdfium.sh`, then
`node scripts/third-party-licenses.mjs --out /tmp/THIRD_PARTY_LICENSES`.

## Testing the updater

Before going public: release `0.9.0`, install it, release `0.9.1`, and check that 0.9.0 offers it (a toast
about 10 seconds after start, or Preferences › Updates › Check for updates), installs it, restarts and says
"Updated to 0.9.1".

## What people see

- The app checks about 10 seconds after start, at most once a day, never during an export, and not at all with
  Tell me about set to Never. A failed or
  offline check is silent, but Preferences › Updates says the last check could not reach the server. The
  **Check for updates** button there shows the result and also the toast for a newer version.
- Preferences › Updates shows the installed version, a newer one with its notes, and **Tell me about**
  (all updates, new features, major versions only, never). That setting decides the toast; Never also stops the
  automatic check, so a newer version shows only after **Check for updates**.
- On Windows the installer closes the app, so the project is saved first (the app asks if there are unsaved
  changes). Linux `.deb` users update by downloading the new `.deb`; the AppImage updates itself.
- Double-clicking a `.gtr` file opens it in Gutterberg.
