#!/usr/bin/env bash
#
# Deploy THE TAG HOST (decision-40): three static files and one nginx config.
#
#   ./ops/tag-host/deploy.sh [host]     # host defaults to ops/branding.json `tagHost`
#
# This is NOT ops/deploy.sh. That one ships the admin panel, the API and the database to the
# RENAMEABLE host. This one ships three files to the PERMANENT host whose name is written on
# physical NFC cards on walls, and it must stay boring enough to still work in five years:
# no build step, no node_modules, no migrations, no secrets, no restart of anything that
# holds state.
#
# ponytail: rsync + `nginx -s reload`, in a shell script, because the order matters (files
#   before reload) and because the alternative is a README paragraph that drifts. Ceiling:
#   no rollback and no build id - there is nothing to roll back, the artifact is three files
#   that live in git. Upgrade path: none wanted. If this ever needs one, something has been
#   added to this box that should not be on it.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").tagHost)')}"
DEST=/srv/tag

echo "==> 0/4 the committed association files match ops/branding.json"
# The bytes about to be served are the bytes a human read in a git diff. Nothing below can
# fix a wrong association file, so nothing below runs until this holds.
node ops/gen-wellknown.mjs

echo "==> 1/4 refuse to point the tag host at the API host"
# Deploying the tag payload onto the API box would "work" and would quietly re-couple the
# two, which is the entire failure decision-40 exists to prevent.
API_HOST="$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')"
if [ "$HOST" = "$API_HOST" ]; then
  echo "FATAL: $HOST is the API host. The tag host is permanent and must be its own box." >&2
  exit 1
fi

echo "==> 2/4 copy the three files -> $HOST:$DEST"
# Staged through the home directory: /srv is root-owned and rsync runs as the login user.
# --checksum, not --times: these files change once a year and mtime noise is not a reason to
# reload nginx.
rsync -a --checksum \
  server/wellknown/apple-app-site-association \
  server/wellknown/assetlinks.json \
  server/wellknown/t.html \
  ops/tag-host/nginx.conf \
  "$HOST:~/tag-host-staging/"

echo "==> 3/4 install, validate the config, reload"
# `nginx -t` BEFORE the reload: a bad config makes the running nginx refuse to reload and
# keep serving the old bytes, which looks like success. Fail loudly instead.
# Quoted heredoc: the script below is expanded on the VM, never here.
ssh "$HOST" "DEST='$DEST' bash -s" <<'REMOTE'
set -euo pipefail
S="$HOME/tag-host-staging"

sudo install -d -o root -g root -m 0755 "$DEST"
for f in apple-app-site-association assetlinks.json t.html; do
  sudo install -o root -g root -m 0644 "$S/$f" "$DEST/$f"
done
sudo install -o root -g root -m 0644 "$S/nginx.conf" /etc/nginx/conf.d/tag-host.conf

# The stock Ubuntu default site answers / with a welcome page and enables autoindex-ish
# behaviour on :80. This host answers 404 to everything it does not own.
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx || sudo systemctl restart nginx
systemctl is-active nginx
REMOTE

echo "==> 4/4 verify (a tag is worthless if this regresses)"
./server/wellknown/verify.sh "$HOST"

echo
echo "tag host ok: https://$HOST"
echo "REMINDER: the exe.dev proxy must be PUBLIC or Android and iOS cannot fetch the"
echo "association files at all:  ssh exe.dev share set-public ${HOST%%.*}"
