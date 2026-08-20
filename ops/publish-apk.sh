#!/usr/bin/env bash
#
# Publish an Android build to the self-update surface (`routes/release.js`), and prove the
# version document and the file agree.
#
#   ./ops/publish-apk.sh                    # newest android/dist/*-release.apk -> apiHost
#   ./ops/publish-apk.sh --apk path.apk     # a specific artefact
#   ./ops/publish-apk.sh --verify           # probe the LIVE host only, publish nothing
#   ./ops/publish-apk.sh --host some.host   # default: ops/branding.json apiHost
#
# WHY THIS IS A SCRIPT AND NOT TWO RSYNC LINES IN deploy.sh.
#
# `releases/latest.json` is a promise about bytes: version_code, version_name and sha256,
# all describing a file sitting next to it. A phone in the field reads the promise, compares
# version_code against its own, downloads the file and installs it. Every field is a chance
# to lie:
#
#   version_code too LOW   -> the update is never offered; the fix sits on the box forever.
#   version_code too HIGH  -> the phone downloads, Android refuses the downgrade, and the
#                             app offers the same "update" on every check, for ever.
#   sha256 stale           -> either the phone rejects a good file, or (worse) nobody checks
#                             and a half-rsynced APK installs.
#   `file` names a missing file -> /app/version says "published", /app/download 404s. The
#                             worker sees "Update verfuegbar" and then a failure, which is
#                             indistinguishable from the network being down.
#
# A version document that disagrees with the file is WORSE THAN NO SELF-UPDATE AT ALL,
# because the app trusts it and the operator does not know it is being lied to. So none of
# those three fields is typed by a human here. version_code and version_name are read OUT OF
# THE APK's own binary manifest with `apkanalyzer`, sha256 is computed from the same bytes
# that get rsynced, and the whole thing is read back over HTTP from the live host afterwards
# — including downloading the APK again and comparing it byte for byte with the local file.
#
# THE STALE-ARTEFACT TRAP, ALREADY SPRUNG ONCE (backlog/docs/CORE-FLOW.md §3): android/dist/
# held an apk whose FILENAME said 0.4.0-5 while its bytes were an older build. Deriving the
# version from the filename would have shipped that lie intact. We derive from the binary and
# then assert the filename agrees; a mislabelled artefact is refused, not published.
#
# NOT A ROLLBACK SHELF. One manifest, one APK, always the newest — same scope as
# routes/release.js itself. Rolling back means publishing the older artefact again, which
# Android will refuse to install over a higher version_code anyway; the recovery for a bad
# build is a HIGHER version_code, never a lower one.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

DEST=/srv/nfc
HOST=""
APK=""
VERIFY_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --verify) VERIFY_ONLY=1; shift ;;
    --apk)    APK="${2:-}"; shift 2 ;;
    --host)   HOST="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Same rule as deploy.sh: the host comes from ops/branding.json, never from a literal, or a
# rebrand deploys the new operator's app to the old operator's box.
[ -n "$HOST" ] || HOST="$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')"

# The self-update routes are gated by X-App-Key (auth: "app"), so verifying them needs the
# key. It is never echoed and never written to disk.
APP_KEY="${APP_KEY:-$(psst get APP_KEY 2>/dev/null || true)}"
if [ -z "$APP_KEY" ]; then
  echo "FATAL: no APP_KEY (env or psst). /app/version and /app/download are key-gated," >&2
  echo "       so without it this script can publish but cannot PROVE anything." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAILED=0
ok()   { printf '  ok:   %s\n' "$1"; }
bad()  { printf '  FAIL: %s\n' "$1"; FAILED=1; }

# ---------------------------------------------------------------------------
# verify_live — read the promise back off the live host and check it against the bytes the
# host itself serves. Deliberately independent of anything local: it is also what
# `--verify` runs on a box nobody has just deployed to, and what deploy.sh calls to catch a
# manifest that has drifted away from its file since the last publish.
# ---------------------------------------------------------------------------
verify_live() {
  local base="https://$HOST"
  echo "verifying $base/app/version"

  local code body
  body="$TMP/version.json"
  code=$(curl -sS --max-time 30 -o "$body" -w '%{http_code}' \
         -H "X-App-Key: $APP_KEY" "$base/app/version") || { bad "curl /app/version failed"; return; }
  [ "$code" = "200" ] && ok "GET /app/version 200" || { bad "GET /app/version $code (want 200)"; return; }

  # The key gate itself. A 200 here would mean the APK is on the open web.
  local nokey
  nokey=$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' "$base/app/version")
  [ "$nokey" = "401" ] && ok "GET /app/version without X-App-Key -> 401" \
                       || bad "GET /app/version without X-App-Key -> $nokey (want 401)"

  local published m_code m_name m_sha m_url
  published=$(node -e 'const m=require(process.argv[1]);process.stdout.write(String(m.published))' "$body")
  if [ "$published" != "true" ]; then
    bad "/app/version says published=$published — nothing is published on $HOST"
    return
  fi
  ok "published=true"
  m_code=$(node -e 'process.stdout.write(String(require(process.argv[1]).version_code))' "$body")
  m_name=$(node -e 'process.stdout.write(String(require(process.argv[1]).version_name))' "$body")
  m_sha=$( node -e 'process.stdout.write(String(require(process.argv[1]).sha256))'       "$body")
  m_url=$( node -e 'process.stdout.write(String(require(process.argv[1]).url))'          "$body")

  echo "  manifest: version_name=$m_name version_code=$m_code"
  echo "  manifest: sha256=$m_sha"

  # `url` is a PATH by contract (routes/release.js): the app already knows its host, and a
  # baked-in host here would be a second place a rebrand could drift from.
  [ "$m_url" = "/app/download" ] && ok "url is the path /app/download" \
                                 || bad "url is '$m_url' (want /app/download)"

  case "$m_code" in ''|*[!0-9]*) bad "version_code '$m_code' is not a positive integer" ;;
                    *) ok "version_code $m_code is an integer" ;; esac
  [ "$m_name" != "null" ] && [ -n "$m_name" ] && ok "version_name present" \
                                              || bad "version_name is null"
  [ ${#m_sha} = 64 ] && ok "sha256 is 64 hex chars" || bad "sha256 '$m_sha' is not 64 chars"

  # --- and now the bytes the promise is about ---
  local dl dlcode dltype
  dl="$TMP/downloaded.apk"
  read -r dlcode dltype <<<"$(curl -sS --max-time 300 -o "$dl" -w '%{http_code} %{content_type}' \
        -H "X-App-Key: $APP_KEY" "$base/app/download")"
  [ "$dlcode" = "200" ] && ok "GET /app/download 200" || { bad "GET /app/download $dlcode (want 200)"; return; }
  [ "$dltype" = "application/vnd.android.package-archive" ] && ok "content-type $dltype" \
      || bad "content-type '$dltype' (want application/vnd.android.package-archive)"

  local dlsha dlbytes
  dlsha=$(shasum -a 256 "$dl" | cut -d' ' -f1)
  dlbytes=$(wc -c < "$dl" | tr -d ' ')
  echo "  served:   $dlbytes bytes, sha256=$dlsha"
  # THE ONE ASSERTION THIS SCRIPT EXISTS FOR.
  [ "$dlsha" = "$m_sha" ] && ok "served bytes match the manifest sha256" \
                          || bad "SERVED BYTES DO NOT MATCH THE MANIFEST — the version document is lying"

  # An APK is a zip; a truncated or HTML-error-page body is not. Cheap, catches a proxy that
  # answered 200 with something that is not the file.
  if unzip -l "$dl" >/dev/null 2>&1; then ok "served file is a readable zip (APK container)"
  else bad "served file is not a readable zip — it is not an APK"; fi

  # If the artefact is here locally, byte-for-byte beats comparing a hash to the hash we
  # ourselves published — that comparison only proves the manifest is self-consistent.
  # In --verify mode there is no name to look for, so any dist artefact that compares equal
  # identifies the build; that is the same proof, arrived at from the other side.
  local localapk=""
  if [ -n "${LOCAL_BASENAME:-}" ] && [ -f "android/dist/$LOCAL_BASENAME" ]; then
    localapk="android/dist/$LOCAL_BASENAME"
    if cmp -s "$dl" "$localapk"; then ok "served bytes are byte-for-byte $localapk"
    else bad "served bytes DIFFER from $localapk"; fi
  else
    for f in android/dist/*-release.apk; do
      [ -f "$f" ] || continue
      if cmp -s "$dl" "$f"; then localapk="$f"; break; fi
    done
    if [ -n "$localapk" ]; then ok "served bytes are byte-for-byte $localapk"
    else printf '  note: no local artefact matches the served bytes (nothing to compare)\n'; fi
  fi
}

# ---------------------------------------------------------------------------
# publish
# ---------------------------------------------------------------------------
if [ "$VERIFY_ONLY" = "0" ]; then
  if [ -z "$APK" ]; then
    APK="$(ls -1t android/dist/*-release.apk 2>/dev/null | head -n1 || true)"
  fi
  [ -n "$APK" ] && [ -f "$APK" ] || {
    echo "FATAL: no release APK found (looked in android/dist/). Build one: cd android && ./dist-apk.sh" >&2
    exit 1
  }

  # Version comes out of the BINARY MANIFEST, never the filename. See the header.
  APKANALYZER="${APKANALYZER:-${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/cmdline-tools/latest/bin/apkanalyzer}"
  [ -x "$APKANALYZER" ] || {
    echo "FATAL: apkanalyzer not found at $APKANALYZER. Set ANDROID_HOME or APKANALYZER." >&2
    echo "       Refusing to fall back to parsing the filename: the filename is exactly what" >&2
    echo "       lied last time (backlog/docs/CORE-FLOW.md §3)." >&2
    exit 1
  }
  export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
  # apkanalyzer prints a harmless `test: : integer expression expected` on stderr from its own
  # launcher script; only stdout is read.
  VCODE="$("$APKANALYZER" manifest version-code "$APK" 2>/dev/null | tr -d '[:space:]')"
  VNAME="$("$APKANALYZER" manifest version-name "$APK" 2>/dev/null | tr -d '[:space:]')"
  case "$VCODE" in ''|*[!0-9]*) echo "FATAL: apkanalyzer gave version-code '$VCODE'" >&2; exit 1 ;; esac
  [ -n "$VNAME" ] || { echo "FATAL: apkanalyzer gave an empty version-name" >&2; exit 1; }

  BASENAME="$(basename "$APK")"
  LOCAL_BASENAME="$BASENAME"
  EXPECTED="nfc-timesheets-$VNAME-$VCODE-release.apk"
  if [ "$BASENAME" != "$EXPECTED" ]; then
    echo "FATAL: the artefact is mislabelled." >&2
    echo "       file says:   $BASENAME" >&2
    echo "       bytes say:   $EXPECTED  (versionName $VNAME, versionCode $VCODE)" >&2
    echo "       This is the stale-apk trap from CORE-FLOW §3. Rebuild, do not rename." >&2
    exit 1
  fi
  SHA="$(shasum -a 256 "$APK" | cut -d' ' -f1)"
  BYTES="$(wc -c < "$APK" | tr -d ' ')"

  echo "==> publishing $BASENAME"
  echo "    versionName $VNAME   versionCode $VCODE   $BYTES bytes"
  echo "    sha256 $SHA"

  # `notes` is what the app shows the operator. Kept short and German (decision-8) — it is
  # read on a phone, in a stairwell, by someone who wants to know whether to press install.
  NOTES="${RELEASE_NOTES:-Fehlerbehebungen und Verbesserungen.}"
  node -e '
    const [file, version_name, version_code, sha256, notes] = process.argv.slice(1);
    process.stdout.write(JSON.stringify(
      { version_code: Number(version_code), version_name, file, sha256, notes }, null, 2) + "\n");
  ' "$BASENAME" "$VNAME" "$VCODE" "$SHA" "$NOTES" > "$TMP/latest.json"
  sed 's/^/    /' "$TMP/latest.json"

  echo "==> rsync -> $HOST:$DEST/releases/"
  # THE APK FIRST, THE MANIFEST SECOND, AND NEVER --delete.
  # Order is load-bearing for exactly the reason the header lists: a manifest that lands
  # before its file names a file that is not there yet, and every /app/download in that
  # window 404s at a phone that was just told an update exists. The reverse order is
  # harmless: an APK on disk that no manifest names is invisible.
  ssh "$HOST" "sudo install -d -o exedev -g app -m 0750 $DEST/releases"
  rsync -az "$APK" "$HOST:$DEST/releases/$BASENAME"
  rsync -az "$TMP/latest.json" "$HOST:$DEST/releases/latest.json"
  # The service runs as `app`, which is in the group but must never be able to rewrite its
  # own payload — same posture deploy.sh sets for the rest of /srv/nfc.
  ssh "$HOST" "sudo chown -R exedev:app $DEST/releases && sudo chmod -R g-w,o-rwx $DEST/releases && ls -l $DEST/releases"
  echo
fi

verify_live

echo
if [ "$FAILED" -ne 0 ]; then
  echo "PUBLISH VERIFY FAILED — the phone must not be pointed at this."
  exit 1
fi
echo "PUBLISH VERIFY OK — $HOST serves an APK its own version document describes."
