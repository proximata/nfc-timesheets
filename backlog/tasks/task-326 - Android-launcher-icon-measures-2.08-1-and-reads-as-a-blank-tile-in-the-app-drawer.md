---
id: TASK-326
title: >-
  Android launcher icon measures 2.08:1 and reads as a blank tile in the app
  drawer
status: To Do
assignee: []
created_date: '2026-08-29 23:04'
labels:
  - android
  - ios
  - design
dependencies: []
priority: medium
ordinal: 244000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The real brand mark landed on the launcher (350651b) as a handshake crop on
ic_launcher_background #F0F1F3. The mark's own grey is ~#ADADAD, so the glyph against that
background measures 2.08:1 (rendered and sampled on an emulator, not estimated). Beside
Gmail/Chrome it does not read as a weak icon - it reads as an EMPTY tile.

This is faithful to how schimmer-wien.at renders the mark, which is why it needs an owner call and
not a silent fix. Two options, both one line:
  ic_launcher_background -> #FF16181C (DESIGN.md's dark-first neutral) => ~6:1
  or darken the foreground crop to the same neutral family and keep the light tile.

RELATED, same call: the iOS AppIcon is the FULL wordmark lockup at 3.64:1 while Android uses the
handshake only. Two platforms, two different marks, from the same source file. The supplied
fav-270.png is a wide lockup, so a square icon leaves vertical air - a hand-cropped
handshake-only master would fix both platforms at once.

MUST NOT REGRESS: DESIGN.md section 3.1 - the mark stays achromatic (measured channel spread <= 1
across 212 values today).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 launcher glyph reaches at least 4.5:1 against its own background, measured on a render not estimated
- [ ] #2 iOS and Android show the same crop of the mark, or the difference is written down with its reason
- [ ] #3 channel spread stays <= 12, DESIGN.md 3.1
<!-- AC:END -->
