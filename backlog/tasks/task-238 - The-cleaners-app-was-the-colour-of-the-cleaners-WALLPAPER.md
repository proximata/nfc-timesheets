---
id: TASK-238
title: The cleaner's app was the colour of the cleaner's WALLPAPER
status: Done
assignee: []
created_date: '2026-08-21 12:20'
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
- [ ] #1 The app renders identically under two different system palettes
- [ ] #2 The dominant surface is achromatic (channel spread <= 12), per DESIGN.md section 1
- [ ] #3 Every colour in the app is still a Material role; only Theme.kt knows a hex
- [ ] #4 The check's negative case is a real build, not a grep
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
FIXED and SHIPPED as 0.5.2 / versionCode 9.

ui/Theme.kt now carries DESIGN.md sections 3.1-3.4 verbatim (surfaces, text, the oklch(0.82
0.16 190) / oklch(0.72 0.09 190) accent, the amber unresolved state), with every on-* contrast
pair computed in the file rather than eyeballed -- dark 15.3:1 / 7.4:1 / 12.6:1, light 16.6:1
/ 7.9:1 / 8.4:1.

demo/check-app-not-wallpaper.mjs does it ON A DEVICE, so its negative case is a real build:
    0.5.1 / 8   magenta -> #FFF8F8, green -> #F4FCEB    FAIL (2)
    0.5.2 / 9   magenta -> #FAFAFA, green -> #FAFAFA    OK, byte-identical renders

Published and verified live: ops/publish-apk.sh -> /app/version reports 0.5.2 / 9,
sha256 2e87deb9a2f514e8... byte for byte with android/dist/nfc-timesheets-0.5.2-9-release.apk.
Signer unchanged (6C:78:...:99:6C) so App Links still verify.

NO REGRESSION IN THE THING THAT COSTS A WAGE: demo/prove-offline-push.mjs re-run end to end
against production on 0.5.2/9 -- 69 ok, 5 RED observed in the same run, 0 FAIL, identical to
0.5.1/8's score.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Commit 1e396d1. Shipped in 0.5.2 (9), published, offline push re-proven on the new build.
<!-- SECTION:FINAL_SUMMARY:END -->
