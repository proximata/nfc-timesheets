#!/usr/bin/env bash
# Gate for TASK-6 (physical tag writing). If this fails, DO NOT write tags:
# a wrong AASA response means every tag in every building must be rewritten.
#
# Asserts, for both association files:
#   HTTP 200, Content-Type exactly "application/json", ZERO redirect hops.
# Plus a non-fatal-to-tags but still required check that /t answers 200 text/html.
#
# usage: ./verify.sh [host]        default host: timesheets.exe.xyz
#        SCHEME=http ./verify.sh 127.0.0.1:8080     (local pre-deploy smoke test)
set -uo pipefail

HOST="${1:-timesheets.exe.xyz}"
SCHEME="${SCHEME:-https}"
BASE="$SCHEME://$HOST"
FAILED=0

fail() { printf '  FAIL: %s\n' "$1"; FAILED=1; }
ok()   { printf '  ok:   %s\n' "$1"; }

# $1 url, $2 expected content-type (exact), $3 expected status
check() {
  local url="$1" want_type="$2" want_status="$3"
  printf '%s\n' "$url"

  # -L so a redirect-then-200 is still visible as num_redirects > 0.
  local out
  out=$(curl -sS -L --max-redirs 5 --max-time 15 -o /dev/null \
        -w '%{http_code}\t%{content_type}\t%{num_redirects}\n' "$url" 2>&1) || {
    fail "curl error: $out"
    return
  }

  local status type redirects
  IFS=$'\t' read -r status type redirects <<<"$out"

  [ "$status" = "$want_status" ] && ok "status $status" || fail "status $status (want $want_status)"
  [ "$redirects" = "0" ] && ok "0 redirect hops" || fail "$redirects redirect hop(s) - iOS will not follow"
  # Exact match: iOS rejects text/plain, and "application/json; charset=utf-8" is
  # tolerated by iOS but we keep it strict so the served bytes stay predictable.
  if [ "$type" = "$want_type" ]; then
    ok "content-type $type"
  else
    fail "content-type '$type' (want exactly '$want_type')"
  fi
}

echo "verifying $BASE"
echo
# NOTE: no .json extension, on the filename or the URL. Apple requires exactly this path.
check "$BASE/.well-known/apple-app-site-association" "application/json" "200"
echo
check "$BASE/.well-known/assetlinks.json" "application/json" "200"
echo
# UUID-shaped probe: a real tag carries ?l=<location uuid>, never a slug (decision-21).
check "$BASE/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301" "text/html; charset=utf-8" "200"
echo

# Body sanity: the AASA must actually name our appID and the /t* path pattern.
AASA=$(curl -sS --max-time 15 "$BASE/.well-known/apple-app-site-association" || echo "")
case "$AASA" in
  *"6Y842FE8Q4.io.github.qwadratic.NFCTimeSheets"*) ok "AASA contains appID" ;;
  *) fail "AASA does not contain appID 6Y842FE8Q4.io.github.qwadratic.NFCTimeSheets" ;;
esac
case "$AASA" in
  *'"/t*"'*) ok 'AASA contains path "/t*"' ;;
  *) fail 'AASA does not contain path "/t*"' ;;
esac

echo
if [ "$FAILED" -ne 0 ]; then
  echo "VERIFY FAILED - do not write NFC tags."
  exit 1
fi
echo "VERIFY OK - safe to write NFC tags."
