---
id: TASK-189
title: 'An Android cleaner cannot see their own hours: GET /shifts/mine is iOS-only'
status: Done
assignee: []
created_date: '2026-08-19 11:52'
updated_date: '2026-08-24 20:38'
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
- [x] #1 Api.kt calls GET /shifts/mine?since=<iso8601> and never sends a worker id
- [x] #2 A worker sees their own shifts: date, building, start, end, duration, and the state as a word
- [x] #3 No rate, no euro amount and no total appears anywhere on the screen
- [x] #4 Times render in Europe/Vienna and match the admin panel for the same shift, including across a DST boundary
- [x] #5 An auto-closed and an unconfirmed shift are distinguishable from a normal one in words, not by colour alone
- [x] #6 With no network the screen says so; nothing stale is shown without being labelled stale
- [x] #7 android/checks/core-check.kt still passes: no tap is delayed, blocked or reordered by this screen
- [x] #8 de/en key parity exact; no hardcoded user-visible string
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 20:38
---
VERIFY PASS — independent re-check at 0febf2a, all 8 ACs hold. Read-only verification; no code changed.

AC1 ✓ Api.kt:281 myShifts(since: Instant) -> get("/shifts/mine?since=$query"). No worker param, no ?worker=, no worker id in body/header. send() sets only X-App-Key, X-Client, Accept, Cookie, Content-Type (Api.kt:353-362). Identity = ts_worker cookie only (decision-22). Server side confirms: app.js:434 scopes to session.workerId, returns {shifts:[...]}, LIMIT 500 — contract matches the client's getJSONArray("shifts").

AC2 ✓ MyHoursRow (TimeSheetApp.kt:1836+) renders all six: building (locationName ?: unknown_location), state word, myhours_date(viennaDate(startTime)), myhours_start(viennaTime(startTime)), myhours_end / myhours_end_open, myhours_duration via duration_format. Duration is OMITTED (not zeroed, not faked) for the one endTime==null case — correct, not a gap.

AC3 ✓ HARD GATE PASSED. grep -i '€|EUR|rate|hourly|total|cents|money|pay|sum(' across lines 1690-1905 (new screen + its SettingsScreen entry point): 4 hits, all in doc comments, all negations ('never a rate, never a total'). Zero code paths. Same grep over the 13 new string values: zero. '€' appears nowhere in TimeSheetApp.kt at all.

AC4 ✓ DST hand-checked. New file-private viennaZone/viennaDateFormat/viennaTimeFormat (ZoneId.of("Europe/Vienna")). This is a JUSTIFIED new formatter, not a duplicate: the pre-existing dateFormat/timeFormat use ZoneId.systemDefault(), which would FAIL this AC on any phone not set to Vienna, and grep confirms no pre-existing Vienna-fixed utility existed on Android. Ran the actual JDK formatters (Studio JBR) against Intl/de-AT with timeZone Europe/Vienna (the web admin's BUSINESS_TIME_ZONE, web/lib/shifts.ts:106) for the same UTC instants:
  2026-10-25T00:30Z -> 02:30 both (CEST, +02:00)   fall-back boundary
  2026-10-25T02:30Z -> 03:30 both (CET,  +01:00)   same shift, other side of DST
  2026-03-29T00:30Z -> 01:30 both / T02:30Z -> 04:30 both   spring-forward
  2026-10-25T22:45Z -> 23:45 both   near-midnight, correct DAY
Identical on every case. Duration uses Duration.between on Instants -> 120 min real elapsed across the fall-back, not 60. App and admin agree.

AC5 ✓ Distinguishable BY WORD, colour is only the second signal. myHoursStatusRes (TimeSheetApp.kt:1885) mirrors ShiftRow's when-order exactly: endTime==null -> status_running 'Läuft'; needsResolution (autoClosed && correctedAt==null, Wire.kt:268) -> status_auto_closed 'Automatisch beendet'; correctedAt!=null -> status_corrected 'Korrigiert'; else -> status_closed 'Abgeschlossen' (the one new string — ShiftRow renders 'else -> null', a blank line). Auto-closed-unconfirmed, auto-closed-corrected and normal are three distinct words. Same vocabulary as the existing screen, so one state never has two names.

AC6 ✓ Failed(offline = failure.status == 0) -> myhours_offline 'Keine Verbindung. Ihre Stunden können gerade nicht geladen werden.' in words; ApiFailure.network() (status 0) is thrown for offline/DNS/timeout/TLS (Api.kt:374). Stale is impossible by construction, not by caveat: the Failed branch renders zero rows, loadMyHours sets _myHours = Loading SYNCHRONOUSLY before launching, nothing is cached or persisted, and SettingsScreen only exists under SessionState.SignedIn (TimeSheetApp.kt:132) so sign-out destroys the composable rather than leaving old rows on screen.

AC7 ✓ HARD GATE PASSED. git diff 0febf2a~1..0febf2a -- android/checks/core-check.kt is EMPTY; git status clean on android/checks/. ./checks/run.sh exit 0, every section OK: core-check, known-tags-check, tag-writer-check, manifest-check, verify-no-shift-check. Tap path provably untouched by a stronger argument than the check alone: git --numstat shows 0 DELETIONS in all five files (16/178/45/21/25 added, 0 removed) — no pre-existing line was altered anywhere. loadMyHours has exactly two call sites, both inside MyHoursScreen (LaunchedEffect + the retry button); ShiftSignal.Tab, visibleTabs, NfcTapActivity, ScanActivity, TapInbox and the manifest are not in the diff at all.

AC8 ✓ de/en key-set parity exact across the WHOLE file: 272 keys, diff clean. All 13 new keys (myhours_open/title/window/empty/offline/error/date/start/end/end_open/duration, back, status_closed) present exactly once in both, same %1$s placeholders. Grepped the new block for bare literals: the single quoted-string hit is pre-existing SettingsScreen code outside this diff. Every new string goes through stringResource. German is the default locale file, Austrian business form ('Ihre Schichten…').

Build: gradlew :app:compileDebugKotlin exit 0. No release cut, no deploy, nothing on device — as the task requires ('do not cut a release for this alone'); it rides the INCIDENT 1 clock-out release.

NITS, none blocking and none an AC gap: (a) a 2xx with an unparseable body maps to ApiFailure.network() and so reads as 'Keine Verbindung' rather than 'konnte nicht geladen werden' — inherited from Api.send's existing convention, not introduced here; (b) loadMyHours catches only ApiFailure, matching all five existing loaders in the same file.
---
<!-- COMMENTS:END -->
