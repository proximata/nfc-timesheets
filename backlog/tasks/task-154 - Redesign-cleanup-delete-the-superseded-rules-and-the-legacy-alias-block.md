---
id: TASK-154
title: 'Redesign cleanup: delete the superseded rules and the legacy alias block'
status: To Do
assignee: []
created_date: '2026-08-17 13:24'
labels:
  - ux
  - redesign
dependencies:
  - TASK-153
documentation:
  - backlog/docs/REDESIGN-PLAN.md
  - backlog/docs/REDESIGN-INVENTORY.md
priority: low
ordinal: 72000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Batch B6 (REDESIGN-PLAN.md section 4.2) - serial, only after B5 is green.

Delete .worker-form, .page-summary, .button-primary / .button-secondary, nav.primaryHeading, and the ENTIRE legacy-alias token block from REDESIGN-PLAN.md section 1.2 - each one only after rg proves zero remaining references.

Effort low. But this is the task that stops the codebase carrying two design systems for ever. Skipped, the aliases become permanent and the next reader cannot tell which token set is the real one.

CARE: /account/ uses .auth-form, NOT .worker-form (inventory section 12). The shared form styling must keep covering it after .worker-form goes. Check it, do not assume it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 For EACH deleted symbol (.worker-form, .page-summary, .button-primary, .button-secondary, nav.primaryHeading, and every legacy alias token) the rg command and its zero-hit output are recorded in the task BEFORE the deletion
- [ ] #2 The entire legacy-alias token block from REDESIGN-PLAN.md section 1.2 is gone from globals.css: rg for --ink, --ink-muted, --accent-soft, --focus, --space-1 through --space-8 and the legacy --bg/--surface names returns no hits outside the removal diff
- [ ] #3 nav.primaryHeading is removed from BOTH de.json and en.json, and the two files still have identical key sets; pnpm check green
- [ ] #4 /account/ still renders correctly after .worker-form is deleted - it uses .auth-form and the shared form styling still covers it; screenshot attached
- [ ] #5 cd web && pnpm verify green after every deletion
- [ ] #6 1440px dark and 390px screenshots of at least one list screen, one form screen and one report screen, compared against the B5 screenshots - no visual change from the cleanup
- [ ] #7 The codebase now carries ONE design system: no rule appears in both an old and a new form anywhere in globals.css
- [ ] #8 Production untouched: no deploy, no service restart, no write. Local only
<!-- AC:END -->
