---
id: TASK-153
title: >-
  Redesign merge: fold fragments into de.json/en.json, run pnpm verify, do the
  visual pass
status: To Do
assignee: []
created_date: '2026-08-17 13:24'
labels:
  - ux
  - redesign
dependencies:
  - TASK-140
  - TASK-141
  - TASK-142
  - TASK-143
  - TASK-144
  - TASK-145
  - TASK-146
  - TASK-147
  - TASK-148
  - TASK-149
  - TASK-150
  - TASK-151
  - TASK-152
documentation:
  - backlog/docs/REDESIGN-PLAN.md
  - backlog/docs/REDESIGN-INVENTORY.md
priority: high
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Batch B5 (REDESIGN-PLAN.md section 4.2) - serial, single agent, after every screen task is done.

Fold every web/messages/_fragments/*.{de,en}.json into de.json and en.json, delete _fragments/, run the full cd web && pnpm verify, then the visual pass in section 5.6.

THIS AGENT IS THE ONLY WRITER OF de.json AND en.json for the whole workstream. That is the entire reason this is a separate task: thirteen screen agents appending to two shared files is the concurrent-writer hazard that eats work.

pnpm verify is ALSO exclusive to this task. pnpm check compares de.json against en.json, and while the keys are sitting in fragments it fails BY DESIGN. A screen agent that ran it and „fixed" the failure has written into a file it does not own.

The section 5 risk list is the checklist for the visual pass. Its guards are not optional extras - each one is a regression that no automated assertion catches. 5.2 in particular records a caption bug that shipped once while every test stayed green.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 web/messages/_fragments/ no longer exists; every fragment key landed in de.json or en.json and none was dropped - proven by comparing the union of fragment keys against the diff of the two message files
- [ ] #2 de.json and en.json have IDENTICAL key sets; pnpm check is green
- [ ] #3 cd web && pnpm verify is green in full (lint, typecheck, check, build). This is the only task permitted to run it, and it must be green before anything in this workstream is called done
- [ ] #4 Every new count string is ICU plural with one/other - no hand-concatenated count anywhere (5.10, TASK-40 recorded „4 alte Schichts")
- [ ] #5 MUTATION TEST 5.3 recorded: the 3px left state rule set transparent on purpose makes the /shifts/ screenshot visibly change, then is restored. A rule that never painted is indistinguishable from one that painted correctly
- [ ] #6 GUARD 5.2 recorded per table screen: thead cell count equals tbody row child count, and a 390px screenshot was READ for the caption text, not just for the shape - ResponsiveTableLabels captions by POSITION and has shipped wrong with all tests green
- [ ] #7 GUARD 5.6 recorded: clipboard permission DENIED in the browser, then confirmed that the copy failure notice is visible AND announced on a page-level aria-live region, and that the full tag URI is still selectable on screen
- [ ] #8 GUARD 5.9 recorded: /reinigung/ screenshots visually identical to pre-change - the client portal stays light, nobody approved restyling a page read at another company
- [ ] #9 GUARD 5.8 recorded: one real render via demo/cdp.mjs in dark AND light with a native <select> open, confirming color-scheme stops white-on-white controls
- [ ] #10 GUARD 5.4 recorded: /payroll/ reconciliation line and every exclusion count render the same numbers as a pre-change run on the same input
- [ ] #11 GUARD 5.5 recorded: a post-change CSV export byte-compared against a pre-change export - header row and first data row identical, BOM present
- [ ] #12 GUARD 5.11 recorded: for each of the 13 screens the reviewer answered the section 4.4 question out loud from the top ~400px alone. Any screen that failed is named, not quietly passed
- [ ] #13 No screen page.tsx, no globals.css, no lib/nav.ts and no components/* file is modified by this task beyond what a message-key rename strictly requires; any such edit is listed explicitly
- [ ] #14 Production untouched: no deploy, no service restart, no write. Local only
<!-- AC:END -->
