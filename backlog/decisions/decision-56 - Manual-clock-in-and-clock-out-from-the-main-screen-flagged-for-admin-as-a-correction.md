---
id: decision-56
title: >-
  Manual clock-in and clock-out from the main screen, flagged for admin as a
  correction
date: '2026-08-27 09:41'
status: accepted
---
## Context

Both apps currently have exactly one path to open or close a shift: a physical NFC tap.
ContentView.swift and TimeSheetApp.kt each say so in as many words — "There is no in-app
button and there must not be one... a second path to the same row is how two mechanisms
start disagreeing about somebody's hours" — and Android's copy of that comment cites a real
incident: a worker on an adopted tag with no scan fallback had no way to end a shift at all.

The owner has now explicitly asked for a manual path on both ends, for the case where a
worker cannot scan (broken/missing tag, unreachable card, phone NFC hardware issue). This
decision is that explicit override, and the design that keeps the two mechanisms from
silently disagreeing: every manually-started or manually-ended shift is FLAGGED, visibly,
forever — never indistinguishable from a tap-confirmed row.

## Decision

1. Schema (one additive migration): `shifts.manual_start boolean not null default false`,
   `shifts.manual_close boolean not null default false`. Mirrors the existing
   auto_closed/corrected_at pair — one column per independent fact, never conflated.

2. `POST /shifts/open` gains an optional `manual: true` body field. When set, the row is
   stamped `manual_start = true`. Validation is UNCHANGED: the location/zone id still goes
   through `v.activePlace` + `v.requireVerifiedPlace`, the exact gate a real tap uses — a
   manual open only ever succeeds where a real tap would also succeed. The client supplies
   the location_uuid by letting the worker pick a building from the roster (`GET /roster`,
   already fetched and cached on both platforms; no new data endpoint).

3. `POST /shifts/close` gains an optional `manual: true` body field. When set: `end_time`
   is stamped now (unchanged), `manual_close = true`, and — in the SAME update —
   `corrected_at = now()`. `auto_closed` is left false: this is not the 8h-timer/
   implicit-different-building case (that path is untouched), it is a worker directly
   confirming their own finish time in the moment, which is what corrected_at already
   means. This is deliberate reuse of decision-10's existing "resolved" shiftState, not a
   new state — a manual close needs no separate worker confirmation step afterwards.

4. Client UI, both platforms:
   - Idle screen (no shift running): a clearly secondary "Start without a tag" action,
     opening a building picker built from the already-cached roster. Confirmation required.
     Any 422/409 the server already returns (unbound zone, unverified place, already open
     elsewhere) is shown with the SAME copy the tap path already uses.
   - Running-shift screen: a "Stop" button next to the ticking clock, confirmation
     required, explicit copy that this ends the shift now and is flagged for the office.
     Calls close with `manual: true` and no location_uuid.
   - Both actions require a confirmation step — neither is a single accidental tap.

5. Admin visibility: `manual_start`/`manual_close` ride in the existing shift JSON
   (additive, ignored by anyone not looking for them) and get a small visible marker
   wherever shifts are listed/reported — the same standing rule `isManualEntry` (web/lib/
   shifts.ts) already states for admin-typed shifts: "every list that shows shifts must
   show this."

## Consequences

- The tap-only invariant in ContentView.swift/TimeSheetApp.kt's comments is superseded by
  this decision for these two actions specifically; the comments should be updated to
  point here rather than deleted, since the "no silent second path" reasoning is exactly
  why the flags exist.
- No payroll gate changes: a manual close already reads as `resolved` (corrected_at set)
  and a manual open is fully authoritative the instant it is created (decision-19) —
  manual entries are paid like any other shift, just visibly labelled.
- A manual open still requires a verified place server-side — it does not create a new
  way to clock in somewhere nobody has proven a zone/building at (decision-47 untouched).
- Accepted risk: a worker could press "Start"/"Stop" without actually being on site. The
  mitigation is visibility (admin can audit every manual row, forever) and confirmation
  dialogs, not prevention — matching decision-10's own "flag it, don't block it" posture.

