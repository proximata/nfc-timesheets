---
id: TASK-280
title: 'check-telemetry-wire: a failed SMS reports no failure event to the wire'
status: To Do
assignee: []
created_date: '2026-08-26 18:08'
labels:
  - server
  - telemetry
  - bug
dependencies: []
ordinal: 198000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Named by TASK-271's own notes as pre-existing and needing its own task; TASK-275 reproduced it rather than trusting that.

REPRO, by the review gate, in a clean git worktree at 8162f90 (the commit before 9f2faf2, i.e. before any decision-54 server work):
  cd server && SENTRY_DSN='https://check@o4509000000000000.ingest.de.sentry.io/451' node --import ./instrument.mjs check-telemetry-wire.mjs
  FAIL a failed SMS reports the VOCABULARY WORD and nothing else — no recipient, no credential
       no sms failure event reached the wire: transaction, transaction, transaction, transaction
  check-telemetry-wire: FAIL (1)
Identical at HEAD. b77523c, the only other commit in between, touches web/ only and cannot reach this path.

This is the ONLY failing case in server/check-api.js today (1044 lines of output, 1 FAILED), and it fails via the child process check-api.js spawns: 'FAIL the REAL SDK payload leaks nothing and lands as ONE trace'.

The other four cases in the same file pass, so the SDK is wired and scrubbing works; what is missing is that a sendSms() failure produces no event at all — only transactions. Either sendSms's failure path never calls captureMessage/captureException, or the event is produced outside the window the check flushes. Establish which before changing anything: the check's value is that it proves a failure reason reaches Sentry WITHOUT the recipient or the credential, and a fix that makes it pass by loosening the assertion destroys the property.

MUST NOT REGRESS: decision-23 — telemetry must never be required to boot and must never block a clock-in. lib/scrub.js's field list stays as it is.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the root cause is identified: no event emitted, vs emitted-but-not-flushed
- [ ] #2 check-telemetry-wire passes with the assertion UNCHANGED (no recipient, no credential, vocabulary word only)
- [ ] #3 server/check-api.js reports 0 FAILED
<!-- AC:END -->
