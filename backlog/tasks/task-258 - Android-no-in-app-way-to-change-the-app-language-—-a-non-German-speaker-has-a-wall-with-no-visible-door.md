---
id: TASK-258
title: >-
  Android: no in-app way to change the app language — a non-German speaker has a
  wall with no visible door
status: Done
assignee: []
created_date: '2026-08-24 19:06'
updated_date: '2026-08-27 07:32'
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
- [x] #1 Einstellungen carries a visible language control that names the available languages
- [x] #2 Switching to English changes the app copy without signing the worker out and without touching a running shift
- [x] #3 The control is reachable on the oldest Android version the app supports, or the row degrades into an explanation rather than disappearing silently
- [x] #4 android/checks/core-check.kt still passes: no tap is delayed, blocked or reordered
- [x] #5 de and en strings.xml both carry the new strings with exact key parity
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT 2026-08-27 (read-only, source re-grepped at HEAD 68743c6).
AC1: LanguageSection() defined ui/TimeSheetApp.kt:2077, called unconditionally at :1915 (Einstellungen) and :179 (SignInScreen). Names languages as text: settings_language_system/de/en -> 'Systemsprache' / 'Deutsch' / 'English' (values/strings.xml:268-271).
AC2: switch path TimeSheetApp.kt:2097-2099 = AppLocale.set(context, option) then (context as? Activity)?.recreate(). No sign-out call, no shift mutation in the composable; recreate() retains the ViewModelStore, same as a rotation.
AC3: mechanism is AppLocale.wrap via attachBaseContext (MainActivity.kt:32, ScanActivity.kt:70, WriteTagActivity.kt:161, VerifyZoneActivity.kt:289) - createConfigurationContext, API 17. app/build.gradle.kts:65 minSdk = 23, so it works on the oldest supported version; no ACTION_APP_LOCALE_SETTINGS/API-33 dependency, no degraded row needed.
AC4: android/checks/run.sh re-run this audit -> core-check: OK (plus known-tags/tag-writer/manifest/verify-no-shift all OK).
AC5: settings_language_{title,system,de,en} present in BOTH values/strings.xml:268-271 and values-en/strings.xml:183-186; whole-file counts 314 = 314.
Verdict: present in current source. Status stays Done. (Known follow-ups from the original comment remain out of scope here: ShiftSignals notification copy off applicationContext; TalkBack selection semantics were since added - TimeSheetApp.kt:2102-2110 selectableGroup + selected.)
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 20:13
---
VERIFIED independently at 6a104a3.

AC1 LanguageSection() is unconditional in SettingsScreen (TimeSheetApp.kt:1731, tab reachable at :526) and NAMES the languages as text - Systemsprache / Deutsch / English, no flags, no icon-only. Also on SignInScreen:189 so an operator-only phone can reach it.
AC2 switch = AppLocale.set(prefs) then Activity.recreate() - the same path as a rotation, so the ViewModelStore (session, running shift, sync queue) is retained, not destroyed. No sign-out call, no shift mutation anywhere in the composable.
AC3 mechanism is Context.createConfigurationContext + Configuration.setLocale/setLayoutDirection, all API 17; minSdk is 23, so it works on the OLDEST supported version with no degraded row needed and no API-33 ACTION_APP_LOCALE_SETTINGS dependency. No new Gradle dependency; androidx.appcompat rejected with a stated reason in AppLocale.kt kdoc (not a dep, auto-recreate needs AppCompatActivity + Theme.AppCompat, app has neither).
AC4 THE HARD GATE: git diff 5a71608..6a104a3 -- android/checks/ = 0 bytes, core-check.kt untouched. Ran android/checks/run.sh myself: core-check OK, known-tags-check OK, tag-writer-check OK, manifest-check OK, verify-no-shift-check OK. Tap path additionally untouched by construction - NfcTapActivity.kt has no attachBaseContext, no setContent and no R.string reference at all (headless trampoline), so the locale wrap sits nowhere near a clock-in.
AC5 4 new keys settings_language_{title,system,de,en} in BOTH values/ and values-en/; whole-file parity 259=259, comm empty both ways.
Persistence: SharedPreferences 'app-locale', read in attachBaseContext of MainActivity/ScanActivity/WriteTagActivity/VerifyZoneActivity - survives process death and restart, does not reset.

BUILD: :app:compileDebugKotlin --rerun-tasks BUILD SUCCESSFUL (2 pre-existing unrelated warnings), assembleDebug produced app-debug.apk.

TWO GAPS OUTSIDE THE AC TEXT, filed separately, neither blocking: (1) notify/ShiftSignals.kt builds notification copy off applicationContext, which is never wrapped - a worker on English still gets German reminders; (2) the three language buttons signal the current choice only visually (Button vs OutlinedButton), with no semantics selected / selectableGroup, so TalkBack cannot announce which is active.
---
<!-- COMMENTS:END -->
