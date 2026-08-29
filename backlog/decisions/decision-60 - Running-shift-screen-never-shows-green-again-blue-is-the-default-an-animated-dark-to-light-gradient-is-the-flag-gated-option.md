---
id: decision-60
title: >-
  Running-shift screen never shows green again - blue is the default, an
  animated dark-to-light gradient is the flag-gated option
date: '2026-08-29 18:43'
status: accepted
---
## Context

decision-57 gated a green->blue retint on iOS and a black background on Android behind
`fun_shift_screen`, deliberately freezing the default (flag off) as unchanged - iOS green,
Android achromatic - and explicitly required a superseding decision before touching the
default. The owner has now explicitly ruled, given both options offered: no green, ever, on
either platform; replace it with blue as the plain default, or - preferred - an animated
gradient/orbs effect cycling dark-to-light blue when going further.

## Decision

1. iOS `ShiftScreen.swift`'s tint is no longer conditional on `fun_shift_screen`. Regardless
   of the flag, the "in progress" tint is a fixed blue token (added to `Assets.xcassets` as a
   proper named color, not a raw `.blue` literal - matching the missing-brand-accent gap the
   2026-08-29 cross-platform UX audit flagged as B5). `.red` for overdue is UNCHANGED and
   remains the only color that ever means "attention needed" - this decision never touches it.
2. Android's running-shift screen moves off pure achromatic-black-only-when-flagged. Default
   (flag off): a fixed, hardcoded (never Material-You-dynamic) dark blue-tinted
   container/onContainer pair, replacing today's flag-off neutral scheme, applied the exact
   same way decision-57 §3 already forces black when flagged on - a literal color value,
   never derived from `isSystemInDarkTheme()`'s dynamic palette, so the wallpaper-bleed
   regression class stays impossible. The three existing regression checks
   (`demo/check-app-not-wallpaper.mjs`, `demo/check-shift-screen-brand.mjs`, `core-check.kt`
   §17) get updated to assert the NEW default is this fixed blue - not black, not dynamic -
   while keeping their non-negotiable rule: this screen's color is never derived from
   system/wallpaper-driven values.
3. `fun_shift_screen`, when ON, upgrades the plain blue fill to an animated effect: a slow,
   continuous gradient or drifting "orbs" cycling between a darker and a lighter blue, built
   with the same native-primitives-only constraint as decision-57 §3 (SwiftUI
   `Canvas`/`TimelineView`, Compose `Canvas` + `rememberInfiniteTransition` - no new
   asset/library dependency). This REPLACES decision-57's silhouette-figure animation as the
   flag's visual payload; the silhouette code may be kept as a secondary layer only if it does
   not compromise the legibility rule below - default to removing it if both together look
   cluttered, implementer's call.
4. The state word under the clock (DESIGN.md §3.4's rule, itself unaffected by either
   decision) remains the one thing color/animation is never allowed to be the only signal for
   - greyscale legibility stays a hard requirement, verified the same way decision-57 already
   verifies it.
5. decision-56's Stop button, its confirmation dialog, and the auto-closed/corrected marker
   colors are UNRELATED and untouched by this decision - only the ambient "shift is running"
   tint/background is in scope.

## Consequences

- decision-57 §3's freeze is superseded exactly as it anticipated (a superseding decision,
  not a fresh unreviewed guess) - the OFF-by-default posture for the FLAG itself is unchanged
  (`fun_shift_screen` still defaults false); only the two platforms' non-flagged baseline
  colors change.
- Green is retired from this codebase's shift-state vocabulary entirely - after this ships, no
  source file should tie `.green`/an Android green role to shift state.
- Android gains its first-ever non-achromatic default on this one screen; the three
  regression checks must be EDITED, not deleted, since the wallpaper-bleed risk they guard
  against is unrelated to which fixed color is chosen.

