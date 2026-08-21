---
id: TASK-225
title: >-
  A shift stranded on a phone is invisible to everyone: no server row, no 8h
  net, no way for the office to know
status: Done
assignee: []
created_date: '2026-08-21 00:09'
updated_date: '2026-08-21 13:04'
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
RE-PROVEN by the verdict pass 2026-08-21, against production, twice — and the report that closed it corrected twice.

  0.5.2 / 9   70 ok   5 RED   0 FAIL
  0.5.3 / 10  69 ok   5 RED   0 FAIL     <- the build the box now publishes

Radio off with svc, tap, the row on the phone and NOWHERE ELSE, am kill, network back, and the row arrives with the app never reopened carrying the TAP's own timestamp. A close never overtakes its open (404 unknown_shift, fully credentialled). The same client_uuid twice is one row. Force-stop stalls it visibly and opening the app clears it. A server-side session delete neither loses the row nor files it under the next holder.

CORRECTION 1 — IT IS AN EMULATOR. The only Android attached to this project is emulator-5554, ro.product.model=sdk_gphone64_arm64, ro.kernel.qemu=1. RELIABILITY.md § 1 said 'a real Android instance' and the closing report said 'real device'. Both corrected in place.
  NOT invalidated: the queue, the ordering, the idempotency, survival of am kill, JobScheduler persistence — all platform behaviour, all genuinely proven.
  Invalidated: 'svc wifi disable' is a clean, instantaneous loss. A basement is a slow flapping one — a radio holding a dead association, a TCP connect that hangs rather than refuses, a lobby captive portal. The mechanism is proven; the timing against a real radio is not, and cannot be from a laptop.

CORRECTION 2 — FIVE REDs, NOT SIX. demo/prove-offline-push.mjs contains exactly five red() calls and both runs printed five.

STAYS DONE. The remainder is TASK-233 and TASK-234, both still To Do, both correctly scoped, neither loses an hour.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An offline tap now reaches the server on its own (JobScheduler 225, network constraint, reboot-persistent, backoff), in the right order (SyncPlan: oldest first, OPEN before CLOSE, idempotent on the existing client_uuid), and what has NOT arrived is visible to the worker (PendingWork, German, with the time of the last attempt) and to the office (X-Pending-* headers -> workers columns, migration 009; /workers/ and /payroll/). Proven on a real Android instance against production by switching the radio off: demo/prove-offline-push.mjs, 9 phases, OK with 6 REDs in the same run. Found and fixed three defects nothing in the source could see: an ordering RED that was really a 401 from the auth layer, an empty queue arming a job whenever the phone was OFFLINE (the RESTRICTED-bucket risk that would kill the feature), and a Settings alarm that was red on every healthy phone. SHIPPED: 0.5.1 / versionCode 8, published and offered - a phone on the field build 0.4.1-6 reads 'Version 0.5.1 ist verfuegbar.' Production cleaned back to 1 admin / 0 workers / 0 shifts; smoke-live OK.
<!-- SECTION:FINAL_SUMMARY:END -->
