#!/usr/bin/env bash
#
# Daily Postgres dump for NFC TimeSheets. Run as the `postgres` role (peer auth, local socket).
#
#   *** A DUMP ON THE SAME DISK AS THE DATABASE IS NOT A BACKUP. ***
#
# It protects against `DROP TABLE`, a bad migration and a fat-fingered admin edit. It protects
# against NOTHING that kills the disk or the VM: hardware failure, a deleted instance, ransom-
# ware, or the provider losing the box. decision-16 moved us onto a self-hosted VM, so hardware
# failure is now OUR risk, and this is PAYROLL DATA — people get paid from it and Austrian
# record-keeping expects it to still exist next year. The offsite hook below is not optional
# work, it is the half of this script that makes the word "backup" honest.
#
# Failure policy: loud. set -euo pipefail + an explicit verify step. A 0-byte or truncated
# dump must never be written into the retention set, and old dumps are rotated away ONLY
# after the new one has been verified.
#
# Install: /srv/nfc/ops/backup/pg-backup.sh, driven by nfc-backup.timer.

set -euo pipefail

DB=nfc
DEST=/var/backups/nfc
RETENTION_DAYS=14
MIN_BYTES=200   # a valid gzipped dump of an empty schema is still >200B; 0-byte tripwire

umask 077
mkdir -p "$DEST"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$DEST/$DB-$ts.sql.gz"
tmp="$DEST/.$DB-$ts.sql.gz.partial"

# Any early exit leaves no half-written file behind that a later run could mistake for good.
trap 'rm -f "$tmp"' EXIT

# pipefail makes a pg_dump failure fail the pipeline even though gzip exits 0.
pg_dump --no-owner --no-privileges --clean --if-exists "$DB" | gzip -9 > "$tmp"

# --- verify BEFORE rotating anything away ---
bytes="$(wc -c < "$tmp")"
if [ "$bytes" -lt "$MIN_BYTES" ]; then
  echo "FATAL: dump is only ${bytes}B (< ${MIN_BYTES}B) — refusing to keep it" >&2
  exit 1
fi
if ! gzip -t "$tmp"; then
  echo "FATAL: gzip integrity check failed on $tmp" >&2
  exit 1
fi
# NOTE: never pipe INTO `grep -q` under `set -o pipefail`. `grep -q` exits the instant it
# matches, whatever is upstream takes EPIPE and exits 141, pipefail propagates that, the `!`
# inverts it, and the EXIT trap deletes a perfectly good dump. The original bug piped gzip
# into `grep -qm1`; it only misfires once the dump outgrows the pipe buffer, i.e. the first
# day there is real payroll data in it. Moving the pipe upstream does NOT fix it — the early
# exit is grep's, not gzip's. So: no pipe at all. Bash pattern match on a captured header.
hdr="$(gzip -dc "$tmp" | sed -n '1,50p')" || true
if [[ "$hdr" != *"PostgreSQL database dump"* ]]; then
  echo "FATAL: $tmp decompresses but is not a pg_dump — refusing to keep it" >&2
  exit 1
fi

mv "$tmp" "$out"
trap - EXIT
echo "backup ok: $out (${bytes} bytes compressed)"

# ---------------------------------------------------------------------------
# TODO(offsite) — HOOK: copy "$out" to storage that is NOT this disk.
# Nothing is chosen here on purpose: no provider is picked, no credentials are invented.
# The owner picks one, puts the credentials in /etc/nfc/env (0640 root:app) or a dedicated
# 0600 root credentials file, and uncomments exactly one block.
#
# Option A — rclone to object storage (Backblaze B2 / Hetzner / S3). Cheapest, widest choice.
#   rclone copy "$out" "nfc-offsite:nfc-timesheets/" --config /etc/nfc/rclone.conf
#
# Option B — restic to a repo. Deduplicated, encrypted at rest, has its own `restic check`.
#   restic -r "$RESTIC_REPO" backup "$out" && restic -r "$RESTIC_REPO" forget --keep-daily 14 --prune
#
# Option C — rsync over ssh to a second machine you already own (e.g. the office NAS or a
# second exe.dev VM). Zero new vendors; only as durable as that machine.
#   rsync -az -e 'ssh -i /etc/nfc/backup_id_ed25519' "$out" backup@<host>:/srv/backups/nfc/
#
# Whichever is chosen: it must fail loudly too (this script is `set -e`, so a non-zero exit
# from the copy fails the unit and shows up as a red `systemctl status nfc-backup`), and the
# offsite copy must be restore-tested at least once with ops/backup/restore-test.sh.
# ---------------------------------------------------------------------------

# Rotation last: only ever runs when the new dump above verified clean.
find "$DEST" -maxdepth 1 -type f -name "$DB-*.sql.gz" -mtime +"$RETENTION_DAYS" -print -delete
# Sweep abandoned partials from a previous crashed run.
find "$DEST" -maxdepth 1 -type f -name ".$DB-*.partial" -mtime +1 -delete
