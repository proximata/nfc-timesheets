#!/usr/bin/env bash
# Gate for TASK-6 (physical tag writing). If this fails, DO NOT write tags:
# a wrong AASA response means every tag in every building must be rewritten by hand.
#
# Asserts, for both association files:
#   HTTP 200, Content-Type exactly "application/json", ZERO redirect hops,
#   and the LIVE BODY BYTE-FOR-BYTE EQUAL to the reviewed file next to this script.
# Plus: the host being probed is the one in ops/branding.json, the committed files still
# match ops/branding.json, and /t answers 200 text/html.
#
# The byte comparison is the point. A substring match ("does it mention our appID?") passes
# on a file that ALSO carries a stale appID, a widened `paths`, or a second operator's
# bundle - and every one of those ships silently, because a wrong AASA does not error, it
# just makes iOS open Safari while a worker stands at a door.
#
# NO team id, bundle id or package name is spelled out in this file. Operator identity lives
# in ops/branding.json (see ops/REBRAND.md); a literal here would be one more place to
# forget during a handover.
#
# usage: ./verify.sh [host]        default host: from ops/branding.json
#        SCHEME=http ./verify.sh 127.0.0.1:8080     (local pre-deploy smoke test)
#        ./verify.sh some.host --host-override      (deliberately probing another host)
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ops/branding.json sits at ../../ops in the repo and at ../ops on the VM (/srv/nfc/wellknown
# next to /srv/nfc/ops). Probe both rather than guessing which side is running this.
BRANDING=""
for candidate in "$DIR/../../ops/branding.json" "$DIR/../ops/branding.json"; do
  [ -f "$candidate" ] && { BRANDING="$candidate"; break; }
done

FAILED=0
fail() { printf '  FAIL: %s\n' "$1"; FAILED=1; }
ok()   { printf '  ok:   %s\n' "$1"; }
warn() { printf '  warn: %s\n' "$1"; }

# Pull one dotted path out of branding.json. Node is already a hard requirement on both the
# dev machine and the VM (it is what runs the API), so this adds no dependency.
brand() {
  node -e '
    const b = require(process.argv[1]);
    let v = b;
    for (const k of process.argv[2].split(".")) v = v?.[k];
    process.stdout.write(Array.isArray(v) ? v.join("\n") : String(v ?? ""));
  ' "$BRANDING" "$1" 2>/dev/null
}

HOST_ARG="${1:-}"
[ "$HOST_ARG" = "--host-override" ] && HOST_ARG=""
OVERRIDE=0
for a in "$@"; do [ "$a" = "--host-override" ] && OVERRIDE=1; done

SCHEME="${SCHEME:-https}"
CONFIGURED_HOST=""
if [ -n "$BRANDING" ] && command -v node >/dev/null 2>&1; then
  CONFIGURED_HOST="$(brand host)"
fi

HOST="${HOST_ARG:-${CONFIGURED_HOST:-timesheets.exe.xyz}}"
BASE="$SCHEME://$HOST"

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

# $1 url, $2 reference file next to this script.
# Compares the LIVE body to the reviewed bytes. The reference file is the artifact that was
# read in a `git diff` before it went anywhere near a wall.
check_body() {
  local url="$1" reference="$DIR/$2"
  if [ ! -f "$reference" ]; then
    fail "reference file missing: $reference"
    return
  fi
  local live
  live=$(curl -sS --max-time 15 "$url" 2>&1) || { fail "curl error fetching body: $live"; return; }
  if [ "$live" = "$(cat "$reference")" ]; then
    ok "body identical to $2"
  else
    fail "body DIFFERS from the reviewed $2 - the deployed file is not the reviewed one"
    printf '    --- live ---\n'
    printf '%s\n' "$live" | sed 's/^/    /'
    printf '    --- expected (%s) ---\n' "$2"
    sed 's/^/    /' "$reference"
  fi
}

echo "verifying $BASE"
echo

# 0. Are we even probing the right host? A green verify against the WRONG host is worse than
#    a red one: it says "safe to write tags" about a host the app was never told to trust.
if [ -z "$BRANDING" ]; then
  warn "ops/branding.json not found - host and config checks skipped (byte comparison still runs)"
elif ! command -v node >/dev/null 2>&1; then
  warn "node not on PATH - host and config checks skipped (byte comparison still runs)"
elif [ "$OVERRIDE" = "1" ]; then
  warn "--host-override: not checking $HOST against branding.json host $CONFIGURED_HOST"
elif [ "$SCHEME" != "https" ]; then
  warn "SCHEME=$SCHEME: treated as a local smoke test, host not checked against branding.json"
elif [ "$HOST" = "$CONFIGURED_HOST" ]; then
  ok "host $HOST is the configured tag host"
else
  fail "host $HOST is NOT the configured tag host $CONFIGURED_HOST (ops/branding.json). Tags carry $CONFIGURED_HOST."
fi

# 0b. Do the committed files still match ops/branding.json? Runs only in the repo layout,
#     where the generator is present.
if [ -f "$DIR/../../ops/gen-wellknown.mjs" ] && command -v node >/dev/null 2>&1; then
  if node "$DIR/../../ops/gen-wellknown.mjs" >/dev/null 2>&1; then
    ok "committed association files match ops/branding.json"
  else
    fail "committed association files do NOT match ops/branding.json - run: node ops/gen-wellknown.mjs"
  fi
fi
echo

# NOTE: no .json extension, on the filename or the URL. Apple requires exactly this path.
check "$BASE/.well-known/apple-app-site-association" "application/json" "200"
check_body "$BASE/.well-known/apple-app-site-association" "apple-app-site-association"
echo
check "$BASE/.well-known/assetlinks.json" "application/json" "200"
check_body "$BASE/.well-known/assetlinks.json" "assetlinks.json"
echo
# UUID-shaped probe: a real tag carries ?l=<location uuid>, never a slug (decision-21).
check "$BASE/t?l=3f2504e0-4f89-11d3-9a0c-0305e82c3301" "text/html; charset=utf-8" "200"
echo

# Android App Links cannot be proven from here. The only real proof is on a physical device,
# so print the command rather than implying this script covered it.
if [ -n "$BRANDING" ] && command -v node >/dev/null 2>&1; then
  FINGERPRINTS="$(brand android.sha256CertFingerprints)"
  PACKAGE="$(brand android.packageName)"
  if [ -z "$FINGERPRINTS" ]; then
    warn "android.sha256CertFingerprints is EMPTY - Android App Links are unverified and every Android tap opens the browser"
  else
    ok "android.sha256CertFingerprints has $(printf '%s\n' "$FINGERPRINTS" | wc -l | tr -d ' ') entry/entries"
    echo "  NOT PROVEN HERE - run on a physical Android device:"
    echo "    adb shell pm get-app-links $PACKAGE"
    echo "  It must report '$HOST: verified'. Anything else and taps open Chrome."
  fi
  echo
fi

if [ "$FAILED" -ne 0 ]; then
  echo "VERIFY FAILED - do not write NFC tags."
  exit 1
fi
echo "VERIFY OK - safe to write NFC tags."
