#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
stamp="$(git rev-parse --git-path custom-upstream-check)"
today=$(date +%F)
if [[ ! -f "$stamp" ]] || [[ $(cat "$stamp") != "$today" ]]; then
  git fetch --no-tags upstream dev
  printf '%s\n' "$today" > "$stamp"
fi
git log --oneline HEAD..upstream/dev
git rev-list --left-right --count HEAD...upstream/dev
# Integration is explicit: inspect changes, merge upstream/dev, test, then push origin.
