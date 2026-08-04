---
id: TASK-5
title: DNS / hostname cutover
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-04 16:46'
labels:
  - infra
milestone: m-0
dependencies:
  - TASK-1
  - TASK-4
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rename new VM to timesheets (gets timesheets.exe.xyz) or set up domain pointing to new VM. App API.base URL must remain stable or be updated in new TestFlight build.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 https://timesheets.exe.xyz/health returns ok from new VM
- [x] #2 AASA accessible at timesheets.exe.xyz
- [ ] #3 Old VM decommissioned or renamed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE.

AC1: `curl https://timesheets.exe.xyz/health` -> `{"ok":true}`, served by the VM whose hostname
is `timesheets` and whose nfc-api.service is active running. Auto TLS via the exe.dev proxy
(HTTP/2 + `strict-transport-security: max-age=63072000; includeSubDomains; preload`).
AC2: AASA is at that hostname — see TASK-4.

AC3 is left unchecked and is not a blocker: there is no separate old VM to decommission. The
cutover was in place, not a move — the same host was rebuilt per the runbook. Evidence the old
arrangement is gone: /root is no longer world-readable, the service runs as the unprivileged
`app` user, and the old JSON store survives only as the gitignored `.vm-legacy-backup/data.json`
in this repo.

decision-15 makes this hostname load-bearing: it is burned into physical NFC tags. It cannot be
changed without rewriting every tag on site.
<!-- SECTION:NOTES:END -->
