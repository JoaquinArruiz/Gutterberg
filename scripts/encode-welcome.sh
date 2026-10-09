#!/usr/bin/env bash
# Rebuilds public/welcome/ from the masters in assets/welcome/ (see the README there).
# Each <nn>-<name>.mp4 master becomes, at 1280 x 720 and 30 fps with no audio:
#   <nn>-<name>.webm  VP9, for webviews that cannot play H.264 (WebKitGTK on Linux)
#   <nn>-<name>.mp4   H.264 with +faststart, for those that cannot play VP9 (older macOS)
#   <nn>-<name>.png   the clip's last frame: the poster, and what shows after it ends
# Needs ffmpeg with libx264 and libvpx-vp9 (install it yourself; the app does not need it to build, because the
# outputs are committed). Run it again after replacing a master.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v ffmpeg >/dev/null || { echo "ffmpeg is needed (https://ffmpeg.org)" >&2; exit 1; }

SRC=assets/welcome
OUT=public/welcome
FILTER="scale=1280:720:flags=lanczos,fps=30"
mkdir -p "$OUT"

shopt -s nullglob
masters=("$SRC"/*.mp4)
[ ${#masters[@]} -gt 0 ] || { echo "no masters in $SRC" >&2; exit 1; }

for master in "${masters[@]}"; do
  name=$(basename "$master" .mp4)
  echo "$name"
  ffmpeg -y -loglevel error -i "$master" -an -vf "$FILTER" \
    -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart "$OUT/$name.mp4"
  ffmpeg -y -loglevel error -i "$master" -an -vf "$FILTER" \
    -c:v libvpx-vp9 -b:v 0 -crf 32 -row-mt 1 -pix_fmt yuv420p "$OUT/$name.webm"
  # Every frame of the last 0.2 s is written over the same file, so the last one stays.
  ffmpeg -y -loglevel error -sseof -0.2 -i "$OUT/$name.mp4" -update 1 "$OUT/$name.png"
done

# The clips go into every installer and the repo: about 1.5 MB a clip and 8 MB in all.
total=0
for f in "$OUT"/*.webm "$OUT"/*.mp4; do
  size=$(wc -c <"$f")
  total=$((total + size))
  [ "$size" -le 1572864 ] || { echo "$f is over the 1.5 MB budget ($size bytes): tell the owner" >&2; exit 1; }
done
for f in "$OUT"/*.png; do total=$((total + $(wc -c <"$f"))); done
[ "$total" -le 8388608 ] || { echo "public/welcome is over the 8 MB budget ($total bytes): tell the owner" >&2; exit 1; }
echo "public/welcome: $((total / 1024)) KB in all"
