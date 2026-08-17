---
id: TASK-150
title: >-
  Redesign /analytics/: the table stays primary, all map and photo failure
  states survive
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
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frage: „Wo geht die Zeit hin?"

Batch B3 (REDESIGN-PLAN.md section 4.2). Inventory section 11: 695 lines, ns analytics, 92 keys. Class REPORT with one write (retry geocoding one building). The hardest report: a map, a detail panel, a nested trend table and seven photo states.

„THE MAP IS THE OPTIONAL PART AND THE TABLE IS NOT." Everything the map shows, the table shows too, for every building including the un-pinned ones. That is also what makes the screen keyboard- and screen-reader-usable without a second implementation. A redesign must not demote the table to make room for a bigger map.

The map container is ALWAYS in the DOM, hidden rather than unmounted, so the ref exists when the API resolves and no Map is constructed into a zero-height box. Do not switch it to conditional rendering to tidy the JSX.

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
- [ ] #1 The table is still the PRIMARY presentation and still lists every building including un-pinned ones; noteMapEquivalent still states that the map shows nothing the table does not
- [ ] #2 PageHeader renders the h1 and „Wo geht die Zeit hin?" from REDESIGN-PLAN.md section 4.4
- [ ] #3 All seven map states still render their own message: mapNoKey, mapNoPins {unpinned}, mapLoading, mapReady {pinned, unpinned}, mapBlocked (gm_authFailure, which fires LATE after new Map() already succeeded), mapTimeout, mapNetwork with its mapRetry button
- [ ] #4 The map container is still ALWAYS in the DOM and merely hidden, never conditionally unmounted; verified in the diff
- [ ] #5 mapTableHint still renders ONLY when mapStatus === ready - the screen never prints „select a pin" under „no map was drawn"
- [ ] #6 All seven photo-absence reasons still render as words (photoNoKey, photoNoPin, photoLoadFailed, photoNotChecked, photoDenied, photoNoImagery, photoUnavailable {status}) and no grey rectangle is ever presented as a building
- [ ] #7 The <img> is still a plain <img> and its biome-ignore comment AND the reasoning in that comment are preserved verbatim (static export has no image optimizer, decision-16)
- [ ] #8 trendInsufficient still renders for fewer than two months with shifts - never a flat line, which would be a claim with nothing behind it
- [ ] #9 Trend direction is still in WORDS (trendUp {delta} / trendDown {delta} / trendFlat); no lone arrow glyph carries the meaning; .trend-bar is still aria-hidden and the number beside it is still the fact
- [ ] #10 Variance still prints a signed +h:mm explicitly, because formatDuration only ever emits a minus; varianceUnknown / varianceExact / varianceOver / varianceUnder all survive, as does targetUnknown
- [ ] #11 All four geocode states and all four retry outcomes still render, including geoRetryNoPin {name, status} - a 200 does NOT mean a pin came back - and geoRetryNoAddress {name} for 422
- [ ] #12 The standing callout still renders permanently: noteExclusions, noteTrend (arithmetic, not a forecast), noteTargetSource, noteMapEquivalent
- [ ] #13 The building detail panel still receives focus on open and panelClose still returns focus to the control that opened it, including when opened from a map pin
- [ ] #14 390px screenshot LOOKED AT and attached with the map in a NON-ready state so the table-only path is what is verified; 1440px dark screenshot attached
- [ ] #15 de.json, en.json, globals.css, lib/nav.ts and components/* untouched; cd web && pnpm lint && pnpm typecheck green
<!-- AC:END -->
