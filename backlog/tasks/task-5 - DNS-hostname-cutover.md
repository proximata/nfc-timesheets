---
id: TASK-5
title: DNS / hostname cutover
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-27 07:32'
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
- [x] #3 Old VM decommissioned or renamed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit 2026-08-27: AC3 confirmed - the VM was renamed, not decommissioned, to schimmer-glanz.exe.xyz (decision-40, apiHost). AGENTS.md Hosting section confirms. Checked.
<!-- SECTION:NOTES:END -->
