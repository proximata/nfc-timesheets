---
id: TASK-275
title: 'Review gate: decision-54 rollout (backend + admin web + Android + iOS)'
status: To Do
assignee: []
created_date: '2026-08-26 17:14'
labels: []
dependencies:
  - TASK-271
  - TASK-272
  - TASK-273
  - TASK-274
ordinal: 193000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Workflow Review Gate per AGENTS.md, run AFTER TASK-271/272/273/274 all complete. Read decision-54 and every decision it amends (43, 44, 45, 47, 48, 51) plus decisions 6/42 (zone-is-not-a-costing-unit). Read the actual diffs. Verify: no admin path can create a zone; no code contradicts decision-44's untouched adopted-serial flow; the operator gate is real (unreachable without a session) on both platforms; the shared code form exists on both platforms with no leftover second code-entry UI; zone-shifts data exposed to operators carries no rate/money/client name; unbind's shift-history refusal is DB-enforced not app-logic-enforced. Run and quote: server/check-api.js, ops/check-branding.mjs, NFCTimeSheets/checks/run.sh, android/checks/run.sh, pnpm verify (web). Confirm entitlements/pbxproj untouched via git diff. Confirm nothing was pushed or deployed. Update TASK-271..274's backlog status with real evidence (never mark Done without a passing check or command output), and report any gaps found rather than closing a task that only partly landed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 decision-54 and its amended decisions are read and no code contradicts them
- [ ] #2 decision-44's adopted-hardware tag-serial flow is confirmed untouched
- [ ] #3 operator interface is confirmed unreachable without sign-in on both platforms, by reading the actual gate code
- [ ] #4 zone-shifts payload confirmed to carry no rate/money/client fields
- [ ] #5 server/check-api.js, ops/check-branding.mjs, NFCTimeSheets/checks/run.sh, android/checks/run.sh, pnpm verify all run and their output is quoted
- [ ] #6 git diff confirms NFCTimeSheets.entitlements/project.pbxproj/IPHONEOS_DEPLOYMENT_TARGET untouched
- [ ] #7 backlog tasks 271-274 reflect real status with evidence, gaps named explicitly rather than glossed over
<!-- AC:END -->
