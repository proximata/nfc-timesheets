---
id: TASK-148
title: 'Redesign /payroll/: density only, no drawer, every caveat branch survives'
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
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frage: „Was ist diesen Monat auszuzahlen?"

Batch B3 (REDESIGN-PLAN.md section 4.2) - the money screens, deliberately late. By B3 the pattern is settled, so review spends its whole budget on whether anything TRUE went missing.

Inventory section 9: 458 lines, ns payroll, 51 keys. Class REPORT. NO server writes, therefore NO drawer. This screen s problem is density, not modality: the answer band and the panel shell make it readable, and everything else gets re-typeset, never deleted.

THE STANDARD: the caveat block is the difference between a payroll screen and a payroll screen you can defend in a wage dispute. „Too much text" is not a licence to remove any of it. Typeset smaller or move into a row s detail. Never drop.

DO NOT TOUCH downloadCsv(). Moving the button is fine. Touching the function is not: the \uFEFF BOM, the Vienna businessDate filename and the column set are all load-bearing and all fail silently.

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
- [ ] #1 No Drawer and no Modal is added: this screen performs no server write
- [ ] #2 PageHeader renders the h1 and „Was ist diesen Monat auszuzahlen?" from REDESIGN-PLAN.md section 4.4
- [ ] #3 The reconciliation line renders in BOTH branches: caveatReconcile {server, visible} when missingCents is non-zero, and caveatReconcileOk when it reconciles. The OK branch is as load-bearing as the failure branch - silence is indistinguishable from not checked
- [ ] #4 caveatRateHistory still renders UNCONDITIONALLY, on every load, in every branch
- [ ] #5 All nine caveat branches still exist and still fire on their conditions: caveatUnresolved, caveatOpen, caveatNoneExcluded, caveatTruncated {limit, earliest}, caveatReconcile, caveatReconcileOk, caveatManual, caveatOrphan, caveatRateHistory - with their three links to /shifts/ intact
- [ ] #6 The per-row excluded column still renders excludedNone muted, and excludedUnresolved {count} / excludedOpen {count} joined with the middot separator
- [ ] #7 A worker with no rate still reads as EXCLUDED and never as 0,00 EUR
- [ ] #8 CSV PROVEN BY BYTE COMPARISON: export a file before and after the change for the same period; the header row and the first data row are byte-identical, the file still starts with the UTF-8 BOM, and the filename is still payroll-<Vienna businessDate>.csv
- [ ] #9 downloadCsv() itself is unmodified in the diff; the anchor is still in the document and the object URL is still revoked on the next tick
- [ ] #10 attributionHint still renders (a shift counts in the period it STARTED in, even if it ends after midnight); PAYROLL_PERIODS still excludes all
- [ ] #11 Changing the period still clears the snapshot BEFORE the refetch, so last period rows never sit under this period heading; both empty-period branches still render (emptyLatestRecorded {date} + emptyJump {period}, and emptyNeverRecorded)
- [ ] #12 Every number is integer cents; every numeric cell uses tabular-nums; no float multiply appears in the diff
- [ ] #13 390px screenshot LOOKED AT and attached - the caveat block is still readable there and card captions are correct; 1440px dark screenshot attached
- [ ] #14 de.json, en.json, globals.css, lib/nav.ts and components/* untouched; cd web && pnpm lint && pnpm typecheck green
<!-- AC:END -->
