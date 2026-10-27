#!/usr/bin/env bash
# Downloads a prebuilt pdfium into src-tauri/resources/pdfium (Linux x64 by default).
# Usage: scripts/fetch-pdfium.sh [linux-x64|linux-arm64|mac-x64|mac-arm64|win-x64]
set -euo pipefail
tag="chromium/8125"
target="${1:-linux-x64}"
case "$target" in
  linux-x64)   sha="e1c3ce6e270cb5e0c20816b379ad9f2c1309972697c505f508de92bf5e7d6659" ;;
  linux-arm64) sha="8b8818f2ec57d1b213d952ca6d7f0ffeca9d0110487d0e20ad83ba918bc92efa" ;;
  mac-x64)     sha="8a5193535b80c7215d8932f6647ae5097465b6dba2811602c21e120c2af112b0" ;;
  mac-arm64)   sha="4939bd935ac83ddc09a3a4f038bc43a19cea1660316a3667f26cb07a070e139d" ;;
  win-x64)     sha="9a964261760cff52570aabf038ab346d3a5034dd8b30d0d5fe8861235d356b8b" ;;
  *) echo "unknown target: $target" >&2; exit 1 ;;
esac
dest="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/resources/pdfium"
mkdir -p "$dest"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://github.com/bblanchon/pdfium-binaries/releases/download/${tag}/pdfium-${target}.tgz" -o "$tmp/p.tgz"
# macOS has no sha256sum.
if command -v sha256sum >/dev/null; then check=(sha256sum -c -); else check=(shasum -a 256 -c -); fi
echo "${sha}  $tmp/p.tgz" | "${check[@]}" >/dev/null || { echo "SHA-256 mismatch for pdfium-${target}.tgz" >&2; exit 1; }
tar -xzf "$tmp/p.tgz" -C "$tmp"
case "$target" in
  win-*) cp "$tmp/bin/pdfium.dll" "$dest/" ;;
  mac-*) cp "$tmp/lib/libpdfium.dylib" "$dest/" ;;
  *)     cp "$tmp/lib/libpdfium.so" "$dest/" ;;
esac
# The notices pdfium's licenses require: its own and those of the libraries built into it (FreeType, libjpeg-turbo,
# ...). They sit next to the library, so every installer carries them, and scripts/third-party-licenses.mjs adds
# them to THIRD_PARTY_LICENSES.
{
  echo "pdfium-binaries ${tag} (https://github.com/bblanchon/pdfium-binaries)"
  echo
  cat "$tmp/LICENSE"
  for f in "$tmp"/licenses/*; do
    printf '\n\n======== pdfium: %s ========\n\n' "$(basename "$f")"
    cat "$f"
  done
} > "$dest/PDFIUM_LICENSES.txt"
echo "pdfium installed in $dest"
