---
id: TASK-290
title: 'iOS: Stop button next to the running clock + manual clock-in from idle screen'
status: Done
assignee: []
created_date: '2026-08-27 09:42'
updated_date: '2026-08-27 11:14'
labels:
  - ios
  - decision-56
dependencies:
  - TASK-287
priority: high
ordinal: 208000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 idle screen (no shift running) has a clearly secondary 'start without a tag' action opening a building picker built from the already-cached roster; confirmation required before it calls POST /shifts/open with manual=true
- [x] #2 ShiftScreen has a Stop button next to the ticking clock; confirmation dialog names the building and says this is flagged for office review; calls POST /shifts/close with manual=true, no location
- [x] #3 server 422/409 responses on the manual-open path are shown with the SAME copy the tap path already uses, not a new generic error
- [x] #4 ShiftScreen.swift's 'there is no in-app button and there must not be one' comment is updated to point at decision-56 rather than deleted, explaining why the two new paths are safe (flagged, not silent)
- [x] #5 a debug-only mock/simulation mechanism (mirroring OperatorMockFlows.swift's pattern) covers both new flows with zero mock symbols surviving a Release build
- [x] #6 checks/run.sh passes clean, Localizable.xcstrings gets the new keys in both languages, localisation-check.swift passes
- [x] #7 git diff on NFCTimeSheets.entitlements, project.pbxproj, IPHONEOS_DEPLOYMENT_TARGET is EMPTY - confirm and quote it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-291 gate 2026-08-27. All seven ACs re-verified independently, and TWO things nobody in this workflow had done were done here:
  * xcodebuild Debug AND Release for the iOS 26.5 simulator: ** BUILD SUCCEEDED ** both, 0 errors, 0 warnings. Until now no run had compiled a line of this Swift. ShiftMockFlows.swift needs no project.pbxproj entry because the project uses PBXFileSystemSynchronizedRootGroup.
  * AC5 proven against the BINARY, not the source: strings(Release NFCTimeSheets) -> TSShiftMockFlowArmed 0, 'Mock: the server accepts a manual start' 0, 'Mock: the server accepts a manual stop' 0, ShiftMocks 0; control needle 'Start without a tag' 1.
AC7 quoted: git diff --stat 5135560..HEAD -- NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements NFCTimeSheets/NFCTimeSheets.xcodeproj/project.pbxproj -> EMPTY, and git diff --name-only 5135560..HEAD | grep -icE 'entitle|pbxproj|xcodeproj' -> 0. decision-49 held.
AC3 wire shapes proven twice: checks/tag-link-check.swift still pins the OLD tap bodies verbatim, and a standalone swift encode confirms JSONEncoder omits the nil Optional.

DONE, WITH ONE GAP THIS TASK SHIPPED AND ITS ACs COULD NOT SEE - TASK-298.
ContentView.swift:631 pill('Manual', .blue) goes through pill(_ t: String) -> Text(t), the VERBATIM initializer, so it renders English on a German phone. AC6 is literally satisfied (the catalogue got 'Manual' => 'Manuell' in both languages and localisation-check passes) but the call site cannot reach that entry: the compiled de.lproj proves it, because the three sibling pills at :632-634 have no catalogue entry AT ALL, never having been extracted. The added entry is dead weight. localisation-check.swift's own header admits it cannot catch this class of defect. Fix covers all four pills at once - see TASK-298.
<!-- SECTION:NOTES:END -->
