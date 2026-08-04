---
id: TASK-8
title: Encode location ID in NDEF tag URI
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-04 16:47'
labels:
  - ios
  - physical
milestone: m-1
dependencies:
  - TASK-2
priority: high
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NDEF URI becomes https://timesheets.exe.xyz/t?l=<LOCATION_UUID>. App parses URL on launch to identify location. Decouples from hardware UIDs for background reads.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each physical tag has unique URI with its location ID
- [x] #2 App correctly parses location from incoming universal link
- [x] #3 Server /t landing page still works
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE.

AC1: the production location is keyed by UUID `c3c37d4a-ca0a-42c5-b248-9704b9907ec7`; the tag
URI is `https://timesheets.exe.xyz/t?l=<that uuid>`. decision-21 requires the UUID and forbids
the slug — a guessable id on an unlocked tag would enumerate every building. The slug
(`hoiv-arsenalstrasse-11`) is retained as a human-readable column only.
AC2: NFCTimeSheets/NFCTimeSheets/TagLink.swift, with NFCTimeSheets/checks/tag-link-check.swift
pinning the parse. The five production shifts carry the right location_id, so the parse works
end to end.
AC3: `curl -sSi "https://timesheets.exe.xyz/t?l=00000000-0000-0000-0000-000000000000"` -> 200
text/html. The landing page is only ever reached with the app NOT installed.

Server-side the id is validated against the locations table before use (server/lib/validate.js)
— required because decision-15 leaves tags rewritable, so the value is attacker-controllable in
principle.
<!-- SECTION:NOTES:END -->
