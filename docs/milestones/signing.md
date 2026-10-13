# Signed builds for macOS and Windows

Builds are not code-signed today (`docs/releasing.md`, README). macOS and Windows warn on the first launch, and
macOS needs a right-click › Open or a trip to System Settings. This is the biggest hurdle for new users. It is not
tied to a version: it lands in the next release after the certificates exist.

## What I do first (outside the code)

Prices and rules change; check each before paying.

- **macOS:** join the Apple Developer Program (yearly fee), create a "Developer ID Application" certificate, and an
  app-specific password or App Store Connect API key for notarization. Without notarization, signing alone does not
  remove the warning.
- **Windows:** since 2023 a code-signing key must live on hardware or in a cloud HSM, so a plain `.pfx` file is no
  longer sold. Options to compare:
  - a cloud signing service (for example Microsoft's Azure signing service); check whether an individual in
    Argentina can use it;
  - an OV certificate from a certificate authority, on a token or their cloud HSM;
  - SignPath's free plan for open source, which asks for an OSI-approved license; the PolyForm Noncommercial license
    is probably not one, so check before applying.
  An EV certificate is no longer needed for SmartScreen: since 2024 EV and OV build reputation the same way.
- Put the secrets in the repository (Settings › Secrets and variables › Actions) and keep a backup in a password
  manager.

## The session changes

1. `.github/workflows/release.yml`: pass the Apple secrets tauri-action reads (`APPLE_CERTIFICATE`,
   `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, or the API
   key ones) and the Windows signing (a certificate thumbprint, or `bundle.windows.signCommand` in
   `src-tauri/tauri.conf.json` for a cloud service). Read Tauri's "Code signing" guides for both platforms first.
2. A build without the secrets (a fork, a pull request) still works, unsigned.
3. `docs/releasing.md`: the new one-time steps and secrets. README: remove or shorten the first-launch warnings.
   `docs/architecture.md` › Decisions › Signing.
4. Changelog: "The macOS and Windows installers are signed…" under Changed.

The updater's own signature (`TAURI_SIGNING_PRIVATE_KEY`) is separate and does not change.

## Done when

A tagged build installs on a clean Mac and a clean Windows PC without the "unidentified developer" or "Windows
protected your PC" screens (SmartScreen may still warn until the certificate builds reputation), and updating from
an unsigned version works.
