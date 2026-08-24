---
id: TASK-258
title: >-
  Android: no in-app way to change the app language — a non-German speaker has a
  wall with no visible door
status: To Do
assignee: []
created_date: '2026-08-24 19:06'
labels:
  - android
  - i18n
  - ux
  - worker
dependencies: []
priority: high
ordinal: 176000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: Android worker journey, step 'Opened Einstellungen and read the entire screen looking for a language control'. Driven live on the ts-demo emulator against a local demo stack, and confirmed by reading every composable in SettingsScreen / PushSection / UpdateSection / SignInScreen.

MEASURED: there is no language or locale control anywhere in the Android app. Not in Einstellungen, not on the sign-in screen, not behind a menu. There is no locale-switching code path in the app at all. Language is governed entirely by Android's OS-level per-app language setting, which the app never mentions, never links to, and never offers a shortcut into.

The app is German-per-string by default (decision-8, decision-17), with res/values-en/ present. So the English translation EXISTS and ships — a worker simply has no way to reach it from inside the app.

WHY IT MATTERS FOR UAT: this is a Vienna cleaning workforce that is plausibly not majority native-German-speaking (the demo roster itself reads Marta Nowak, Miroslav Novak). A worker handed a phone whose system language is set to something the app does not carry, or who simply cannot read German, is stuck reading an app they do not understand, with zero in-app path to fix it and no hint such a setting even exists. Every other friction in this product is a moment; this one is permanent and covers every screen.

FIX SHAPE, smallest first: Android 13+ exposes a per-app language picker through the system settings deep link (Settings.ACTION_APP_LOCALE_SETTINGS) and AndroidX AppCompatDelegate.setApplicationLocales for an in-app picker. Either is acceptable; what is NOT acceptable is the current state, where the setting is invisible. If the deep link is chosen, the Settings row must still NAME the languages available so a worker knows the option exists before tapping.

MUST NOT REGRESS: the tap path. A locale change must never sit in, delay or reorder a clock-in (android/checks/core-check.kt). Changing language must not sign the worker out or discard a running shift.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Einstellungen carries a visible language control that names the available languages
- [ ] #2 Switching to English changes the app copy without signing the worker out and without touching a running shift
- [ ] #3 The control is reachable on the oldest Android version the app supports, or the row degrades into an explanation rather than disappearing silently
- [ ] #4 android/checks/core-check.kt still passes: no tap is delayed, blocked or reordered
- [ ] #5 de and en strings.xml both carry the new strings with exact key parity
<!-- AC:END -->
