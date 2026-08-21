---
id: TASK-233
title: >-
  The force-stop caveat is below the fold on the pending card, and it is the one
  line that tells a worker to act
status: To Do
assignee: []
created_date: '2026-08-21 07:34'
labels:
  - android
  - ux
  - task-225-followup
dependencies: []
ordinal: 151000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED, twice, by demo/prove-offline-push.mjs on a 1080x2400 device: 'the force-stop caveat is the card's last line and starts below the fold'. The check scrolls for it rather than pretending the first viewport is the whole screen, so the assertion is honest - but a worker is not a check.

The line is R.string.pending_force_stop_note. It is the ONLY sentence on the card that asks the worker to do something ('open the app'), and it is the sentence that matters on exactly the phones that need it: EMUI and MIUI kill backgrounded apps, a force-stopped app runs no jobs at all, and nothing gets delivered until a human launches it.

Everything above it on the card is descriptive - heading, count, oldest start, last attempt, blocked count, and the promise sentence. So the card is ordered worst-first for reading and best-last for acting.

NOT A DELETION, and must not become one: decision-standing constraint, nothing true may be removed to lighten a screen. Caveats may MOVE or SHRINK. This is a move.

CHEAPEST FIX: when pushArmed is false (the platform is holding nothing - which is exactly the force-stop state), promote the caveat above the descriptive lines, or fold the two into one sentence. When the job IS armed the caveat is a footnote and can stay where it is.

ACCEPTANCE:
- shown RED first: assert the caveat's y is above the fold at 1080x2400 with the job cancelled, and watch it fail on today's build
- de/en exact key parity
- nothing removed from the card in either state
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The force-stop caveat is within the first viewport at 1080x2400 when the platform is holding no job
- [ ] #2 Nothing is removed from the pending card in either state - only reordered
- [ ] #3 de/en key parity holds
<!-- AC:END -->
