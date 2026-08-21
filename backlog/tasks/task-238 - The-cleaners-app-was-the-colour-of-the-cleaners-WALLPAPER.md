---
id: TASK-238
title: The cleaner's app was the colour of the cleaner's WALLPAPER
status: Done
assignee: []
created_date: '2026-08-21 12:20'
updated_date: '2026-08-21 13:01'
labels:
  - android
  - design
  - verdict
dependencies: []
priority: high
ordinal: 156000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ui/Theme.kt called dynamicLightColorScheme(context) / dynamicDarkColorScheme(context) on
API 31+, i.e. Material You. The app inherited the palette Android generates from the user's
own wallpaper.

MEASURED, on a device, with the SAME APK:
    system palette magenta -> dominant surface #FFF8F8
    system palette green   -> dominant surface #F4FCEB
The clocked-in screen rendered bright pink. Every worker got a different product, and the
one the director opens in front of a client is whatever is on that phone that morning.

docs/brand/DESIGN.md section 7 names this exact failure in as many words -- 'Android takes
the same values into ui/Theme.kt ... two hand-maintained lists will drift, and the drift will
show up as an app that does not look like its own admin' -- and section 1 measured the
company's mark as ACHROMATIC, saturation exactly zero across every significant colour.

WHY IT SURVIVED SO LONG: nobody had LOOKED. LOOK.md and LOOK-PHONE.md are both about the
ADMIN PANEL, at 1680 and at 390. This is the only screen the person doing the work sees.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The app renders identically under two different system palettes
- [x] #2 The dominant surface is achromatic (channel spread <= 12), per DESIGN.md section 1
- [x] #3 Every colour in the app is still a Material role; only Theme.kt knows a hex
- [x] #4 The check's negative case is a real build, not a grep
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
REOPENED by the verdict pass 2026-08-21. The Material You half was right and stays fixed. The other half was not: lightColorScheme()/darkColorScheme() assign only what they are handed, and 24 roles were handed over while the three the CLOCKED-IN SCREEN is painted with were not — tertiaryContainer, onTertiaryContainer, surfaceContainerHighest. They fell through to Material 3's BASELINE, which is a purple family.

MEASURED on the shipped 0.5.2/9, on that screen, from a screenshot demo/prove-offline-push.mjs had taken an hour earlier and nobody opened:
    #FFD8E4  47.9%  channel spread 39   baseline tertiaryContainer
    #E6E0E9  40.9%  channel spread  9   baseline surfaceContainerHighest
    #31111D   0.7%  channel spread 32   baseline onTertiaryContainer
88.8% of the one screen the person doing the work looks at all day. AC#2 read Done over it.

WHY THE CHECK STAYED GREEN, which matters more than the pixel: demo/check-app-not-wallpaper.mjs renders with 'am force-stop' + 'am start -n <activity>' and NO tap intent, so it lands on the IDLE screen (dominant #FAFAFA, genuinely the brand's) and has never once rendered the running one — the screen its own finding was written about. It asks whether the app follows the WALLPAPER. It answers that correctly. It is not the question AC#2 was closed on.

FIXED in 60cbcd2, shipped as 0.5.3 / versionCode 10 in 8af600b:
  - every role assigned in BOTH schemes; elevation reads the same way in both themes
    (dark #131519 field / #1B1E23 card, light #F0F1F3 field / #FFFFFF card); surfaceTint is
    the surface itself so Material's tonal overlay cannot leak the accent back in
  - checks/core-check.kt § 17 — THE CLASS: every colorScheme role used anywhere in app/src
    must be assigned in BOTH schemes, the two schemes must agree, and every non-accent hex
    is achromatic (surfaces <= 8, text <= 16). RED two ways: drop tertiaryContainer from one
    scheme -> role sets disagree; from both -> 'Missing: [tertiaryContainer]'.
  - demo/check-shift-screen-brand.mjs — THE INSTANCE, on a device: radio off, tap,
    photograph the RUNNING screen, every area >= 2% must be achromatic. Nothing reaches
    production. RED against 0.5.2/9 (#FFD8E4, 47.9%, spread 39), GREEN against 0.5.3/10
    light (#F0F1F3 54.8% / #FFFFFF 41.0%, worst spread 6) and dark (#131519 / #1B1E23,
    worst spread 8).
  - no regression in the thing that costs a wage: demo/prove-offline-push.mjs re-run end to
    end on 0.5.3/10 — OK, 69 ok, 5 RED, 0 FAIL.
  - published and verified live: /app/version -> 0.5.3 / 10, sha256 0e09020d…433321, byte
    for byte with android/dist. Signer unchanged, so App Links still verify.

MEASURED ON AN EMULATOR (sdk_gphone64_arm64, API 36), not a phone. Colour rendering is not
hardware-dependent the way NFC is, but no physical handset has seen 0.5.3.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Commit 1e396d1. Shipped in 0.5.2 (9), published, offline push re-proven on the new build.
<!-- SECTION:FINAL_SUMMARY:END -->
