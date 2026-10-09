#!/usr/bin/env bash
# Checks a release tag before anything is built, and writes the tag's notes from CHANGELOG.md.
# Usage: scripts/check-release.sh v1.1.0 [notes-file]
# Fails when the tag is not vX.Y.Z (or vX.Y.Z-pre.N), when package.json, src-tauri/Cargo.toml and the tag
# disagree (tauri.conf.json reads package.json), or when CHANGELOG.md has no "## X.Y.Z (date)" section.
set -euo pipefail
tag="${1:?usage: scripts/check-release.sh vX.Y.Z [notes-file]}"
notes="${2:-}"
root="$(cd "$(dirname "$0")/.." && pwd)"
fail() { echo "error: $*" >&2; exit 1; }

[[ "$tag" =~ ^v([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?)$ ]] || fail "'$tag' is not a version tag like v1.1.0"
version="${BASH_REMATCH[1]}"

pkg="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$root/package.json" | head -1)"
crate="$(sed -n 's/^version = "\(.*\)"$/\1/p' "$root/src-tauri/Cargo.toml" | head -1)"
[[ "$pkg" == "$version" ]] || fail "package.json says $pkg, the tag says $version"
[[ "$crate" == "$version" ]] || fail "src-tauri/Cargo.toml says $crate, the tag says $version"

# The section of this version: from its "## " heading to the next "## " heading.
section="$(awk -v v="$version" '
  /^## / { if (found) exit; if ($2 == v) { found = 1; next } }
  found { print }
' "$root/CHANGELOG.md")"
[[ -n "$(echo "$section" | tr -d '[:space:]')" ]] || fail "CHANGELOG.md has no notes under '## $version (date)'"

echo "ok: $tag matches package.json, Cargo.toml and CHANGELOG.md"
if [[ -n "$notes" ]]; then printf '%s\n' "$section" | sed '/./,$!d' > "$notes"; fi
