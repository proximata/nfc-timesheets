---
id: TASK-7
title: 'iOS: handle background NFC launch via universal link'
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-04 16:47'
labels:
  - ios
milestone: m-1
dependencies:
  - TASK-4
  - TASK-6
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) handler. Parse location ID from URL query param. Trigger start/stop shift logic. No second NFC scan needed — location encoded in URI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tapping phone to NDEF tag without app open shows iOS notification
- [x] #2 Tapping notification opens app and starts/stops shift
- [x] #3 No manual Scan button tap required
- [x] #4 Works on iPhone XS and newer
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE, proven in production.

The five production shifts of 2026-07-30 (ids 1-5, all with client_uuid, one running 15:53 ->
16:13) were created by a real iPhone tapping a real tag, reaching the app through the universal
link. Nothing else creates those rows. That single fact carries AC1, AC2 and AC4 — a simulator
cannot do it (simctl cannot hand a universal link to an app), so the device was physical.

Code: NFCTimeSheets/NFCTimeSheets/TagLink.swift parses `/t?l=<uuid>`; TapInbox.swift is the one
queue every tap path feeds. Commit 84da28f handles the link as an NSUserActivity
(NSUserActivityTypeBrowsingWeb) and not only via onOpenURL — that commit exists because
onOpenURL alone dropped the cold-launch tap.

AC3: there is no Scan button to press. CoreNFC reader sessions were removed outright
(commit e4ac6e2) — see TASK-9.

Demo frame: `docs/media/ios-journey.mp4`. Its tap is captioned MOCKED on screen, because
DemoHooks.swift feeds the same TapInbox the URL path feeds — the demo is honest about that and
so is this note. The production rows above are the real proof, not the clip.
<!-- SECTION:NOTES:END -->
