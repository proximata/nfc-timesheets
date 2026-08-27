---
id: TASK-291
title: 'Review gate: decision-56 manual clock-in/out'
status: To Do
assignee: []
created_date: '2026-08-27 09:43'
updated_date: '2026-08-27 10:36'
labels:
  - review
  - decision-56
dependencies:
  - TASK-287
  - TASK-288
  - TASK-289
  - TASK-290
priority: high
ordinal: 209000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 re-read decision-56 in full; confirm the shipped code matches it exactly (manual_start/manual_close semantics, corrected_at set only on manual close, auto_closed untouched)
- [ ] #2 confirm a manual open cannot succeed anywhere a real tap would fail (read v.activePlace/v.requireVerifiedPlace call sites, do not trust tests alone)
- [ ] #3 confirm a plain tap-based open/close (manual omitted) is byte-identical in behavior to before this change
- [ ] #4 confirm both platforms require a confirmation step before either manual action fires
- [ ] #5 confirm admin can see manual_start/manual_close on at least one real row (server + web working together)
- [ ] #6 entitlements/pbxproj/IPHONEOS_DEPLOYMENT_TARGET byte-identical across the whole commit range
- [ ] #7 all relevant check suites (server check-api.js, android checks/run.sh, iOS checks/run.sh, web pnpm verify) run with output quoted
- [ ] #8 nothing pushed, nothing deployed
<!-- AC:END -->
