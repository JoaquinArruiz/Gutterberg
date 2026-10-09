#!/usr/bin/env bash
# Downloads a prebuilt pdfium into src-tauri/resources/pdfium (Linux x64 by default).
# Usage: scripts/fetch-pdfium.sh [linux-x64|linux-arm64|mac-x64|mac-arm64|win-x64]
set -euo pipefail
tag="chromium/8086"
target="${1:-linux-x64}"
case "$target" in
  linux-x64)   sha="588577cf52dabc1a444988bac841920df54cc2f141801424de97ab04f4fbb935" ;;
  linux-arm64) sha="e7e2fe4686925618330103cb167950aca5a84bb00fd977a41b86be59dd1480a2" ;;
  mac-x64)     sha="933a85a138f6027243c56bff8676375c33ceeb767401389415ffc44d689ca85d" ;;
  mac-arm64)   sha="e98679e052c07edbb5a627980902abb823d4b3f35744d877bd21668bd9fc13ab" ;;
  win-x64)     sha="1fd8af952832dbb0eb16d9249f68fe09e5f5ebf7c3dd9f6066ea2720cc28487d" ;;
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
