#!/usr/bin/env bash
# Fails when a commit names an AI tool as its author or committer, adds one as a co-author, or links to a session
# (the rule in AGENTS.md: "No AI tool is an author or co-author"). GitHub lists everyone with a commit or a
# Co-authored-by trailer on the default branch as a contributor, so this is checked before a commit gets there.
# Usage: scripts/check-authorship.sh <base>..<head>     (CI passes the range of the push or pull request)
set -euo pipefail
range="${1:?usage: scripts/check-authorship.sh <base>..<head>}"
base="${range%%..*}"
# A new branch has no earlier commit to start from (all zeros): look at the last commit only.
# The same when the base is gone (a force push leaves the old tip behind).
if [[ "$base" =~ ^0+$ ]] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then range="${range##*..}~1..${range##*..}"; fi

bad=0
while read -r sha; do
  [ -n "$sha" ] || continue
  who="$(git show -s --format='%an <%ae> | %cn <%ce>' "$sha")"
  msg="$(git show -s --format='%B' "$sha")"
  problem=""
  if grep -qiE 'claude|anthropic' <<<"$who"; then problem="author or committer: $who"; fi
  if grep -qiE '^co-authored-by:.*(claude|anthropic|copilot|chatgpt|openai|gemini|cursor)' <<<"$msg"; then
    problem="Co-authored-by trailer for an AI tool"
  fi
  if grep -qiE 'claude\.(ai|com)/code/session' <<<"$msg"; then problem="a link to an AI tool session"; fi
  if [ -n "$problem" ]; then
    echo "error: $(git show -s --format='%h %s' "$sha"): $problem" >&2
    bad=1
  fi
done < <(git rev-list "$range")
[ "$bad" = 0 ] && echo "ok: no AI tool as author, co-author or session link in $range"
exit "$bad"
