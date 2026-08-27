---
id: TASK-295
title: 'Android: fun_shift_screen flag - forced black + procedural worker animation'
status: Done
assignee: []
created_date: '2026-08-27 10:39'
updated_date: '2026-08-27 16:09'
labels:
  - android
  - decision-57
dependencies:
  - TASK-292
  - TASK-289
priority: low
ordinal: 213000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 flag OFF (default): ShiftRunningScreen pixel-identical to before this task; demo/check-app-not-wallpaper.mjs and demo/check-shift-screen-brand.mjs pass unchanged
- [x] #2 flag ON: container forced to a true black background with legible light text, regardless of isSystemInDarkTheme()
- [x] #3 flag ON: a procedural Compose Canvas + rememberInfiniteTransition animation (simple moving silhouette shapes, no new asset/library dependency) plays behind the content, never obscuring the state words or the clock
- [x] #4 a new flag-ON assertion added to (or alongside) check-shift-screen-brand.mjs confirms the black is a FIXED black, not a Material-You-derived colour
- [x] #5 android/checks/run.sh passes clean with the flag off; DE/EN strings.xml parity holds if any new strings are added
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + committed d1283f3.

Evidence:
- gradlew compileDebugKotlin: clean (no output).
- android/checks/run.sh: core-check OK, known-tags OK, tag-writer OK, manifest OK, verify-no-shift OK, reader-armed OK. New core-check section 18 proven failable (sabotaged .isEmpty()->.isNotEmpty() => 'FAIL: an empty flag set is empty, not a crash', then restored).
- demo/check-fun-shift-black.mjs (new, AC4): OK, 10 assertions.
- demo/check-app-not-wallpaper.mjs on emulator-5554: OK.

--- AC1 CLOSED BY THE TASK-296 REVIEW GATE, 2026-08-27, ON A BUILD OF THIS COMMIT ---

The blocker was environmental and is now understood: demo/android-setup.sh maps only the
TAG host, but since decision-40 Api.kt calls BuildConfig.API_HOST (schimmer-glanz.exe.xyz),
so the emulator was talking to PRODUCTION and no locally minted enrolment code could ever
work. Filed as TASK-304. Worked around for this run by adding the API host to the emulator
hosts file and re-issuing the demo leaf cert with both SANs - no app source touched.

Then, on a debug APK built from HEAD (versionCode 23, i.e. WITH this commit) with a signed-in
worker, flag OFF (shared_prefs/flags.xml: fun_shift_screen value=false, delivered by the
server, not defaulted):

  demo/check-shift-screen-brand.mjs -> OK
    ok  an OFFLINE tap opened a shift on the phone, and on the phone only
    ok  ...and the running screen is what the a11y tree says is on screen
    #F0F1F3  65.6%  channel spread 3
    #FFFFFF  30.1%  channel spread 0
    #16181C   2.4%  channel spread 6
    ok  every area of the running screen is achromatic - worst is #16181C at spread 6,
        budget 12 (DESIGN.md section 1)

  demo/check-app-not-wallpaper.mjs -> OK on the same build, and the two-palette render hash
  is 19075b06e62d7316 - BYTE-IDENTICAL to the hash the same check produced on versionCode 20,
  the pre-decision-57 build that was installed before. Same pixels, magenta and green system
  palettes, before and after this commit.

FLAG ON, same device, flag flipped through the real route (PATCH /admin/flags/fun_shift_screen
-> phone re-fetched on its next roster pass -> flags.xml value=true), running screen sampled:
  #000000  58.2%  spread 0   <- FunShift.Black, the literal, dominant
  #FFFFFF  30.2%             <- the clock card
  #E9EAEC   1.3%             <- FunShift.OnBlack, the text
  #16181C   1.1%
  and in the figure's own region: #1A1D22 at 24.4% on #000000 - FunShift.Silhouette exactly,
  confirming the 1.2:1 'texture, never a signal' claim in Theme.kt on a real screen.
That is decision-57 section 3's 'the flag-ON screen is still non-wallpaper' asserted on a
DEVICE, not only as a source read. AC3 confirmed visually: 'Eingestempelt', the building
name, the clock and 'Laeuft' are fully legible; the figures sit in the bottom fifth of the
screen box, behind the content, clipped by the card - nothing is covered.

Emulator left as found: flag back OFF, shift rows deleted, job 225 cancelled, radio on.
<!-- SECTION:NOTES:END -->
