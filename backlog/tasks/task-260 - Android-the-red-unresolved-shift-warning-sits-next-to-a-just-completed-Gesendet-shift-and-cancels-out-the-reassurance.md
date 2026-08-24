---
id: TASK-260
title: >-
  Android: the red unresolved-shift warning sits next to a just-completed
  Gesendet shift and cancels out the reassurance
status: Done
assignee: []
created_date: '2026-08-24 19:06'
updated_date: '2026-08-24 22:21'
labels:
  - android
  - ux
  - worker
dependencies: []
modified_files:
  - android/app/src/main/res/values/strings.xml
  - android/app/src/main/res/values-en/strings.xml
  - >-
    android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets/ui/TimeSheetApp.kt
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
- [x] #1 A worker who has just clocked out cleanly can tell at a glance that the unresolved-shift warning is not about the shift they just finished
- [x] #2 The unresolved-shift card names the date of the shift it refers to
- [x] #3 The card is still reachable and still unmissable — the mandatory-resolution requirement of decision-10 is untouched
- [x] #4 A brand-new worker's first screen is checked for this case explicitly: inherited history must not read as something the new worker did wrong
- [x] #5 de and en strings.xml both carry any new strings with exact key parity, including plurals
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Format resolve_banner plurals (de+en) to take a 2nd arg: the date of the shift needing an end time.
2. LogScreen idle card: pass dateOnly(log.unresolved.minBy{it.startTime}.startTime) as the 3rd pluralStringResource arg.
3. ShiftRunningScreen: replace unresolvedCount:Int param with unresolved:List<WireShift> (single source of truth), same dating in its card.
4. decision-10 placement/reachability untouched -- date-only fix (option a from the task).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified decision-10 untouched: card still unconditionally rendered whenever log.unresolved/unresolved is non-empty, in both idle LogScreen and running ShiftRunningScreen -- no dismiss, no hide, no demotion below Zuletzt. Fix is (a) only, per the task's own steer: card now names the date of the oldest unresolved shift, so a worker reading it right after a clean clock-out can see it is not about today. Brand-new worker (AC4): no special-case -- an inherited pre-seeded unresolved shift renders its own true past date, which is the same mechanism, deliberately not gated/hidden (would violate AC3).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 22:21
---
VERIFIED independently at 802d47d (not from the build agent's report).

AC1/AC2 ✓ resolve_banner de: '%1$d Schicht vom %2$s braucht eine Endzeit' / other '…, älteste vom %2$s'. Date = dateOnly(unresolved.minBy{startTime}.startTime), both sites.
AC3 ✓ render condition read at source: TimeSheetApp.kt:693 'if (log.unresolved.isNotEmpty())' and :977 'if (unresolved.isNotEmpty())'. Unconditional, no dismiss/hide, still ABOVE log_recent_section (Zuletzt), resolve_title button intact. decision-10 untouched.
AC4 ✓ stronger than the notes claim: /shifts/unresolved is worker-scoped server-side (pinned by server/check-api.js:1872 'must be scoped to the session's worker'), so a genuinely brand-new worker gets an empty list and NO card at all. Inherited history is therefore only ever the worker's own, and now dated.
AC5 ✓ machine-checked: 272/272 keys parity de↔en, quantity buckets one+other in both, arg sets identical ['1$d','2$s'] in all four items.
minBy on empty list guarded by the isNotEmpty() branch at both sites.

android/checks/run.sh → core-check/known-tags/tag-writer/manifest/verify-no-shift all OK. :app:compileDebugKotlin exit 0. VERDICT: SHIPPED.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
res/values/strings.xml + res/values-en/strings.xml: resolve_banner plurals now take a 2nd date arg (%1$d.../%2$s), same key, same quantity buckets, parity intact. ui/TimeSheetApp.kt: both the idle-screen card and ShiftRunningScreen's card compute the oldest unresolved shift's date via the existing dateOnly() helper and pass it through; ShiftRunningScreen now takes unresolved:List<WireShift> instead of a bare count. android/checks/core-check.kt green (stringResources key-parity check unaffected -- it doesn't assert arg counts). :app:compileDebugKotlin clean. Commit 802d47d.
<!-- SECTION:FINAL_SUMMARY:END -->
