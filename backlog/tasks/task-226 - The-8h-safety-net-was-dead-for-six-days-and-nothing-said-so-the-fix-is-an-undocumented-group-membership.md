---
id: TASK-226
title: >-
  The 8h safety net was dead for six days and nothing said so; the fix is an
  undocumented group membership
status: To Do
assignee: []
created_date: '2026-08-21 00:09'
labels: []
dependencies: []
priority: high
ordinal: 144000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two ops facts that are true only because somebody typed something on the box and left no trace, and both silently break a rebuild of this VM.

1. THE GROUP MEMBERSHIP THAT ENDED A SIX-DAY OUTAGE.

nfc-autoclose.service runs as User=postgres and reads /srv/nfc/ops/sql/autoclose.sql, which ops/deploy.sh rsyncs as 0640 exedev:app under 0750 directories. Between 2026-07-28T17:45Z and 2026-08-03T12:15Z psql could not OPEN that file:

  555 x "psql: error: /srv/nfc/ops/sql/autoclose.sql: Permission denied"

psql exits 1 and systemd marked the unit failed, 555 consecutive times over six days. The 8h auto-close safety net — the thing decision-10 promises the owner has — did not exist for that week. Nothing noticed, because "systemctl list-timers" was green throughout: a timer's health is whether it FIRED.

It works today only because postgres is now a member of the app group (id -nG postgres: postgres ssl-cert app). That membership is in no commit, no unit file, no runbook and no deploy script. backlog/docs/runbook-vm-provisioning.md does not mention it. Provision a fresh VM from the runbook and the outage comes back exactly.

2. NOTHING ON THIS BOX ALERTS ON A FAILED UNIT.

grep for OnFailure= across /etc/systemd/system/nfc-*.service returns nothing. No monitoring agent is installed; the running services are cron, dbus, nfc-api, postgresql, journald, logind, timesyncd, user@1000. A failed timer is discovered by a human typing systemctl status, and nobody types it.

ALREADY DONE (commit 526ae9a): ops/check-timers-ran.sh asserts, per timer, that it is not failed, that its LAST EXECUTION exited 0, that it fired inside its own window, and — the arm that would have gone red on 2026-07-28 — that the unit's User can actually read the file the unit reads. ops/check-timers-ran-mutants.sh shows it red by re-creating the fault on the box (gpasswd -d postgres app; chmod 0600) and reverting in a trap.

WHAT IS LEFT, and why this task exists:

a) make the group membership an ARTEFACT. Either add "usermod -aG app postgres" to ops/deploy.sh next to the chown, or stop needing it: rsync ops/sql/ to a path postgres owns. The second is cleaner — the autoclose SQL is not application code and does not belong under a 0750 deploy tree.

b) record it in backlog/docs/runbook-vm-provisioning.md section 5, beside the unit installation, so a rebuild does not reproduce the outage.

c) run ops/check-timers-ran.sh from ops/deploy.sh, so a deploy that re-breaks the permission fails loudly instead of six days later.

ACCEPTANCE:
- ops/check-timers-ran.sh runs in the deploy and is red when the precondition is broken (the mutant runner already demonstrates both)
- the group membership (or its removal) is in a committed file, not in somebody's shell history
- the runbook names it
<!-- SECTION:DESCRIPTION:END -->
