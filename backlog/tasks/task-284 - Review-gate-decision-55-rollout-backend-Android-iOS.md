---
id: TASK-284
title: 'Review gate: decision-55 rollout (backend, Android, iOS)'
status: To Do
assignee: []
created_date: '2026-08-26 20:59'
labels:
  - review
  - decision-55
dependencies:
  - TASK-281
  - TASK-282
  - TASK-283
priority: high
ordinal: 202000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Same shape as TASK-275. Read decision-55 and decision-54 in full, read all code changes from TASK-281/282/283, verify no code contradicts either decision, check the no-partial-application CTE guard by reading the actual SQL (not trusting a green test alone), verify zone-shifts/reassign payloads never leak rate/money/client data, verify entitlements/pbxproj/deployment-target byte-identical across the whole commit range, run server/check-api.js + android/checks/run.sh + NFCTimeSheets/checks/run.sh + ops/check-branding.mjs and quote any non-clean output. Report violations with decision id + file:line. BLOCK completion if found.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 decision-55 and decision-54 both read in full before review
- [ ] #2 all TASK-281/282/283 code changes reviewed against both decisions with file:line citations
- [ ] #3 reassign-building's no-partial-application guarantee verified by reading the actual SQL, not just a passing test
- [ ] #4 zone-shifts and reassign-building payloads confirmed to carry no rate/money/client fields on any platform
- [ ] #5 entitlements/project.pbxproj/deployment-target confirmed byte-identical across the full commit range
- [ ] #6 all 4 check suites (server/check-api.js, android/checks/run.sh, NFCTimeSheets/checks/run.sh, ops/check-branding.mjs) run and their output quoted
- [ ] #7 TASK-281/282/283 independently re-verified against actual code (not self-reports) before being marked Done
<!-- AC:END -->
