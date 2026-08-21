---
id: TASK-227
title: >-
  Every backup is on the same disk as the database it backs up; the offsite hook
  is still a TODO
status: To Do
assignee: []
created_date: '2026-08-21 00:10'
labels: []
dependencies: []
priority: high
ordinal: 145000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every dump this system has ever taken lives on the same filesystem as the database it dumps.

MEASURED 2026-08-20:
  df --output=source /var/backups/nfc   -> /dev/root
  df --output=source /var/lib/postgresql -> /dev/root

ops/backup/pg-backup.sh says this about itself, in capitals, at the top: "A DUMP ON THE SAME DISK AS THE DATABASE IS NOT A BACKUP." The offsite hook underneath it is still a commented-out TODO with three options and no choice made.

WHAT IS NOW PROVEN, so that this task is scoped to the one missing thing and not to the whole backup:
- the timer really runs and really writes (ops/break-timers.sh section 2, and check-timers-ran.sh asserts the last execution exited 0)
- the dump it writes RESTORES, and the restored database is byte-for-byte identical to production on a fingerprint of workers, shifts and locations — shown RED first against the previous dump, which must not match
- the schema survives the round trip: same 61 indexes, shifts_one_open_per_worker_idx present, 8 rows in schema_migrations
- it fails LOUDLY rather than writing a truncated file, and rotation runs only after a clean verify
- it survives colliding with a migration lock: it queues, waits, and still produces a verified dump

So the backup is good. It is simply in the wrong place. It protects against DROP TABLE, a bad migration and a fat-fingered admin edit. It protects against nothing that kills the disk or the VM: hardware failure, a deleted instance, ransomware, or exe.dev losing the box.

THIS IS PAYROLL DATA. People are paid from it and Austrian record-keeping expects it to still exist next year. decision-16 moved onto a self-hosted VM, which made hardware failure OUR risk.

ACCEPTANCE:
- one of pg-backup.sh's three options chosen and uncommented; credentials in the psst vault and synced to /etc/nfc/env or a dedicated 0600 root credentials file, never hand-edited
- the copy fails the unit loudly on error (the script is set -e, so a non-zero exit already turns systemctl status red — verify it does)
- ops/backup/restore-test.sh run once against the OFFSITE copy, not the local one, and the fingerprint compared to production the way ops/break-timers.sh section 2 does
- shown RED: with the offsite credential wrong, nfc-backup goes to the failed state, and ops/check-timers-ran.sh catches it
<!-- SECTION:DESCRIPTION:END -->
