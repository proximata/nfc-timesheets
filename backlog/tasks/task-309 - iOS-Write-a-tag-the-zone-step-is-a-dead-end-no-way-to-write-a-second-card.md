---
id: TASK-309
title: 'iOS Write a tag: the zone step is a dead end - no way to write a second card'
status: To Do
assignee: []
created_date: '2026-08-29 11:20'
labels:
  - bug
  - ios
  - operator
  - regression
dependencies: []
ordinal: 227000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
BLOCKER found by the review gate on commit 1d1c935. Regression, not pre-existing.

REPRODUCE (Release build, real device or any non-DEBUG build):
Operator > Write a tag > Write card 1 > report lands > zone panel appears > Create zone.
Now try to write card 2. There is no control. The screen is stuck.

WHY. WriteTagScreen.writeSections is now 'switch step' and renders EXACTLY ONE panel.
Button("Write") exists only in planSection and resultSection. zoneSection has none.
resetForNewWrite() is only ever called from write() (behind that button) and from
simulateWrite() (which is #if DEBUG). So once report == .sent and reportedId != nil the
step is .zone for ever and nothing can leave it.

WHY IT WAS NOT SEEN. mockSection is rendered OUTSIDE the switch, so in a DEBUG build the
Simulate buttons are visible in every step and do call resetForNewWrite(). On a simulator
the two-card walk therefore appears to work. Release builds have no such affordance.
checks/write-tag-step-check.swift calls Screen.startWrite() from the .zone state, i.e. it
asserts a transition the view has no control to trigger - green check, broken UI.

BEFORE (origin/main) the plan section and the status+Write section were unconditional, so
the Write button was always on screen and card 2 was one tap away.

RECOVERY TODAY: pop the NavigationLink and re-enter Write a tag (fresh @State). Two taps,
undiscoverable, undocumented on screen.

FIX. Give the zone step a way forward. Smallest version: a 'Write another card' button in
zoneSection that calls resetForNewWrite(). It must be a localised string in
Localizable.xcstrings with BOTH de and en entries in the same commit (project i18n rule).
Do NOT reintroduce the additive panels - the one-panel-per-step property is correct and
the false self-collision fix (WriteGuard.replacedForReport) is correct.

ACCEPTANCE.
1. checks/write-tag-step-check.swift keeps passing.
2. A NEW assertion proves every step reachable in a Release build has an exit: the .zone
   panel must contain a control that resets. A source-text check in the style of
   sms-gate-check.swift is enough - assert Button("Write another card") (or whatever the
   key is) appears inside the zoneSection body.
3. Walked on a simulator with the DEBUG mock section REMOVED or ignored: card 1 written and
   zoned, then card 2 written without leaving the screen.
4. xcodebuild archive still succeeds; entitlements and project.pbxproj untouched.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zoneSection offers a control that starts the next card without leaving the screen
- [ ] #2 a runnable check fails if any step reachable in Release has no exit control
- [ ] #3 the new string exists in Localizable.xcstrings in both de and en
- [ ] #4 two cards written in one uninterrupted screen session, verified on a simulator without relying on the DEBUG mock buttons
<!-- AC:END -->
