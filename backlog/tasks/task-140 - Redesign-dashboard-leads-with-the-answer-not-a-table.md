---
id: TASK-140
title: 'Redesign /: dashboard leads with the answer, not a table'
status: To Do
assignee: []
created_date: '2026-08-17 11:26'
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
priority: high
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frage: 'Muss ich gerade etwas tun?'

Today this screen opens with a heading, a lede, a .page-summary sentence, a full on-site TABLE and a .triage-list of prose bullets. The director parses a table to find out whether anything is wrong.

Lead with the ANSWER: <AnswerBand> with 'Zu erledigen' as the first cell and the count as a big tabular number, then 'Gerade im Einsatz' and 'Diese Woche' as calm secondary cells. Under it, ONE <ListPanel> titled 'Zu erledigen' holding an <AttentionList> of only the rows that need a decision, each opening the relevant drawer or linking to the screen that owns it. When there is nothing to do the panel is an <EmptyState> that says so in words - an empty area here MEANS nothing to do and must not read as a failed load.

The triage list's facts survive: unresolved shifts (decision-10: unresolved = unpaid work AND the worker is locked out of clocking in, urgent for two people), workers without an enrolment path, locations with no shifts. They move into the attention list or the answer band. None of them is deleted.

Keep the Vienna-pinned clock formatting exactly as it is - two screens naming the same shift two hours or one DAY apart is how a director stops believing either.
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
- [ ] #1 The permanently-open create/edit form is gone from the page body; every WRITE happens in a <Drawer> opened by an explicit control
- [ ] #2 The list is read-only and calm: no form, no mounted inputs except filters
- [ ] #3 <PageHeader> renders the h1 and the screen's German question from REDESIGN-PLAN.md section 4.4
- [ ] #4 Every user-visible string is a message key; zero bare JSX literals; new keys are in _fragments/<screen>.de.json and .en.json with identical key sets
- [ ] #5 390px screenshot LOOKED AT and attached: no horizontal page scroll, cards carry the CORRECT column captions, every touch target >=44px
- [ ] #6 1440px screenshot attached, dark theme
- [ ] #7 Keyboard only: open the drawer, save, close - focus returns to a sensible control and never to <body>
- [ ] #8 de.json, en.json, globals.css, lib/nav.ts and components/* are untouched by this task
- [ ] #9 cd web && pnpm lint && pnpm typecheck green
- [ ] #10 The first thing above the fold is the count of things to do, as a number, not a table
- [ ] #11 All three triage facts (unresolved shifts, workers with no enrolment path, locations with no shifts) are still stated with the same counts as before the change
- [ ] #12 With zero problems the screen shows an explicit 'nothing to do' EmptyState, not blank space
- [ ] #13 Times still render in the Vienna business time zone and match /shifts/ for the same shift
<!-- AC:END -->
