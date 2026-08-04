---
id: TASK-15
title: 'Auth: admin PIN login'
status: Done
assignee: []
created_date: '2026-07-28 13:49'
updated_date: '2026-08-04 16:48'
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
TRIAGE 2026-08-04 — DONE, but the MECHANISM changed. decision-20 deleted the PIN entirely.

AC1 stays unchecked and must: there is no PIN login page and there will not be one. What shipped
instead is email + password against the `admins` table.

Evidence:
- `POST /admin/login`, `POST /admin/logout`, `GET /admin/session` are all registered live (401
  unauthenticated). AC5 = the logout route.
- Production `admins` table holds 1 row.
- `curl https://timesheets.exe.xyz/login/` -> 200 (web/app/login/page.tsx).
- AC4: server/lib/auth.js:175 issues
  `<name>=<token>; Path=/; Max-Age=…; HttpOnly; Secure; SameSite=Strict`. HttpOnly means script
  cannot read it, SameSite=Strict means a third-party page cannot ride it.
- Admin creation is out-of-band: server/bin/create-admin.js. No self-signup.
- AC2: wrong credentials return the same 401 shape as no credentials.

The old ADMIN_PIN is gone from /etc/nfc/env — the file holds only APP_KEY, DATABASE_URL, PORT.
<!-- SECTION:NOTES:END -->
