---
id: TASK-149
title: >-
  Redesign /pl/: baseline into a drawer, the three refusals and the argument
  survive
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
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frage: „Verdienen wir an diesem Objekt?"

Batch B3 (REDESIGN-PLAN.md section 4.2). Inventory section 10: 630 lines, ns pl, 82 keys. Class REPORT with exactly one settings write - the margin baseline, which is the only drawer candidate on the screen.

Every number comes from the server s SQL. Never browser arithmetic: a 2000-row cap would silently report a smaller month.

THE THREE REFUSALS, stated in the file header and enforced in the rendering, all three survive:
1. no confident zero - unknown revenue is revenueUnknown, never EUR 0,00, because a zero reports a paying client as a total loss
2. „nicht bewertbar" is NOT a pass - assessNoBaseline is its own state
3. the baseline is never invented - it ships UNSET and nothing defaults it

„A flag is not a red dot." The flagged block must stay a paragraph a director can read down a phone line. Do not compress it into a badge.

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
- [ ] #1 The margin-baseline form is the only Drawer on the screen; the report itself is read-only
- [ ] #2 PageHeader renders the h1 and „Verdienen wir an diesem Objekt?" from REDESIGN-PLAN.md section 4.4
- [ ] #3 Refusal 1 proven: a building with revenue_cents === null still renders revenueUnknown and never EUR 0,00 anywhere on the row or in the totals
- [ ] #4 Refusal 2 proven: below_baseline === null with no reason still renders assessNoBaseline as its own state, visually distinct from assessOk
- [ ] #5 Refusal 3 proven: with pl_margin_baseline_bp unset the screen renders baselineUnset and flaggedNoBaseline, flags nothing, and no default value appears anywhere in the diff
- [ ] #6 The flagged block is still a readable PARAGRAPH per building - flaggedFor {name} plus the full reasoning list (whyMargin, whyRevenue, whyLabour, whyMaterial, whyExcluded, whyOpen, shareUnknown) - not a badge, not a red dot, not a tooltip
- [ ] #7 whyExcluded still renders when excluded shifts exist: those hours are real work not charged into this cost, so the true cost is HIGHER than the row shows
- [ ] #8 Every method* line in the methodology callout is still PERMANENTLY VISIBLE and never becomes a tooltip or a disclosure: methodRates / methodRatesUnknown, methodMaterials, methodMaterialPool, methodUnpriced + link, methodUnallocated, methodExclusions, methodNoContract + link
- [ ] #9 Shortfalls are still printed as percentage POINTS via points(), not as percent; ratios still go through bpToRatio
- [ ] #10 All four assessment reasons still render (assessBelow with .row-attention, assessOk, assessNoContract, assessZeroRevenue) and the totals row still renders totalScope {buildings} with totalNotAssessable or totalAllAssessed
- [ ] #11 No number is computed in the browser: every figure still comes from fetchPl(range); the all period is still excluded
- [ ] #12 baselineSaved / baselineCleared / baselineFailed / errorBaselineInvalid announce on the PAGE live region, not inside the drawer that closes
- [ ] #13 390px screenshot LOOKED AT and attached - the flagged paragraphs are still readable there; 1440px dark screenshot attached
- [ ] #14 de.json, en.json, globals.css, lib/nav.ts and components/* untouched; cd web && pnpm lint && pnpm typecheck green
<!-- AC:END -->
