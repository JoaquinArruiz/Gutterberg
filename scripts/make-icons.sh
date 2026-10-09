#!/usr/bin/env bash
# Regenerates src-tauri/icons from assets/brand/app-icon.svg (and app-icon-small.svg for the 16 and 32 px sizes).
# Needs pnpm and Google Chrome (or Chromium) to draw the small icon; set CHROME to use another binary.
set -euo pipefail
cd "$(dirname "$0")/.."

BRAND=assets/brand
ICONS=src-tauri/icons
CHROME=${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)}
[ -n "$CHROME" ] || { echo "Chrome or Chromium is needed (set CHROME)" >&2; exit 1; }

pnpm tauri icon "$BRAND/app-icon.svg"
# Only the desktop icons are used.
rm -rf "$ICONS/android" "$ICONS/ios"

# Draw one square PNG of the small icon at a size on a transparent background.
render() {
  local size=$1 out=$2 html
  html=$(mktemp --suffix=.html)
  printf '<style>html,body{margin:0;background:transparent}img{display:block}</style><img src="file://%s" width="%s" height="%s">' \
    "$PWD/$BRAND/app-icon-small.svg" "$size" "$size" >"$html"
  "$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size="$size,$size" --screenshot="$out" "file://$html" >/dev/null 2>&1
  rm -f "$html"
}

render 32 "$ICONS/32x32.png"
render 16 "$ICONS/16x16.png"

# Put the small drawing into the 16 and 32 px layers of icon.ico (the other layers stay as generated).
python3 -I scripts/patch-ico.py "$ICONS/icon.ico" 16="$ICONS/16x16.png" 32="$ICONS/32x32.png"
rm -f "$ICONS/16x16.png"
