---
id: TASK-255
title: >-
  The /tags/ screen — the one control that turns a mounted card into a working
  zone — is a raw HTML table with no i18n
status: To Do
assignee: []
created_date: '2026-08-24 19:05'
labels:
  - web
  - ux
  - zones
  - i18n
dependencies: []
priority: high
ordinal: 173000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: admin-web journey, step 'Reach /tags/ (Unzugeordnete Tags) and resolve the reported tag into a new zone Haupteingang on the new building'. Driven live against a local demo stack with the current web/out build.

WHAT THE OWNER SEES: /tags/ is the ONLY admin control that turns a card an operator wrote and reported in the field into a zone a cleaner can clock in on. It is the exact step a real owner performs when onboarding a new building. It renders as a plain bordered HTML table with default OS-styled radios and selects, dropped into an otherwise fully designed dark-themed product.

CONFIRMED AT HEAD, not inferred: web/app/tags/page.tsx has ZERO occurrences of useTranslations (grep count 0). Its own file header says it is 'DELIBERATELY THE PLAINEST POSSIBLE SCREEN, not the house style used everywhere else in this bundle (no PageHeader, no ListPanel, no Drawer, no next-intl)' and names /workers/, /operators/ and /locations/ as the reference for the polished version. It is also not in lib/nav.ts — reached only by URL or the link on the /locations/ header.

So this screen carries TWO defects at once, and they are the same fix: it is unstyled, and every one of its strings is a hardcoded German literal (RESOLVE_ERROR_SENTENCES, the radio labels, the column headings). That is the exact failure mode the project AGENTS.md i18n section names by file: 'this is exactly how web/app/tags/page.tsx shipped German-only with zero i18n, found 2026-08-24'.

The functional flow itself is CORRECT and must not regress: the tag appears with reporter name and timestamp and a 6-char token matching the operator-phone convention, resolving produces a clear confirmation sentence naming the new zone, and the list empties. Every RESOLVE_ERROR_SENTENCES entry says what to DO rather than printing the server code — that mapping is right, it just belongs in the message catalogue.

decision-47 constraint that must survive verbatim: 'Neues Gebaeude' is GONE and POST /admin/tags/:id/resolve-building is deleted. The sentence under the radios that explains a new building is created tag-free under Objekte, and the card then becomes its FIRST zone, must still be on the screen after the restyle.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The screen uses the same PageHeader / ListPanel / Drawer primitives as /workers/, /operators/ and /locations/ — no raw bordered table, no default OS-styled radios or selects
- [ ] #2 web/app/tags/page.tsx goes through useTranslations for every user-visible string; a grep for useTranslations in that file returns a non-zero count
- [ ] #3 Every RESOLVE_ERROR_SENTENCES entry moves to de.json and en.json with exact key parity, and still says what to DO rather than printing the server code
- [ ] #4 The reporter name, the report timestamp in Europe/Vienna, and the 6-char token stay on the row — nothing true is dropped to lighten the screen
- [ ] #5 The sentence explaining that a new building is created tag-free under Objekte and the card then becomes its first zone survives verbatim (decision-47)
- [ ] #6 The screen earns its place in lib/nav.ts, or the task records the deliberate decision that it stays URL-only
<!-- AC:END -->
