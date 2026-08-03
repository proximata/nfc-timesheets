#!/usr/bin/env bash
#
# Build locally, rsync to the VM, migrate, restart. decision-16: no Docker, no CI, no registry.
#
#   ./ops/deploy.sh [host]        # host defaults to ops/branding.json `host`
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
HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").host)')}"

echo "==> 0/7 operator identity (ops/branding.json is the source of truth)"
# BEFORE the build and before any rsync. Both are cheap and both gate the one failure in this
# product that costs a site visit: a served association file that does not name this app.
# Nothing further down can fix that, so nothing further down runs until it holds.
node ops/gen-wellknown.mjs
node ops/check-branding.mjs

echo "==> 1/7 build the admin export (web/out)"
# NEXT_PUBLIC_DEFAULT_LOCALE is baked into the bundle at BUILD time, and this build runs on a
# developer's machine. web/.env.local is gitignored, so whatever locale that untracked file
# happens to hold would otherwise decide the language the director sees in production. A shell
# variable beats .env.local in Next, so setting it here makes the shipped default German
# (decision-8) regardless of who runs the deploy. English is still one click away in the UI.
(cd web && pnpm install --frozen-lockfile && NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm verify)

echo "==> 2/7 install server runtime deps (pg + @sentry/node, both pure JS — safe to ship from macOS)"
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

echo "==> 3/7 rsync server -> $HOST:$DEST"
# --delete prunes removed server files. public/ and ops/ are the OTHER halves of the artifact
# and live under the same root, so they must be excluded or this wipes them.
# Test material is excluded on purpose: check-api.js CREATEs and DROPs schemas and
# seed.sql inserts demo workers. Neither belongs next to a payroll database where a
# stray `node check-api.js` in the wrong directory is a very bad afternoon.
rsync -az --delete --exclude 'public/' --exclude 'ops/' \
  --exclude 'check-*.js' --exclude 'check-*.mjs' \
  --exclude '*.test.js' --exclude 'db/seed.sql' \
  ./server/ "$HOST:$DEST/"

echo "==> 4/7 rsync admin export -> $DEST/public  and ops -> $DEST/ops"
rsync -az --delete ./web/out/ "$HOST:$DEST/public/"
rsync -az --delete ./ops/     "$HOST:$DEST/ops/"

echo "==> 5/7 migrate BEFORE restart (new code may need new columns)"
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

echo "==> 6/7 restart"
ssh "$HOST" 'sudo systemctl restart nfc-api && sleep 2 && systemctl is-active nfc-api'

echo "==> 7/7 verify association files (an NFC tag is worthless if these regress)"
./server/wellknown/verify.sh "$HOST"

echo "deploy ok: $HOST"
