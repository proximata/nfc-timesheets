---
id: TASK-188
title: Move iOS onto the permanent tag host (decision-40)
status: To Do
assignee: []
created_date: '2026-08-19 11:39'
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
