#!/usr/bin/env bash
#
# Build locally, rsync to the VM, migrate, restart. decision-16: no Docker, no CI, no registry.
#
#   ./ops/deploy.sh [host]        # host defaults to ops/branding.json `apiHost`
#
# THIS DEPLOYS THE API HOST ONLY. The TAG host (ops/branding.json `tagHost`) is a separate,
# deliberately boring box that serves three static files and is deployed by
# ops/tag-host/deploy.sh (decision-40). Renaming or rebuilding the API box is safe; the tag
# host is written onto physical NFC tags and is permanent.
#
# ponytail: a shell script, not a Makefile and not a CI pipeline. Ladder step 5/6 — this is
#   four rsyncs and two ssh commands. It exists as a script rather than a README paragraph for
#   exactly one reason: ORDER IS LOAD-BEARING. Migrations must land before the process that
#   queries the new columns restarts, and `--delete` must never be pointed at a directory that
#   holds the other half of the artifact. Both are easy to get wrong by hand and both fail in
#   production, not here. Ceiling: no build-id, no rollback, no health gate beyond the curl at
#   the end. Upgrade path: a GitHub Action running these same lines against a deploy key.
#
# Artifact layout on the VM (/srv/nfc):
#   server.js, instrument.mjs, lib/, routes/, db/, wellknown/, node_modules/   <- server/
#   public/                                                    <- web/out/  (static admin export)
#   ops/                                                       <- ops/      (units, sql, backups)

set -euo pipefail

DEST=/srv/nfc
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$REPO"

# Default host comes from ops/branding.json, not a literal here. A literal survives a
# rebrand and then deploys the new operator's code to the OLD operator's box.
HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"

echo "==> 0/8 operator identity (ops/branding.json is the source of truth)"
# BEFORE the build and before any rsync. Both are cheap and both gate the one failure in this
# product that costs a site visit: a served association file that does not name this app.
# Nothing further down can fix that, so nothing further down runs until it holds.
node ops/gen-wellknown.mjs
node ops/check-branding.mjs

echo "==> 0b/8 will the pending migrations even apply? (nothing has moved yet)"
# A MIGRATION IS ALLOWED TO REFUSE. 006 raises rather than inventing an hourly wage for a
# rate-less worker (decision-41) and production carries exactly such a row, so this deploy
# WILL stop here until a human sets or removes it.
#
# WHY IT MOVED TO THE TOP. Step 5 was the first thing that touched the database, and by then
# steps 3 and 4 had already rsynced the new admin bundle into $DEST/public, where the RUNNING
# API serves it immediately — no restart needed for a static export. A refusal at step 5 then
# left the box holding new screens on an old schema: the exact window in which /workers/ and
# /payroll/, having deleted their „no hourly rate" copy because 006 makes that state
# unrepresentable, render a leftover zero as a confident EUR 0,00 wage.
#
# It uses the migration files themselves (`--dry-run` applies each pending file in a
# transaction and rolls it back), so it gates 007 and everything after it without anyone
# remembering to update a guard here. It writes NOTHING.
ssh "$HOST" 'sudo bash -euc "
  set -a; . /etc/nfc/env; set +a
  node '"$DEST"'/db/migrate.js --dry-run
"' || {
  echo "FATAL: the pending migrations do not apply to the live database. NOTHING was deployed." >&2
  echo "       Deal with what it printed above (server/db/README.md), then re-run." >&2
  exit 1
}

echo "==> 1/8 build the admin export (web/out)"
# NEXT_PUBLIC_DEFAULT_LOCALE is baked into the bundle at BUILD time, and this build runs on a
# developer's machine. web/.env.local is gitignored, so whatever locale that untracked file
# happens to hold would otherwise decide the language the director sees in production. A shell
# variable beats .env.local in Next, so setting it here makes the shipped default German
# (decision-8) regardless of who runs the deploy. English is still one click away in the UI.
#
# THE MAPS KEY IS BAKED IN AT BUILD TIME TOO, and it was not being passed. The map is the
# landing surface (decision-39) and the director has never seen a pin: every production
# bundle so far has been built with no key, so the dashboard renders its degraded state.
#
# ADDING IT HERE IS HALF THE FIX AND NOT THE WHOLE ONE. Measured with a real headless
# Chrome against a local build carrying this key, fronted under each real hostname:
#
#   https://timesheets.exe.xyz/       map loads     <- the box's name BEFORE the rename
#   https://schimmer-glanz.exe.xyz/   RefererNotAllowedMapError
#
# The key's HTTP-referrer allowlist is one rename behind, so it refuses the host that
# actually serves the admin. Until somebody adds https://<apiHost>/* in the Google Cloud
# console the pin still will not draw - it will just fail for a different reason, in a
# console nobody opens. `node demo/check-map-key.mjs` is what says whether that is done.
#
# A MISSING KEY REFUSES rather than quietly shipping the degraded map, because "the deploy
# worked and the map is empty" is how this went unnoticed for two weeks. ALLOW_NO_MAP_KEY=1
# is the deliberate way past it.
MAPS_KEY="${NEXT_PUBLIC_GOOGLE_MAPS_KEY:-$(psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY 2>/dev/null || true)}"
if [ -z "$MAPS_KEY" ] && [ "${ALLOW_NO_MAP_KEY:-}" != "1" ]; then
  echo "FATAL: no NEXT_PUBLIC_GOOGLE_MAPS_KEY (env or psst). The dashboard is the map" >&2
  echo "       (decision-39) and a key-less bundle ships it empty. Unlock the vault, or" >&2
  echo "       re-run with ALLOW_NO_MAP_KEY=1 if that is genuinely what you want." >&2
  exit 1
fi
(cd web && pnpm install --frozen-lockfile \
  && NEXT_PUBLIC_DEFAULT_LOCALE=de NEXT_PUBLIC_GOOGLE_MAPS_KEY="$MAPS_KEY" pnpm verify)

echo "==> 2/8 install server runtime deps (pg + @sentry/node, both pure JS — safe to ship from macOS)"
(cd server && pnpm install --prod --frozen-lockfile)

# node_modules is built HERE (macOS) and rsynced to Linux, which is only safe while every
# dependency is pure JavaScript. A native addon would ship a darwin-arm64 .node binary to an
# x86 Linux box and the service would crash-loop on import. @sentry/profiling-node is exactly
# such a package and must never be added (decision-23). Gate, not a comment:
if find server/node_modules -name '*.node' -print -quit | grep -q .; then
  echo "FATAL: a native addon is in server/node_modules — the macOS->Linux rsync is unsafe." >&2
  find server/node_modules -name '*.node' >&2
  exit 1
fi

[ -d web/out ] || { echo "FATAL: web/out missing — the export did not build" >&2; exit 1; }

echo "==> 3/8 rsync server -> $HOST:$DEST"
# --delete prunes removed server files. public/ and ops/ are the OTHER halves of the artifact
# and live under the same root, so they must be excluded or this wipes them.
# Test material is excluded on purpose: check-api.js CREATEs and DROPs schemas and
# seed.sql inserts demo workers. Neither belongs next to a payroll database where a
# stray `node check-api.js` in the wrong directory is a very bad afternoon.
rsync -az --delete --exclude 'public/' --exclude 'ops/' \
  --exclude 'check-*.js' --exclude 'check-*.mjs' \
  --exclude '*.test.js' --exclude 'db/seed.sql' \
  ./server/ "$HOST:$DEST/"

echo "==> 4/8 rsync admin export -> $DEST/public  and ops -> $DEST/ops"
rsync -az --delete ./web/out/ "$HOST:$DEST/public/"
rsync -az --delete ./ops/     "$HOST:$DEST/ops/"

echo "==> 5/8 migrate BEFORE restart (new code may need new columns)"
# /etc/nfc/env is 0640 root:app; sudo to read it. Secrets stay on the VM, never echoed.
# Owner is the DEPLOY user (exedev) so rsync can write; group is the SERVICE user (app),
# read-only. app is a --system user with no shell and no sudo: if the API is ever popped,
# it cannot rewrite its own code, and it cannot escalate the way the sudo-group exedev could.
ssh "$HOST" 'sudo bash -euc "
  chown -R exedev:app '"$DEST"'
  chmod -R g-w,o-rwx '"$DEST"'
  chmod +x '"$DEST"'/ops/backup/*.sh
  set -a; . /etc/nfc/env; set +a
  node '"$DEST"'/db/migrate.js
"'

echo "==> 6/8 restart"
ssh "$HOST" 'sudo systemctl restart nfc-api && sleep 2 && systemctl is-active nfc-api'

echo "==> 7/8 verify association files (an NFC tag is worthless if these regress)"
# The API host serves the association files too, and it must keep serving the SAME BYTES:
# it is what iOS is still associated with, and it is the fallback for any tag written before
# the split. --host-override says "yes, on purpose, this is not the tag host".
./server/wellknown/verify.sh "$HOST" --host-override

echo "==> and the TAG host, which is what is actually on the walls"
# Not deployed by this script and deliberately not restarted by it - only checked. If this
# fails, tags are dead and no amount of redeploying the API fixes it.
./server/wellknown/verify.sh

echo "deploy ok: $HOST"
