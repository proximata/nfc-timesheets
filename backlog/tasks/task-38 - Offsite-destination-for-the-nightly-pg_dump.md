---
id: TASK-38
title: Offsite destination for the nightly pg_dump
status: To Do
assignee: []
created_date: '2026-08-04 17:45'
labels:
  - ops
  - backup
  - payroll
dependencies: []
priority: medium
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The nightly dump works and lands on the SAME DISK as the database it is protecting. One disk failure loses the database and every backup of it at the same instant.

ops/backup/pg-backup.sh:67 carries a clearly marked TODO(offsite) hook, with an rclone example already written at line 73. Nothing has been chosen or wired.

The owner has marked this LOW priority - filed as such, deliberately not escalated.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An offsite target chosen and credentials placed on the VM (rclone.conf or equivalent)
- [ ] #2 TODO(offsite) in ops/backup/pg-backup.sh resolved, not just commented
- [ ] #3 The offsite copy restore-tested by pulling it BACK DOWN: DUMP=... ops/backup/restore-test.sh
- [ ] #4 ops/README.md line 175 checklist item ticked
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 (agent 2) — OPEN. Payroll-affecting. Verified read-only on the live VM.

THE BACKUP HALF WORKS. nfc-backup.timer is active and last ran 2026-08-04 00:12 UTC. Four dumps exist:
  /var/backups/nfc/nfc-20260728-153045.sql.gz
  /var/backups/nfc/nfc-20260803T122719Z.sql.gz
  /var/backups/nfc/nfc-20260803T202438Z.sql.gz
  /var/backups/nfc/nfc-20260804T001253Z.sql.gz
systemd unit: nfc-backup.service -> ExecStart=/srv/nfc/ops/backup/pg-backup.sh, User=postgres.

THE OFFSITE HALF DOES NOT EXIST, and I confirmed the dumps share a filesystem with the database:
  df -h /var/backups      -> /dev/root  25G  21% /
  df -h /var/lib/postgresql -> /dev/root  25G  21% /
Same device. The backup is a copy of the data sitting next to the data.

WHAT BREAKS IF NEVER DONE: the VM's disk is the single point of failure for ALL payroll history.
Lose it and you lose the hours people are owed AND every dump that could have restored them.
Austrian record-keeping expects those records to exist next year (server/db/README.md:181,
decision-16: 'That is not optional for payroll data').

MITIGATING, WHICH IS WHY LOW IS DEFENSIBLE TODAY: production currently holds 5 shifts, 2 workers
and 1 location. There is very little to lose yet. The cost of losing it grows every week the
crew actually uses the app - this gets more expensive to defer, not less.

ponytail: rclone to any B2/S3 bucket is ~3 lines and the example is already in the script.
Ceiling: no versioning or retention policy. Upgrade path: bucket lifecycle rules + a restore
drill on a schedule.
<!-- SECTION:NOTES:END -->
