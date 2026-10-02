#!/usr/bin/env bash
# Downloads a prebuilt pdfium into src-tauri/resources/pdfium (Linux x64 by default).
# Usage: scripts/fetch-pdfium.sh [linux-x64|linux-arm64|mac-x64|mac-arm64|win-x64]
set -euo pipefail
target="${1:-linux-x64}"
dest="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/resources/pdfium"
mkdir -p "$dest"
tmp="$(mktemp -d)"
curl -fsSL "https://github.com/bblanchon/pdfium-binaries/releases/latest/download/pdfium-${target}.tgz" -o "$tmp/p.tgz"
tar -xzf "$tmp/p.tgz" -C "$tmp"
case "$target" in
  win-*) cp "$tmp/bin/pdfium.dll" "$dest/" ;;
  mac-*) cp "$tmp/lib/libpdfium.dylib" "$dest/" ;;
  *)     cp "$tmp/lib/libpdfium.so" "$dest/" ;;
esac
echo "pdfium installed in $dest"
