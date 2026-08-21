---
id: TASK-225
title: >-
  A shift stranded on a phone is invisible to everyone: no server row, no 8h
  net, no way for the office to know
status: To Do
assignee: []
created_date: '2026-08-21 00:09'
updated_date: '2026-08-21 00:09'
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
