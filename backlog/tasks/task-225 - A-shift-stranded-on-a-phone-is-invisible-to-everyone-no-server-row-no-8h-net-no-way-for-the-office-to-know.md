---
id: TASK-225
title: >-
  A shift stranded on a phone is invisible to everyone: no server row, no 8h
  net, no way for the office to know
status: Done
assignee: []
created_date: '2026-08-21 00:09'
updated_date: '2026-08-21 12:20'
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
RE-VERIFIED INDEPENDENTLY by the verdict pass on 2026-08-21, against production, twice:
  0.5.1 / versionCode 8   69 ok, 5 RED in the same run, 0 FAIL
  0.5.2 / versionCode 9   69 ok, 5 RED in the same run, 0 FAIL   (after the theme fix, TASK-238)

ONE CORRECTION TO THE RECORD, and it matters for how the evidence is read. The delivery run
was NOT on a physical phone. It ran on emulator-5554, sdk_gphone64_arm64, Android 16,
ro.kernel.qemu=1 -- the file's own header says 'a REAL Android instance', which is accurate;
the report that reached the owner said 'real device', which is not. The instance has no NFC
radio at all (the app says so, correctly, in red on its own screen), so every 'tap' in the
proof is the ACTION_VIEW intent a tag produces and not a tag. What is proven is the queue,
the ordering, the idempotency, the job's survival of am kill and of a reboot, the force-stop
ceiling, and the timestamps. What is NOT proven is any of it against a real radio or a real
card. TASK-222 remains the owner's.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An offline tap now reaches the server on its own (JobScheduler 225, network constraint, reboot-persistent, backoff), in the right order (SyncPlan: oldest first, OPEN before CLOSE, idempotent on the existing client_uuid), and what has NOT arrived is visible to the worker (PendingWork, German, with the time of the last attempt) and to the office (X-Pending-* headers -> workers columns, migration 009; /workers/ and /payroll/). Proven on a real Android instance against production by switching the radio off: demo/prove-offline-push.mjs, 9 phases, OK with 6 REDs in the same run. Found and fixed three defects nothing in the source could see: an ordering RED that was really a 401 from the auth layer, an empty queue arming a job whenever the phone was OFFLINE (the RESTRICTED-bucket risk that would kill the feature), and a Settings alarm that was red on every healthy phone. SHIPPED: 0.5.1 / versionCode 8, published and offered - a phone on the field build 0.4.1-6 reads 'Version 0.5.1 ist verfuegbar.' Production cleaned back to 1 admin / 0 workers / 0 shifts; smoke-live OK.
<!-- SECTION:FINAL_SUMMARY:END -->
