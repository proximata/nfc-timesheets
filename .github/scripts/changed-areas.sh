#!/usr/bin/env bash
# Which parts of the repo does this change touch? Prints android=/ios=/server=/web= as
# true|false lines for $GITHUB_OUTPUT, so verify.yml only runs the jobs that can be affected.
#
# Needs a full-history checkout (fetch-depth: 0). Anything it cannot diff - a manual run, an
# unrelated history, an edit to this pipeline or to the shared branding file - runs EVERYTHING:
# a skipped job must never be a guess.
#
#   EVENT        github.event_name
#   PR_BASE_SHA  github.event.pull_request.base.sha (pull_request only)
#
# Cross-area dependencies, kept here because they are invisible in the job definitions:
#   web checks read ../server/lib/materials.js (web/scripts/check.mjs), so web also runs for server/**.
set -euo pipefail

base=""
case "${EVENT:-}" in
  pull_request) base="${PR_BASE_SHA:-}" ;;
  push) base="$(git merge-base origin/main HEAD 2>/dev/null || true)" ;;
esac

files=""
run_all=true
if [ -n "$base" ] && files="$(git diff --name-only "$base" HEAD 2>/dev/null)"; then
  run_all=false
  if grep -qxE '\.github/workflows/verify\.yml|\.github/scripts/changed-areas\.sh|ops/branding\.json' <<<"$files"; then
    run_all=true
  fi
fi

touched() {
  [ "$run_all" = true ] && return 0
  grep -qE "$1" <<<"$files"
}

emit() {
  if touched "$2"; then echo "$1=true"; else echo "$1=false"; fi
}

emit android '^android/'
emit ios '^NFCTimeSheets/'
emit server '^server/'
emit web '^(web|server)/'
