---
id: TASK-189
title: 'An Android cleaner cannot see their own hours: GET /shifts/mine is iOS-only'
status: To Do
assignee: []
created_date: '2026-08-19 11:52'
labels:
  - android
  - worker
  - payroll
  - evidence
dependencies: []
priority: medium
ordinal: 107000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DEFERRED BY THE TRIAGE RUN OF 2026-08-19 -- filed, not built.

THE ASYMMETRY, measured at HEAD:
  server/routes/app.js:475   { method: "GET", path: "/shifts/mine", auth: "worker" }  exists
  NFCTimeSheets/API.swift:501  calls it
  android/.../net/Api.kt        does NOT. It calls /material-requests/mine and nothing else.

So an iPhone worker can reconcile their own hours and an Android worker cannot. Android is
the platform the only live building actually runs (Balint, HOIV, enrolment code, sideloaded
APK). The worker who most needs the number is the one who cannot see it.

WHY IT MATTERS, and it is not a nice-to-have: when a shift is auto-closed at 8h, or closed by
hand from the admin panel because the worker could not tap out (INCIDENT 1, 2026-08-11), the
hours on the payslip are decided entirely on the director's side. The worker has no record of
their own to compare it against. That is a pay dispute with exactly one source of truth, held
by the party who pays. The correction note (TASK-46) records WHY the director changed a row;
this task is the other half -- the worker being able to SEE that it changed.

SHAPE, deliberately small. Not a payroll screen. Not money.
  - Api.kt gains myShifts(since): GET /shifts/mine?since=<iso8601>. The route already requires
    'since' (400 without it) and is SESSION-SCOPED server-side: it must never take ?worker=,
    and server/check-api.js:1559 already pins that. Do not add a parameter.
  - one screen reachable from the app's existing settings/idle surface: date, building, start,
    end, duration, and the state in WORDS (laeuft / automatisch beendet / nicht bestaetigt /
    abgeschlossen), never colour alone.
  - HOURS ONLY. No rate, no euro amount, no total pay. The worker's rate lives in workers.
    hourly_rate_cents and is the director's field; showing money here would make this screen a
    payslip and put it in scope of a rate-history problem it cannot solve (TASK-20).
  - Vienna timezone at the formatting boundary, including across DST. A shift that says one
    time in the app and another in the admin is worse than no screen.
  - offline: it is a read. No network -> say so in words and show nothing stale without
    saying it is stale. It must NEVER sit in the tap path or delay a clock-in.
  - de/en exact key parity, Austrian business German, every plural.

MUST NOT REGRESS: the tap path (android/checks/core-check.kt -- a tap writes its local row
before any signal is armed), the session in SharedPreferences, and the rule that there is no
in-app button that CLOSES a shift. This screen is read-only about the past. It offers no
control that writes a shift.

SEQUENCING: it needs a build on the phone to be worth anything, so it rides whatever release
carries the INCIDENT 1 clock-out fix. Do not cut a release for this alone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Api.kt calls GET /shifts/mine?since=<iso8601> and never sends a worker id
- [ ] #2 A worker sees their own shifts: date, building, start, end, duration, and the state as a word
- [ ] #3 No rate, no euro amount and no total appears anywhere on the screen
- [ ] #4 Times render in Europe/Vienna and match the admin panel for the same shift, including across a DST boundary
- [ ] #5 An auto-closed and an unconfirmed shift are distinguishable from a normal one in words, not by colour alone
- [ ] #6 With no network the screen says so; nothing stale is shown without being labelled stale
- [ ] #7 android/checks/core-check.kt still passes: no tap is delayed, blocked or reordered by this screen
- [ ] #8 de/en key parity exact; no hardcoded user-visible string
<!-- AC:END -->
