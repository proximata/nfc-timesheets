---
id: TASK-144
title: >-
  Redesign /clients/: one read-only screen, two drawers, one hidden side effect
  surfaced
status: To Do
assignee: []
created_date: '2026-08-17 13:23'
labels:
  - ux
  - redesign
dependencies:
  - TASK-136
  - TASK-137
  - TASK-138
  - TASK-139
documentation:
  - backlog/docs/REDESIGN-PLAN.md
  - backlog/docs/REDESIGN-INVENTORY.md
priority: medium
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frage: „Für wen arbeiten wir, und wen rufe ich dort an?"

Batch B2 (REDESIGN-PLAN.md section 4.2). Inventory section 6: 631 lines, ns clients, 57 keys. Class MIXED (double) - TWO independent lists and TWO independent forms on one screen. This is literally the „two white containers" the owner complained about.

After: one read-only screen, two drawers (client, contact). Both lists stay - the screen answers two halves of one question - but neither carries a mounted form.

clients.intro stays: both a client and a contact can be created straight from the buildings form; this page is for tidying up afterwards and is never a prerequisite.

RULES FOR EVERY SCREEN AGENT (REDESIGN-PLAN.md section 4.1):
- You own web/app/<this screen>/page.tsx and your two fragment files. Nothing else.
- DO NOT edit globals.css, lib/nav.ts, components/* (Foundation owns them) or de.json/en.json (Merge owns them).
- New strings go to web/messages/_fragments/<screen>.de.json and .en.json, top-level keys = namespaces. Reference them in code as if already merged.
- web/lib/*.ts is FROZEN. If the screen cannot be built without a lib change, write it in the task and stop.
- server/, NFCTimeSheets/, ops/branding.json and the well-known files are out of scope. Write it down instead of doing it.
- Run: cd web && pnpm lint && pnpm typecheck. NOT pnpm verify - pnpm check compares de.json to en.json and your keys are still in fragments, so it fails by design until the Merge task.
- Tabular data stays <table class="data-table"> with thead/tbody. Do not convert a table to divs: it breaks the <=767px card transform and ResponsiveTableLabels.
- Money is integer CENTS end to end. Never a float multiply. tabular-nums everywhere.
- Nothing TRUE may be deleted to make the screen lighter. Move it or typeset it smaller.
- Production is READ-ONLY. No deploy, no restart, no write.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Both permanently-open forms are gone; client writes and contact writes each happen in their own Drawer with one job
- [ ] #2 PageHeader renders the h1 and „Für wen arbeiten wir, und wen rufe ich dort an?" from REDESIGN-PLAN.md section 4.4
- [ ] #3 Deactivating a CONTACT also revokes that person s live portal links server-side, and this is now STATED ON SCREEN before the user confirms. Today it exists only as a code comment. It must be surfaced, and it must not be lost
- [ ] #4 The confirmation for contact deactivation also states that reactivating does NOT restore the revoked link
- [ ] #5 The two distinct inactive strings survive as two strings: statusInactiveClient and statusInactivePerson are not collapsed into one
- [ ] #6 clients.intro survives; contactEmailHint survives; unknownClient still renders when a contact points at a client id that is not in the list
- [ ] #7 The muted domain states still render: noBuildings, noPeople, noEmail, noPhone, optionInactive {name}
- [ ] #8 Both save regions still exist separately (clientSaved, contactSaved) and both announce on the PAGE live region, not inside a closing drawer
- [ ] #9 Every user-visible string is a message key; zero bare JSX literals; new keys in _fragments/clients.de.json and .en.json with identical key sets
- [ ] #10 390px screenshot LOOKED AT and attached; 1440px dark screenshot attached
- [ ] #11 de.json, en.json, globals.css, lib/nav.ts and components/* untouched; cd web && pnpm lint && pnpm typecheck green
<!-- AC:END -->
