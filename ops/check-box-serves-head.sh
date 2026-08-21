#!/usr/bin/env bash
#
# DOES THE BOX SERVE THIS TREE? (TASK-231)
#
#   ./ops/check-box-serves-head.sh [host]
#
# THE FAILURE THIS EXISTS FOR HAS NOW HAPPENED THREE TIMES IN ONE WEEK, each time with every
# local check green:
#
#   2026-08-21 02:16  thirteen web fixes committed, none deployed. STATE-OF-THE-PRODUCT § 0.
#   2026-08-21 06:26  the APK with the offline-push fix sat in android/dist while the box
#                     served 0.4.1/6 — the build whose background push is dead AND in which
#                     opening the app from Recents closes the worker's shift.
#   2026-08-21 10:22  nine clarity fixes committed 10:28–11:22 CEST over a box last written
#                     at 10:22. Found by this verdict pass, which had to deploy them itself.
#
# Every one of those was invisible because the repo's checks answer "is the code right",
# and none of them answers "is the code THERE". This one asks only the second question.
#
# WHY IT HASHES OVER SSH RATHER THAN CURLING. A served file can be right while a sibling is
# stale, and 404.html, index.txt and the RSC payload files are not reachable by guessing URLs
# at all. `find | sort | sha256sum` over the whole directory compares the ARTEFACT, not a
# sample of it. It also catches the opposite failure — files on the box that this tree does
# not have — which a per-URL check structurally cannot see.
#
# WHAT IT DOES NOT DO: it does not build. Build first, WITH THE SAME ENVIRONMENT ops/deploy.sh
# uses, or it compares the box against a different artefact and reports a difference that is
# its own fault:
#
#   cd web && NEXT_PUBLIC_DEFAULT_LOCALE=de \
#     NEXT_PUBLIC_GOOGLE_MAPS_KEY="$(cd .. && psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY)" pnpm build
#
# Measured, not guessed: this file's own instruction used to read `cd web && pnpm build`, and a
# keyless build changes four content-hashed chunks, so the check said „the box is NOT serving
# this tree" about a box that was.
#
# AND THE BUILD MUST BE REPRODUCIBLE, which is `web/next.config.mjs`'s job, not this file's.
# Next's default build id is random and is embedded in all 133 emitted .html/.txt files, so
# with it this check can never be green — the same commit built twice does not equal itself.
# `generateBuildId` derives the id from the commit for exactly this reason. If this check
# fails ONLY on .html/.txt files while `_next/static/chunks` and `css` match (§ 1a below says
# so explicitly), the code IS on the box and the build ids differ — a dirty tree, or a build
# from a different commit.
#
# It says so out loud when web/out is older than the newest file under web/.
#
# SHOW IT RED:  ./ops/check-box-serves-head.sh --mutate
#   perturbs the LOCAL side by one byte and runs the same comparison, which must fail.
#   Deliberately not a write to the box: the first version appended a byte to a file under
#   /srv/nfc/public and restored it in a trap, and `--mutate | head -8` still killed the
#   script on SIGPIPE before the trap and left graffiti on production. A negative case is
#   not worth a write to a live box when a local perturbation proves the same comparison.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

MUTATE=0
if [ "${1:-}" = "--mutate" ]; then MUTATE=1; shift; fi
HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"

FAILED=0
ok()  { echo "  ok:   $*"; }
bad() { echo "  FAIL: $*"; FAILED=1; }

echo "does $HOST serve this working tree?"

# ---- 0 · is web/out even this tree's? ---------------------------------------------------
if [ ! -d web/out ]; then
  bad "web/out does not exist — run 'cd web && pnpm build' first"
  exit 1
fi
newest_src=$(find web/app web/components web/lib web/messages -type f -newer web/out/index.html 2>/dev/null | head -3)
if [ -n "$newest_src" ]; then
  bad "web/out is OLDER than web/ source — comparing the box against a stale build proves nothing:"
  echo "$newest_src" | sed 's/^/        /'
else
  ok "web/out is at least as new as everything under web/"
fi

# ---- 1 · the admin bundle ---------------------------------------------------------------
# `cd` first so the paths inside the listing are relative and comparable across machines.
local_web=$(cd web/out && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1)
remote_web=$(ssh "$HOST" "cd /srv/nfc/public && find . -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -d' ' -f1")

if [ "$MUTATE" = "1" ]; then
  echo "  (mutant: one byte added to the LOCAL side — nothing on the box is touched)"
  mutant_dir=$(mktemp -d)
  trap 'rm -rf "$mutant_dir"' EXIT INT TERM
  cp -R web/out/. "$mutant_dir/"
  printf x >> "$mutant_dir/index.txt"
  # AND one byte into a real chunk, so § 1a is falsifiable too. Without this the mutant only
  # ever reddened § 1, and § 1a — the assertion that actually means "the fix is live" — was
  # a line that could not fail.
  printf ';' >> "$(find "$mutant_dir/_next/static/chunks" -name '*.js' | LC_ALL=C sort | head -1)"
  local_web=$(cd "$mutant_dir" && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1)
  MUTANT_DIR_FOR_CODE="$mutant_dir"
fi

# 1a · the content-addressed half, reported SEPARATELY and always.
# chunks/ css/ media/ are named by a hash OF THEIR OWN CONTENT, so this pair answers "is the
# code and the stylesheet the director downloads the code in this tree" with no build-id
# noise in it. When § 1 fails and this passes, nobody needs to read a 176-line diff to learn
# that the answer is yes.
# `-name '*'` over the whole tree MINUS the build-id directory, rather than naming chunks/
# css/ media/: `find chunks css media` exits 1 when media/ does not exist, and under
# `set -e -o pipefail` that killed this script silently after one ok: line.
CODE_FIND="find . -type f ! -path './[A-Za-z0-9_-]*/_buildManifest.js' ! -name '_buildManifest.js' ! -name '_ssgManifest.js' ! -name '_clientMiddlewareManifest.json'"
local_code=$(cd "${MUTANT_DIR_FOR_CODE:-web/out}/_next/static" && eval "$CODE_FIND" | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1)
remote_code=$(ssh "$HOST" "cd /srv/nfc/public/_next/static && $CODE_FIND | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -d' ' -f1")
if [ "$local_code" = "$remote_code" ]; then
  ok "the JS and CSS the browser downloads are this tree's, byte for byte ($local_code)"
else
  bad "the JS/CSS on the box DIFFERS from this tree — this is the one that means the fix is not live"
fi

if [ "$local_web" = "$remote_web" ]; then
  ok "the admin bundle on the box is web/out, file for file ($local_web)"
else
  bad "the admin bundle DIFFERS: local $local_web != box $remote_web"
  echo "        the box is NOT serving this tree. Run ./ops/deploy.sh."
  # Name the files, not just the verdict: 'something differs' is not actionable at 3am.
  local_list=$(cd "${mutant_dir:-web/out}" && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | sed 's/^\([0-9a-f]*\)  /\1 /')
  remote_list=$(ssh "$HOST" "cd /srv/nfc/public && find . -type f | LC_ALL=C sort | xargs sha256sum | sed 's/^\([0-9a-f]*\)  /\1 /'")
  diff <(echo "$local_list") <(echo "$remote_list") | head -20 | sed 's/^/        /'
fi


# ---- 2 · the server ---------------------------------------------------------------------
# server/ is FLATTENED on the box (/srv/nfc/lib, /srv/nfc/routes, /srv/nfc/server.js), so this
# names the files rather than diffing a directory tree that has a different shape.
for f in server.js instrument.mjs; do
  l=$(shasum -a 256 "server/$f" | cut -d' ' -f1)
  r=$(ssh "$HOST" "sha256sum /srv/nfc/$f | cut -d' ' -f1")
  [ "$l" = "$r" ] && ok "server/$f is on the box" || bad "server/$f DIFFERS (local $l, box $r)"
done
for d in lib routes; do
  l=$(cd "server/$d" && find . -type f -name '*.js' ! -name '*.test.js' | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1)
  r=$(ssh "$HOST" "cd /srv/nfc/$d && find . -type f -name '*.js' ! -name '*.test.js' | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -d' ' -f1")
  [ "$l" = "$r" ] && ok "server/$d/ is on the box" || bad "server/$d/ DIFFERS (local $l, box $r)"
done

# ---- 3 · the APK the field phone is offered ---------------------------------------------
# The same trap, one artefact over: the fix can be built, signed, committed and still not be
# what /app/version names.
manifest=$(ssh "$HOST" "cat /srv/nfc/releases/latest.json")
apk_file=$(echo "$manifest" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).file))')
apk_code=$(echo "$manifest" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).version_code)))')
newest_apk=$(ls android/dist/*.apk 2>/dev/null | LC_ALL=C sort -V | tail -1 | xargs -r basename)
if [ -z "$newest_apk" ]; then
  ok "no android/dist/*.apk in this tree — nothing to compare"
elif [ "$newest_apk" = "$apk_file" ]; then
  la=$(shasum -a 256 "android/dist/$apk_file" | cut -d' ' -f1)
  ra=$(ssh "$HOST" "sha256sum /srv/nfc/releases/$apk_file | cut -d' ' -f1")
  [ "$la" = "$ra" ] && ok "the published APK is $apk_file (versionCode $apk_code), byte for byte" \
                    || bad "the published APK has the right NAME and the wrong BYTES"
else
  bad "the newest local APK is $newest_apk but the box publishes $apk_file (versionCode $apk_code) — run ./ops/publish-apk.sh"
fi

# ---- 4 · and is that tree committed? -----------------------------------------------------
# A box that matches an UNCOMMITTED working tree is not reproducible: nobody else can rebuild
# what it serves. Reported, not fatal — deploying from a dirty tree is sometimes deliberate.
if [ -n "$(git status --porcelain -- web server android/dist ops)" ]; then
  echo "  note: the working tree is dirty under web/ server/ android/dist/ ops/ —"
  git status --porcelain -- web server android/dist ops | head -8 | sed 's/^/        /'
  echo "        the box may match this tree, but no commit describes what it serves."
else
  ok "the tree that matches the box is committed ($(git rev-parse --short HEAD))"
fi

echo
[ "$FAILED" = "0" ] && echo "CHECK-BOX-SERVES-HEAD OK — $HOST" || { echo "CHECK-BOX-SERVES-HEAD FAILED — $HOST"; exit 1; }
