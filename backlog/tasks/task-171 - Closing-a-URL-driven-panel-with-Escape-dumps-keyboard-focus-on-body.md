---
id: TASK-171
title: Closing a URL-driven panel with Escape dumps keyboard focus on <body>
status: Done
assignee: []
created_date: '2026-08-18 09:36'
labels:
  - a11y
  - ia
dependencies: []
ordinal: 89000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED, /shifts/ and /payroll/, demo/probe-focus-restore.mjs on 127.0.0.1:8080.

Open a worker panel from a table row link (a[href*='?worker=']), press Escape:
  focusIn=true  escClosed=true  restored=false  landed=BODY  openerConnected=false

The same probe on a BUTTON-opened create drawer (/workers/ 'Mitarbeiter anlegen') is GREEN,
and goes RED when useOverlay's restoration lines are deleted — so the probe discriminates.

CAUSE, not a guess. lib/useOverlay.ts restores in the effect CLEANUP:
    if (opener?.isConnected) opener.focus()
    else document.getElementById('main-content')?.focus()
For a URL-driven panel the close itself re-renders the list that holds the opener anchor.
At cleanup time the anchor is still connected, so .focus() succeeds; React then replaces
that node in the same commit and the browser drops focus to <body>. The isConnected guard
was written for 'the save removed the row', where the removal happened in an EARLIER commit.

Not the App Router: lib/filters.ts uses raw history.pushState/replaceState on purpose.

AC
1. Escape on ?worker= / ?location= panels leaves focus on the opener, or on #main-content
   if the opener is genuinely gone. NEVER on <body>.
2. Same for the panel's own close button.
3. demo/probe-focus-restore.mjs is GREEN for PROBE_SCREEN=/shifts/ and /payroll/ with
   PROBE_OPENER='Mitarbeiterpanel oeffnen', and still RED when restoration is deleted.
4. The button-opened drawers do not regress (audit-overlays, audit-overlays2, audit-keyboard).

MUST NOT REGRESS: decision-38 (query parameters, no router navigation, static export).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Escape on a URL-driven panel never leaves focus on <body>
- [ ] #2 the panel close button behaves the same as Escape
- [ ] #3 probe-focus-restore is GREEN on /shifts/ and /payroll/ link openers and still RED when useOverlay restoration is deleted
- [ ] #4 button-opened drawers do not regress
<!-- AC:END -->
