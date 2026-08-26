---
id: TASK-188
title: Move iOS onto the permanent tag host (decision-40)
status: In Progress
assignee: []
created_date: '2026-08-19 11:39'
updated_date: '2026-08-26 13:24'
labels:
  - ios
  - tag-host
  - decision-40
dependencies: []
ordinal: 106000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
iOS is still associated with the RENAMEABLE host schimmer-glanz.exe.xyz. Universal links work today only because the API host also serves both association files with identical bytes; the day that box is renamed, iOS taps die exactly the way the Android/HOIV card did.

MEASURED NOW (node ops/check-branding.mjs):
  TODO iOS is still associated with the RENAMEABLE host schimmer-glanz.exe.xyz, not the
       permanent tag host timesheets.exe.xyz.

THREE FILES, ALL HAND-EDITED, ALL MUST MOVE TOGETHER:
  NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements  applinks: literal (line ~16)
  NFCTimeSheets/Branding.xcconfig                         TS_TAG_HOST
  NFCTimeSheets/NFCTimeSheets/Branding.swift              defaultTagHost

The entitlement CANNOT be templated: an undefined Xcode build setting expands to the empty
string, so applinks:$(TS_TAG_HOST) with the xcconfig detached becomes 'applinks:' and kills
universal links on the next build, green and silent.

iOS ALSO NEEDS THE SPLIT, not just the move. Today Swift has one tagHost used for both
parsing and the API base (same coupling Android had in net/Api.kt). API.swift must reach
apiHost; TagLink.swift and the entitlement must use tagHost. Mirror the Android shape:
ops/branding.json already carries both.

ACCEPTANCE (all three):
  1. node ops/check-branding.mjs prints no TODO line and stays OK.
  2. codesign -d --entitlements - on a built .app shows applinks:timesheets.exe.xyz.
  3. A real iPhone taps the HOIV card
     (https://timesheets.exe.xyz/t?l=c3c37d4a-ca0a-42c5-b248-9704b9907ec7) and the app opens.
     Not provable in a simulator.

MUST NOT REGRESS: project.pbxproj is hand-edited by the owner and must not be touched by
tooling. Do not remove schimmer-glanz.exe.xyz from anything the SERVER serves - installed
copies hold their association until reinstall.

BLOCKED ON: an Xcode build, i.e. the owner's machine. Not a config edit.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PARTIALLY FIXED 2026-08-26. Both agent-editable files moved to the permanent tag host and the tagHost/apiHost split was actually implemented (this task called it out as needed: 'iOS ALSO NEEDS THE SPLIT, not just the move'):
- Branding.xcconfig TS_TAG_HOST -> timesheets.exe.xyz, and a NEW TS_API_HOST = schimmer-glanz.exe.xyz added
- Branding.swift defaultTagHost -> timesheets.exe.xyz; NEW apiHost/defaultApiHost properties added
- Info.plist: NEW TSApiHost key (mirrors the existing TSTagHost key)
- API.swift: base URL now built from Branding.apiHost, NEVER TagLink.host/Branding.tagHost. This closes a SEPARATE, previously-undocumented bug this task's fix would otherwise have activated: API.swift had ALWAYS derived its base from TagLink.host (the tag host), and it only ever worked because Branding.tagHost's wrong default happened to equal the real API host. Fixing defaultTagHost alone, without this, would have pointed every API call at the tag-only VM (which serves no API) and broken the app completely.
- tag-link-check.swift, ops/check-branding.mjs updated and passing; new check 'iOS talks to apiHost and claims tagHost' mirrors the existing Android one
- NFCTimeSheetsApp.swift / TagLink.swift doc comments updated to stop naming the wrong host as an example

STILL BLOCKED, exactly as this task predicted: the entitlements applinks: literal (owner-only, Xcode Signing & Capabilities click, re-provisions). ops/check-branding.mjs now prints a precise TODO naming only that one remaining file. AC1 (no TODO) therefore still fails by design until the owner's Xcode step; AC2/AC3 need that same step plus a real device. Full chain verified other than that: NFCTimeSheets/checks/run.sh all 10 green, xcodebuild Release build succeeds, entitlements/project.pbxproj byte-identical (git diff empty).
<!-- SECTION:NOTES:END -->
