---
id: TASK-260
title: >-
  Android: the red unresolved-shift warning sits next to a just-completed
  Gesendet shift and cancels out the reassurance
status: To Do
assignee: []
created_date: '2026-08-24 19:06'
labels:
  - android
  - ux
  - worker
dependencies: []
priority: medium
ordinal: 178000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: Android worker journey, steps 'Observed the landing screen immediately after sign-in, before any tap' and 'Fired the identical tag-tap intent a second time to clock out'. Driven live on the ts-demo emulator against a local demo stack, screenshots 03-signed-in.png and 09-tapout-final.png.

WHAT WAS SEEN: on the Zeiterfassung screen, a red-outlined card reading '1 Schicht braucht eine Endzeit' with a 'Nicht abgeschlossene Schichten' button sits directly above the Zuletzt block. After a clean, normal clock-out the Zuletzt block reads 'Wohnhausanlage Donaufeld / 24.08.26, 20:09 / 0 Std. 20 Min. / Gesendet' — past tense, nothing further needed, exactly the right confirmation. The two are on the same screen at the same time. The red card came from an old auto-closed shift in this worker's history, weeks away from the one just completed.

WHY IT MATTERS FOR UAT: the completed-shift screen has one job — tell a cleaner their day is recorded and nothing more is required of them. A red warning beside 'Gesendet' turns that into a question. A non-technical worker cannot tell whether the warning is ABOUT the shift they just finished. That is the exact moment the app should be at its most reassuring and it is instead ambiguous. Worse on day one: a brand-new worker signing in for the first time can land on a screen that already carries a red warning inherited from history they were never part of, before they have done anything.

NOT IN SCOPE, and must not regress: the 8h auto-close resolution requirement itself (decision-10 — resolution is mandatory) and the ability to reach 'Nicht abgeschlossene Schichten' from the log screen. This is about placement, dating and tone, not about hiding the obligation. The warning must still be reachable and must still be unmissable when the worker looks for it.

FIX SHAPE, choose one and say which: (a) the card names the DATE of the shift needing an end time, so it visibly is not today's; (b) the card moves below the Zuletzt block so the freshest fact leads; (c) immediately after a successful clock-out, the confirmation gets the screen to itself for a beat before the warning returns. (a) is the smallest and is probably enough on its own.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A worker who has just clocked out cleanly can tell at a glance that the unresolved-shift warning is not about the shift they just finished
- [ ] #2 The unresolved-shift card names the date of the shift it refers to
- [ ] #3 The card is still reachable and still unmissable — the mandatory-resolution requirement of decision-10 is untouched
- [ ] #4 A brand-new worker's first screen is checked for this case explicitly: inherited history must not read as something the new worker did wrong
- [ ] #5 de and en strings.xml both carry any new strings with exact key parity, including plurals
<!-- AC:END -->
