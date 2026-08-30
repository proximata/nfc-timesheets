---
id: TASK-323
title: >-
  iOS has no enrolment-code parity check, so the same drift that reddened
  Android passed silently
status: To Do
assignee: []
created_date: '2026-08-29 23:03'
labels:
  - ios
  - checks
dependencies: []
priority: high
ordinal: 241000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Android's checks/core-check.kt reads ALPHABET / CODE_CHARS / the input cap straight out of
server/lib/enrolment.js and fails when client and server disagree (core-check.kt:1321-1329). That
is exactly how decision-63's 5-digit change was caught.

iOS has NO equivalent. NFCTimeSheets/checks/ contains 16 checks and none of them mentions
EnrolmentCode (grep -rl EnrolmentCode NFCTimeSheets/checks/ -> only sms-gate-check.swift, and
that is about the SMS flag). So NFCTimeSheets/checks/run.sh printed 'checks: OK' at the same
commit where the iPhone could not accept a single real code.

An asymmetric gate is worse than no gate: it makes one platform's green look like both.

SHAPE: a checks/enrolment-code-check.swift in the style of the existing checks - cat the Swift
source together with the check and run it under plain 'swift', reading the server literals out of
server/lib/enrolment.js the way core-check.kt does, so it can never be a retyped copy. Wire it
into checks/run.sh.

PROVE IT RED: revert EnrolmentCode.swift to length 8 and the check must fail.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 NFCTimeSheets/checks/enrolment-code-check.swift exists and is wired into checks/run.sh
- [ ] #2 it reads the alphabet, length and input cap out of server/lib/enrolment.js, never retyped
- [ ] #3 proven red against a deliberately drifted EnrolmentCode.swift
<!-- AC:END -->
