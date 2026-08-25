---
id: TASK-270
title: 'audit-band.mjs: /shifts/ thead cuts column header text at 390/767/768-1152px'
status: To Do
assignee: []
created_date: '2026-08-25 16:30'
labels:
  - web
  - a11y
dependencies: []
priority: medium
ordinal: 188000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 audit-band.mjs reports 0 FAIL lines for /shifts/ across the full width band
- [ ] #2 root cause identified: the visually-hidden thead trick vs the sticky/positioned header interaction, not guessed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Found 2026-08-25 while verifying an unrelated scroll-layout change (globals.css .app-shell/.content). CONFIRMED PRE-EXISTING: reproduced byte-identical on HEAD before that change (git stash test, FAIL lines MD5-identical with and without the fix: f1ec01a3f1c6e035b5412fcf96b7817a). Not caused by, not fixed by, that work.

node demo/audit-band.mjs (point AUDIT_BASE at any demo-server) reports on /shifts/ only:
  @390, @767: 4 column headers (Mitarbeiter/Objekt/Beginn/Ende) 'cut at 14px by thead'
  @768-1152: same 4 headers 'cut at 234px by thead'

/shifts/ is the only screen of 13 that fails this probe; all others are clean across the
full 18-width band. Not triaged further - root cause not yet read from source, just
reproduced and isolated as pre-existing.
<!-- SECTION:NOTES:END -->
