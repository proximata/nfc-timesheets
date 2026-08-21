---
id: TASK-234
title: >-
  A job armed for real work is never cancelled when the foreground pass delivers
  it instead
status: To Do
assignee: []
created_date: '2026-08-21 07:34'
updated_date: '2026-08-21 07:36'
labels:
  - android
  - task-225-followup
  - reliability
dependencies: []
ordinal: 152000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND while fixing TASK-225's empty-queue arm, and deliberately NOT fixed in the same change because it is a different mechanism and carries a real risk.

WHAT HAPPENS. A tap arms job 225. The worker then opens the app; refresh() runs a foreground pass and delivers the row. The queue is now empty - but the JOB IS STILL PENDING. Nothing cancels it. It sits until a network appears, ShiftSyncJob runs, finds pendingSummary().waiting == 0, returns 'do not reschedule' and disappears.

COST: one wasted wakeup per drained queue. Small. It is the SAME class as the empty-queue arm fixed in 6f15468 - a job that wakes to find nothing to do - and the same EMUI/MIUI RESTRICTED-bucket risk sits behind it, just at a much lower rate.

WHY IT WAS NOT FIXED WITH THE OTHER ONE. The obvious fix is 'cancel the job when the queue drains', and a cancel on the delivery path is exactly the kind of change that loses a shift: cancel after a pass that THOUGHT it delivered everything but raced with a tap, and the new row has no job behind it. The empty-queue arm was safe to fix because refresh() and the boot receiver already re-arm on the same predicate; a cancel has no such safety net.

IF DONE: the cancel must be strictly after a re-read of the queue, must be a no-op when anything is waiting or blocked-but-retryable, and demo/prove-offline-push.mjs must grow a phase that taps DURING a foreground pass and asserts the row still arrives with the app closed.

MEASURED CONTEXT (device, force-stopped first so job state starts at 'unknown'):
  0.5.1/8 launch offline with an empty queue -> unknown   (fixed)
  0.5.1/8 offline tap                        -> waiting   (correct)
  0.5.1/8 tap, then open the app and let refresh() deliver -> job still 'waiting' over an empty queue  (THIS)

ACCEPTANCE:
- shown RED first: arm a job, deliver in the foreground, assert no job is pending - fails on today's build
- a tap racing the foreground pass still arrives with the app never reopened
- CLOCK-IN IS NEVER BLOCKED
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After a foreground pass drains the queue, no job remains pending
- [ ] #2 A tap that races the draining pass still arrives with the app closed - proven, not argued
- [ ] #3 Nothing on the clock-in path is added or slowed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PROVENANCE, corrected before anyone acts on this.

The first two lines of the table in the description ARE device measurements, taken on 0.5.0/7 and 0.5.1/8, force-stopped first so the job state starts at 'unknown'.

THE THIRD LINE WAS NOT. The device was signed in to the throwaway worker that had just been deleted during cleanup, so its foreground pass 401'd and delivered nothing - the reading it produced (queue=1, job=waiting) says nothing about a job outliving a SUCCESSFUL pass. Struck.

What IS certain, and it is enough for this task, is a property of the source rather than a reading: THE APP NEVER CANCELS A JOB. Every JobScheduler call it makes, in the whole tree:

    scheduler.schedule(job) == JobScheduler.RESULT_SUCCESS
    scheduler.getPendingJob(JOB_ID)
    scheduler.allPendingJobs.any { it.id == JOB_ID }

No cancel(), no cancelAll(). The only two cancel( hits in the app are a coroutine Job in ShiftSyncJob.onStopJob and an update-poll Job in the ViewModel. So a job armed for a row that the FOREGROUND then delivers can only be cleared by the platform running it - which needs a network and a wakeup - or by a force-stop. That is the waste this task is about, and it follows from the code without needing the reading.

Before implementing, take the missing measurement properly: a live throwaway worker, a real enrolment, tap offline, restore the network, open the app, let refresh() deliver, THEN read the job state. That reading is also the RED this task's acceptance asks for.
<!-- SECTION:NOTES:END -->
