---
id: TASK-160
title: 'URL filter contract: every cross-link carries its filter'
status: To Do
assignee: []
created_date: '2026-08-18 03:16'
labels:
  - ux
  - ia
dependencies: []
documentation:
  - backlog/docs/IA-PLAN.md
  - backlog/docs/JOURNEYS.md
priority: high
ordinal: 78000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
THE KEYSTONE. Ships alone, changes no schema, needs no APK, and closes six of the nine named gaps in JOURNEYS.md section 6 BEFORE any panel or map exists. Reasoning: decision-38 (PROPOSED - do not build until accepted). Plan: backlog/docs/IA-PLAN.md sections 3 and 5.

Today every cross-link in the admin is a bare navigation. /shifts/ accepts exactly one parameter, ?period=, read from window.location.search (NOT useSearchParams, so the static export keeps working) - that existing pattern in web/app/shifts/page.tsx is the pattern to copy, five more parameters wide, across six screens.

ONE VOCABULARY, identical on every screen:
  location=<uuid>  worker=<uuid>  client=<uuid>  shift=<uuid>
  period=  all | thisMonth | lastMonth | last30Days | last7Days   (the literal ids in lib/period.ts)
  state=   open | unresolved | manual | noEmail | noTag
  status=  open | decide | order | deliver    (materials only)
  open=<uuid>   opens the edit drawer on /locations/

SCREENS THAT READ PARAMETERS: /shifts/ (location, worker, state, period, shift, origin), /payroll/ (location, worker, period), /pl/ (location, period), /contracts/ (location), /material-requests/ (location, status, worker), /locations/ (open, client, state), /workers/ (worker, state), /clients/ (client).

SCREENS THAT WRITE THEM: /payroll/ three caveat links (period AND state - the source period must equal the target period; today payroll defaults to lastMonth and /shifts/ to last30Days, so the director lands in the wrong period), /pl/ four links, /analytics/ panel, /shifts/ rows, /material-requests/ rows, / triage bullets (period=all is MANDATORY on the unresolved link - an unresolved shift is frequently older than 30 days and that is what makes it unresolved), /locations/ rows, /clients/ rows.

THREE RULES, all mandatory:
 1. never render a link to an empty target - state the zero in words instead. A link that lands on 'nichts gefunden' is the misreading this product has already produced once.
 2. the label states the filter before the click ('Schichten dieses Objekts - November').
 3. the target echoes the filter as a REMOVABLE CHIP ('Objekt: Arsenalstrasse x'). Without it a filtered screen is indistinguishable from an empty database - the exact failure home.recentScope was written to prevent.
Unknown parameters are ignored SILENTLY. Never a 404, never an error.

MUST NOT CHANGE: /shifts/ keeps its UNBOUNDED client-side snapshot. Parameters seed the existing client-side filter state; they must never become a server query. A server-bounded fetch cannot say 'nothing in August - 5 shifts exist in earlier periods', and that distinction was once the difference between 'fine' and 'our payroll data is gone'. /payroll/ internals frozen: every caveat branch, both reconcile branches, the CSV shape. de/en exact key parity for every new chip and label.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All six reading screens accept the vocabulary in backlog/docs/IA-PLAN.md section 3; a parameter a screen does not understand is ignored silently, renders no error and does not 404
- [ ] #2 D7: clicking payroll's '{n} Schichten muessen bestaetigt werden' lands on /shifts/ showing exactly those shifts, in payroll's OWN period, with state=unresolved - proven by asserting the source period id equals the target period id
- [ ] #3 D4: the dashboard's unresolved triage bullet links with period=all, and an unresolved shift older than 30 days is still on screen after the jump
- [ ] #4 Every filtered screen renders a removable chip naming the filter, and removing it restores the unfiltered view without a reload
- [ ] #5 No link is rendered to a target that would show zero rows; the zero is stated in words in the same place
- [ ] #6 /shifts/ still fetches an UNBOUNDED snapshot (no from/to on the request) and still offers the 'latestRecorded' escape from an empty period
- [ ] #7 de.json and en.json key sets stay byte-identical; the parity check is green
<!-- AC:END -->
