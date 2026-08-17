---
id: TASK-143
title: 'Redesign /locations/: 14-field form into a drawer, tag URI stays whole'
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
priority: high
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frage: „Welche Objekte betreuen wir, und welches Tag gehört dazu?"

Batch B1 (REDESIGN-PLAN.md section 4.2). Inventory section 5: 1160 lines, ns locations, 105 keys, 14 inputs - the worst offender in the app. Class MIXED, hardest and largest: list + a 14-field permanently-open form + a month filter + TWO secret panels (the tag URI, permanent; the client portal link, one-shot).

The 14-field form moves into a Drawer, and the two inline sub-forms (new client, new contact) go with it. The tag URI does NOT move into anything that could elide it.

THE SINGLE MOST LOAD-BEARING CONTROL IN THE ADMIN: the full tagUri(location.id), rendered verbatim in a .code-block with user-select:all, the UUID printed underneath, one-click copy. A URI truncated for layout is a URI somebody retypes wrongly onto a sticker, and a wrong sticker costs a site visit (decision-21: the identity is the UUID, the slug is never on the tag).

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
- [ ] #1 The permanently-open 14-field form is gone from the page body; create and edit happen in a Drawer
- [ ] #2 PageHeader renders the h1 and „Welche Objekte betreuen wir, und welches Tag gehört dazu?" from REDESIGN-PLAN.md section 4.4
- [ ] #3 The full tag URI is still shown WHOLE and never elided, in a .code-block with user-select:all, with the UUID printed underneath (uuidLabel) and tagExplainer beside it
- [ ] #4 Clipboard denied in the browser: the copy failure notice (copyFailed {name}) is visible and announced on a PAGE-level aria-live region, and the full URI is still selectable on screen. Never a false success
- [ ] #5 The inline create paths survive: a client and a contact can still be created FROM the building form (clientChoice=new, contactChoice=new), and contactNeedsClientHint still appears when no client is chosen
- [ ] #6 The partial-save recovery survives: if the client/contact are created and the building save fails, the form is re-pointed at the created records so pressing Save again cannot create a duplicate
- [ ] #7 All four month-filter states still render: monthEmpty, monthNever, monthLatest {date} with the monthJump button, and an invalid month still sets aria-invalid. An empty month must never read as an empty database
- [ ] #8 targetStored {value} still names a non-whole-hour target instead of rounding it; timePending {count} is still counted as pending and NEVER added to hours; truncatedNote {limit} still renders when the payload is capped
- [ ] #9 Deactivating a building still revokes that building s live client links, and the UI still says so before the user confirms
- [ ] #10 The portal-link share panel is still one-shot in role=status aria-live=polite with the URL verbatim, shareOnce and shareExplain {name}; all five share states (shareNoContact, shareContactInactive, shareInactiveBuilding, shareActive, shareButton) still render
- [ ] #11 All twelve field errors still fire on their own fields, including errorSlugTaken on the slug field and errorSlugShape
- [ ] #12 390px screenshot LOOKED AT and attached - the tag URI is still fully readable there, not clipped; 1440px dark screenshot attached
- [ ] #13 de.json, en.json, globals.css, lib/nav.ts and components/* untouched; cd web && pnpm lint && pnpm typecheck green
<!-- AC:END -->
