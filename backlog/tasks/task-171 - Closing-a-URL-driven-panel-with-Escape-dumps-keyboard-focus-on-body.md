---
id: TASK-171
title: Closing a URL-driven panel with Escape dumps keyboard focus on <body>
status: Done
assignee: []
created_date: '2026-08-18 09:36'
updated_date: '2026-08-27 07:49'
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
- [x] #1 Escape on a URL-driven panel never leaves focus on <body>
- [ ] #2 the panel close button behaves the same as Escape
- [x] #3 probe-focus-restore is GREEN on /shifts/ and /payroll/ link openers and still RED when useOverlay restoration is deleted
- [ ] #4 button-opened drawers do not regress
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT 2026-08-27, re-measured on a freshly built web/out (keyed build) served by server/server.js on 127.0.0.1:8080 over nfc_demo. No app code touched.

AC1+AC3 VERIFIED. demo/probe-focus-restore.mjs, real stdout:
  PROBE_SCREEN=/shifts/  PROBE_OPENER='Mitarbeiterpanel oeffnen'
    ok   the opener navigated away, so focus went to #main-content - not to BODY
    GREEN   exit=0
  PROBE_SCREEN=/payroll/ same opener
    ok   the opener navigated away, so focus went to #main-content - not to BODY
    GREEN   exit=0
  default (/workers/, button opener 'Mitarbeiter anlegen')
    ok   focus returned to the opener - BUTTON 'Mitarbeiter anlegen'
    GREEN
The landed=BODY / restored=false state described in the task is gone.

AC2 LEFT UNCHECKED - not measured. probe-focus-restore and audit-overlays both close with Escape only; no check in the tree drives the panel's own close BUTTON. Not evidence of a defect, just no evidence either way.

AC4 LEFT UNCHECKED - two of the three named checks are green, the third did not finish:
  demo/audit-overlays2.mjs   25/25 passed, 0 FAILED   exit=0
  demo/audit-keyboard.mjs    14/14 passed, 0 FAILED   exit=0
  demo/audit-overlays.mjs    exit=1, Error: no control containing: Operator anlegen
                             (audit-overlays.mjs:99 clickAndRemember, /operators/ create drawer)
Before it died every focus assertion it reached was ok ('shifts:correct/shifts:create/workers:edit: focus restored to the opener'), so no focus-restoration regression is visible - but the run is incomplete, so AC4 is not claimed.

SEPARATE FINDING, not TASK-171 and not fixed here: 'body scroll released after close' FAILS on every desktop overlay measured - audit-overlays lines 15/25/35/43 (shifts:correct, shifts:create, workers:edit, workers:deactivate-confirm) and audit-map-a11y (Objektpanel drawer, map info box). The phone bottom sheet passes the same assertion. Also FAIL in audit-overlays: 'skip link is the first tab stop - A "Schichten"' and 'skip link moves focus to #main-content - A#'. Worth its own task.
<!-- SECTION:NOTES:END -->
