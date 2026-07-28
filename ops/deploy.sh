#!/usr/bin/env bash
#
# Build locally, rsync to the VM, migrate, restart. decision-16: no Docker, no CI, no registry.
#
#   ./ops/deploy.sh [host]        # host defaults to timesheets.exe.xyz
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
#   server.js, lib/, routes/, db/, wellknown/, node_modules/   <- server/
#   public/                                                    <- web/out/  (static admin export)
#   ops/                                                       <- ops/      (units, sql, backups)

set -euo pipefail

HOST="${1:-timesheets.exe.xyz}"
DEST=/srv/nfc
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$REPO"

echo "==> 1/6 build the admin export (web/out)"
(cd web && pnpm install --frozen-lockfile && pnpm verify)

echo "==> 2/6 install server runtime deps (pg only, pure JS — safe to ship from macOS)"
(cd server && pnpm install --prod --frozen-lockfile)

[ -d web/out ] || { echo "FATAL: web/out missing — the export did not build" >&2; exit 1; }

echo "==> 3/6 rsync server -> $HOST:$DEST"
# --delete prunes removed server files. public/ and ops/ are the OTHER halves of the artifact
# and live under the same root, so they must be excluded or this wipes them.
rsync -az --delete --exclude 'public/' --exclude 'ops/' \
  ./server/ "$HOST:$DEST/"

echo "==> 4/6 rsync admin export -> $DEST/public  and ops -> $DEST/ops"
rsync -az --delete ./web/out/ "$HOST:$DEST/public/"
rsync -az --delete ./ops/     "$HOST:$DEST/ops/"

echo "==> 5/6 migrate BEFORE restart (new code may need new columns)"
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

echo "==> 6/6 restart"
ssh "$HOST" 'sudo systemctl restart nfc-api && sleep 2 && systemctl is-active nfc-api'

echo "==> verify association files (an NFC tag is worthless if these regress)"
./server/wellknown/verify.sh "$HOST"

echo "deploy ok: $HOST"
