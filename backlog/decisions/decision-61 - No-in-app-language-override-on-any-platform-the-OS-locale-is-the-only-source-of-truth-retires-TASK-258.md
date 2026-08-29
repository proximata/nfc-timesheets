---
id: decision-61
title: >-
  No in-app language override on any platform - the OS locale is the only source
  of truth, retires TASK-258
date: '2026-08-29 18:43'
status: accepted
---
## Context

Android shipped an in-app language switcher (TASK-258, `AppLocale.kt`) letting a worker
override German/English independent of the phone's OS language, referencing decision-8/17
for its German-default rationale. iOS never had an equivalent - every iOS string picks its
locale straight from the OS via `String(localized:)`/`Localizable.xcstrings`, with no override
UI at all. The 2026-08-29 cross-platform UX audit flagged this exact asymmetry as one of the
starkest differences between the two platforms' sign-in screens. Given the choice of "add one
to iOS" vs "remove it from Android", the owner ruled: use the system language on both
platforms - no in-app switcher anywhere.

## Decision

1. Android's `AppLocale.kt`, its SharedPreferences-backed override, and the language-chip UI
   in `TimeSheetApp.kt` are deleted. Every `AppLocale.wrap(...)` call site (all four NFC
   Activities' `attachBaseContext`, `ShiftSignals.strings()`) is removed; those contexts use
   the OS-supplied `Resources` unmodified, exactly like iOS already does everywhere.
2. decision-8 is UNCHANGED - German remains the default language (the phone's OS is presumed
   to default to German for this Austrian crew), and the i18n infrastructure plus full de/en
   translation stay exactly as they are. This decision only removes the manual PER-APP
   override capability; it does not touch which language shows up when the OS is German,
   English, or anything else (Android's existing resource-fallback behavior and iOS's
   `sourceLanguage: en` fallback for an unsupported OS locale are both unchanged).
3. TASK-258 is retired - its shipped feature is being removed at the owner's explicit
   direction, not because it was broken.

## Consequences

- A worker whose phone's OS language differs from what they'd prefer must change it in the
  OS Settings app, same as any other unlocalized app - a real reduction in flexibility,
  accepted deliberately in exchange for removing the biggest visible platform asymmetry the
  audit found and the one Android-only settings row it called out.
- `Settings > Sprache` disappears from Android's Settings screen entirely; nothing replaces
  it.

