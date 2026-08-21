---
id: TASK-225
title: >-
  A shift stranded on a phone is invisible to everyone: no server row, no 8h
  net, no way for the office to know
status: Done
assignee: []
created_date: '2026-08-21 00:09'
updated_date: '2026-08-21 07:33'
labels: []
dependencies: []
priority: high
ordinal: 143000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
THE OFFLINE QUEUE WORKS. This is not about the queue failing; it is about the queue succeeding and nobody being able to see it.

MEASURED / READ 2026-08-20:
- a clock-in with the database down answers 500, which ApiFailure classifies retryable, so the row stays queued and a replay lands 201 (ops/break-infra.sh section 2). Hours are delayed, not lost.
- data/ShiftSync.kt's own header states the ceiling: "called on tap, on pull-to-refresh and when the log screen appears. There is no background worker." No WorkManager, no ConnectivityManager callback, no network-constraint job. Grep confirms: the only mentions of WorkManager in the codebase are the two UPGRADE PATH comments.

SO: a cleaner taps in a basement with no signal. The row is written locally and is correct. If they do not open the app again while they have signal, that shift exists on exactly one phone and nowhere else, indefinitely.

WHAT THAT BREAKS, and none of it is visible from the office:

1. The 8h auto-close net does not apply. ops/sql/autoclose.sql operates on the shifts table; a shift with no server row cannot be matched. core/ShiftSignal.kt computes the same 8h boundary locally, but only to flip the display to OVERDUE ("8:00:00+") — nothing closes the local row. So an unpushed shift runs for ever with no timer behind it.

2. The director's payroll is silently short. There is no server-side signal that a shift is missing, because a shift that was never posted is indistinguishable from a shift that never happened.

3. Nobody can even ask the question. No route reports "workers whose phone last synced N days ago" — worker_sessions has no last-seen column and /roster records nothing.

RANKED HIGH because it is the one failure in this system with no detection at all. Every other failure in backlog/docs/RELIABILITY.md is at least visible to somebody.

CHEAPEST USEFUL FIX, in order of cost:

a) a last-seen timestamp stamped on worker_sessions by requireWorkerSession, and a line on the admin Workers screen: "Telefon zuletzt gesehen: vor 3 Tagen". Detection without touching the phone. Answers "is anyone stranded" in one glance.

b) WorkManager with a network constraint on Android, which drains the queue without the worker opening anything. This is what ShiftSync's UPGRADE PATH names.

(a) is cheap and is the one that makes the problem VISIBLE; (b) is the one that makes it rare. Do (a) first: a fix you cannot observe is a fix you cannot trust.

ACCEPTANCE:
- shown RED first: a worker whose session has not been used for N days appears in the admin as stale, seeded by backdating the last-seen column
- clock-in is never blocked by any of this (standing constraint)
- no new npm dependency
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DONE AND IN THE FIELD'S REACH. Both halves shipped and the APK is published, which is the
part that had been missing: the box was still offering 0.4.1-6 while all of this sat in git.

DELIVERY (Android). JobScheduler, id 225, NETWORK_TYPE_ANY, setPersisted(true),
exponential backoff from 30s. Not WorkManager: WorkManager is a wrapper over this class on
API 23+ and buys chained/observable work, of which this app needs none. Ceiling written up
in sync/SyncScheduler.kt and printed ON THE SCREEN: a force-stopped app runs no jobs until
a human opens it; Doze can delay by hours; backoff caps at 5h. None of that costs money -
start_time and end_time are stamped on the phone at the tap, asserted against the tap's own
clock.

ORDERING. core/SyncPlan.kt, a pure function: oldest first, OPEN before CLOSE for the same
client_uuid, and a row whose OPEN failed has its CLOSE dropped from the pass. Idempotency
is client_uuid, the mechanism that already existed - no second one was added.

DETECTION, the worker. core/PendingWork.kt on the shift screen, the log screen and the
SIGN-IN screen, in German, with the time of the last attempt ("never tried" is a separate
sentence, not a blank).

DETECTION, the office. Three X-Pending-* request headers on requests the app already makes
-> workers.phone_last_seen_at / phone_pending_shifts / phone_pending_blocked /
phone_pending_oldest_start (migration 009, live). Headers not an endpoint, so an older
server ignores them silently and no round trip lands on the clock-in path. /workers/ says
whose phone; /payroll/ says its total is provisional.

PROVEN ON A REAL ANDROID INSTANCE AGAINST PRODUCTION - demo/prove-offline-push.mjs, 9
phases, radio switched off with svc, queue read out of the phone's own SQLite, rows counted
in production Postgres. Final run: OK, with 6 assertions observed RED in the same run.

  0 baseline    no job pending over an empty queue                    RED
  1 offline tap the row is ONLY on the phone; job "waiting"
  2 am kill     arrives with the app never reopened, carrying the TAP's time
  3 ordering    a SIGNED-IN close for an unknown shift -> 404 unknown_shift  RED
  4 duplicate   phone rewound to 'never delivered' -> ONE row, same id       RED
  5 force-stop  the job is CANCELLED; 60s of good network moves nothing      RED
                the German is read off the a11y tree; opening the app delivers
  6 session dies session deleted server-side; row kept, not misfiled         RED
  8 phantom tap Recents and relaunch leave the shift OPEN; a real tap closes it
  9 the office  phone_last_seen_at, phone_pending_shifts

THREE DEFECTS THIS RUN FOUND, none of them visible from the source:

1. THE ORDERING RED WAS AN AUTH FAILURE. Section 3 sent its bogus close with no
   credentials and accepted `404 || 401`. It got 401 from requireAppKey, before the route
   ever looked for a shift - so the line printed RED while proving nothing about ordering.
   Now sent with the phone's own cookie + app key and required to be 404 AND
   `unknown_shift`. Shown red four ways (f182a28).

2. AN EMPTY QUEUE WAS ARMING A JOB, and only when OFFLINE - which is the only case this
   feature is for. Measured on a device, force-stopped first:

     build      launch ONLINE, empty queue   launch OFFLINE, empty queue   offline TAP
     0.5.0 / 7  unknown                      WAITING                       waiting
     0.5.1 / 8  unknown                      unknown                       waiting

   Online the platform runs the job at once, finds nothing and clears it, so the defect is
   invisible. Offline it sits waiting for a signal that will give it nothing to do. That is
   the profile EMUI/MIUI move to RESTRICTED, and a restricted app runs no jobs at all -
   which would take this whole feature down. Fixed in 6f15468/e49bb4d, five mutants red.

3. SETTINGS CRIED WOLF. Once an idle phone holds no job, the two-state line printed "Nicht
   eingeplant. Wartende Schichten gehen erst hinaus, wenn Sie die App oeffnen" in the ERROR
   colour over a phone with no waiting shifts - rows that do not exist, in red, for ever.
   Third uncoloured sentence added, de + en, exact parity.

SHIPPED. versionCode 8, versionName 0.5.1, signer SHA-256
6c786899199011cd2eb9e600ef02f73dbcdd7aa1f27bb69c78d27aa82c42996c (matches the live
assetlinks on the tag host, so App Links still verify). Published to
schimmer-glanz.exe.xyz; publish-apk --verify downloads the bytes back and compares them to
the local file. A phone on the FIELD build was driven through it: clean install of
0.4.1-6, signed in, Settings reads "Installiert: 0.4.1 (6)" and "Version 0.5.1 ist
verfuegbar." with a Herunterladen button. That is the whole chain, not just the bytes.

CLOCK-IN NOT SLOWED: ensure() is one binder call AFTER the row is on disk, off the main
thread, swallowing its own failures; the heartbeat is a cached field read and its UPDATE is
fire-and-forget with .catch(). core-check pins the ordering.

CLEANED UP: throwaway admins 58 + 59, worker 75, its sessions and its 8 shifts all deleted.
Production reads 1 admin / 0 workers / 0 shifts / 0 sessions / 1 location / 0 zones /
0 reported_tags, HOIV still pinned. smoke-live.sh: SMOKE OK.

NOT PROVEN, and it cannot be from here: a real radio in a real basement, and a real NTAG213
(TASK-222 is the owner's). An emulator's `svc wifi disable` is a clean, instant loss of
connectivity; a basement is a slow, flapping one. Everything above is on a real Android
instance but not on real hardware in a real building.

ALSO MEASURED, worth knowing: 0.4.1-6 CANNOT open the database 0.5.x writes - SQLiteOpenHelper
throws on downgrade and the app dies on launch. Not a field path (the server only ever offers
a higher version_code and Android refuses a downgrade), but it is the evidence behind
publish-apk.sh's rule that the recovery for a bad build is a HIGHER version_code, never
reinstalling the old APK.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An offline tap now reaches the server on its own (JobScheduler 225, network constraint, reboot-persistent, backoff), in the right order (SyncPlan: oldest first, OPEN before CLOSE, idempotent on the existing client_uuid), and what has NOT arrived is visible to the worker (PendingWork, German, with the time of the last attempt) and to the office (X-Pending-* headers -> workers columns, migration 009; /workers/ and /payroll/). Proven on a real Android instance against production by switching the radio off: demo/prove-offline-push.mjs, 9 phases, OK with 6 REDs in the same run. Found and fixed three defects nothing in the source could see: an ordering RED that was really a 401 from the auth layer, an empty queue arming a job whenever the phone was OFFLINE (the RESTRICTED-bucket risk that would kill the feature), and a Settings alarm that was red on every healthy phone. SHIPPED: 0.5.1 / versionCode 8, published and offered - a phone on the field build 0.4.1-6 reads 'Version 0.5.1 ist verfuegbar.' Production cleaned back to 1 admin / 0 workers / 0 shifts; smoke-live OK.
<!-- SECTION:FINAL_SUMMARY:END -->
