---
id: TASK-15
title: 'Auth: admin PIN login'
status: To Do
assignee: []
created_date: '2026-07-28 13:49'
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
- [ ] #2 Wrong PIN shows error
- [ ] #3 Correct PIN redirects to dashboard
- [ ] #4 Session persists across page refreshes
- [ ] #5 Logout clears session
<!-- AC:END -->
