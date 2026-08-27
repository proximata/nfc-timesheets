---
id: TASK-15
title: 'Auth: admin PIN login'
status: Done
assignee: []
created_date: '2026-07-28 13:49'
updated_date: '2026-08-27 07:31'
labels:
  - web
  - auth
milestone: m-3
dependencies:
  - TASK-14
  - TASK-3
priority: high
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PIN login page. POST PIN to server, get session token (JWT or opaque). httpOnly cookie. Server validates on admin endpoints. Single admin PIN same as iOS.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Login page accepts PIN
- [x] #2 Wrong PIN shows error
- [x] #3 Correct PIN redirects to dashboard
- [x] #4 Session persists across page refreshes
- [x] #5 Logout clears session
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit 2026-08-27: AC1 (login page accepts PIN) is dead, not a gap - decision-20 removed PIN auth entirely; web admin uses email+password. Left unchecked deliberately.
<!-- SECTION:NOTES:END -->
