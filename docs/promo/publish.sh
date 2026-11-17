#!/usr/bin/env bash
# One-shot publish: push main + tag, set repo About/topics, enable GitHub Pages (/docs), create the release.
# Safe to re-run. Needs: network access to github.com and `gh auth login` done.
# Usage: docs/promo/publish.sh [version]   (default: version in plugin.json)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

REPO=qiqll/claude-task
VER=${1:-$(python3 -c 'import json;print(json.load(open("plugins/task/.claude-plugin/plugin.json"))["version"])')}
TAG=v$VER

gh auth status >/dev/null 2>&1 || { echo "gh is not logged in: run  gh auth login  first"; exit 1; }
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || { echo "tag $TAG missing locally"; exit 1; }

echo "== push main and $TAG"
git push origin main "$TAG"

echo "== repo About / topics"
gh repo edit "$REPO" \
  --description "Turn Claude Code into a delivery team: backlog in, reviewed & test-verified commits out." \
  --homepage "https://qiqll.github.io/claude-task/" \
  --add-topic claude-code,claude-code-plugin,claude,ai-agent,autonomous-agent,backlog,developer-tools

echo "== GitHub Pages from main:/docs"
if gh api "repos/$REPO/pages" >/dev/null 2>&1; then
  gh api -X PUT "repos/$REPO/pages" -f 'source[branch]=main' -f 'source[path]=/docs' >/dev/null
else
  gh api -X POST "repos/$REPO/pages" -f 'source[branch]=main' -f 'source[path]=/docs' >/dev/null
fi

echo "== release $TAG"
notes=$(awk -v v="## $VER " 'index($0,v)==1{f=1;next} f&&/^## /{exit} f' CHANGELOG.md)
if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  echo "release $TAG already exists, skipped"
else
  gh release create "$TAG" -R "$REPO" --title "$TAG" --notes "$notes"
fi

echo
echo "Done. Remaining manual step (GitHub has no API for it):"
echo "  Settings → General → Social preview → upload docs/assets/og.png"
echo "Pages may take a few minutes: https://qiqll.github.io/claude-task/"
