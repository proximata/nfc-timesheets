---
id: TASK-253
title: 'Same app-version scheme on iOS and Android, shown in Settings on both'
status: Done
assignee: []
created_date: '2026-08-24 14:57'
updated_date: '2026-08-24 22:33'
labels:
  - ios
  - android
  - versioning
dependencies: []
priority: medium
ordinal: 171000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Right now the two apps use unrelated version schemes and neither displays its
version anywhere in the UI, which just cost real time diagnosing TASK-above (no way to tell
which build a phone is running without Xcode/Android Studio).

  Android: versionName (semver-ish, e.g. 0.5.5) + versionCode (monotonic int, e.g. 12),
           both in android/branding.properties -- agent-editable.
  iOS:     MARKETING_VERSION (e.g. 1.0, effectively never bumped) + CURRENT_PROJECT_VERSION
           (monotonic int per build, e.g. 4) -- both in project.pbxproj, the OWNER's file,
           an agent must never edit it (standing rule).

Scope, in order:
  1. pick ONE shared scheme both platforms read the same way (design call -- e.g. a single
     synced semver bumped together at every joint release, or a calendar version like
     2026.08.24 -- do not invent this silently, it is a real decision)
  2. Android: read it from android/branding.properties as today
  3. iOS: read MARKETING_VERSION/CURRENT_PROJECT_VERSION from Bundle.main.infoDictionary
     (no pbxproj edit needed to DISPLAY it -- only bumping it stays the owner's manual step)
  4. Settings tab on both apps gains a plain version line (e.g. 'v0.5.5 (12)'), visible
     without any dev tooling -- this is what would have made TASK-above a 30-second
     diagnosis instead of a log dive
  5. keep it in Settings, not a splash/about screen nobody opens
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
REAL INCIDENT since filing, same day: Galaxy S20 Ultra crashed on every launch (0.5.5-12,
an init-order NPE, fixed in 0.5.6-13). Self-update could not have rescued that phone even
if it HAD been offered - self-update is worker-initiated, reachable only from Settings
(update/UpdateManager.kt's own header), and a phone that crashes before first paint never
gets there. So a version label in Settings only helps ONCE an app already survives to
render Settings; the actual disaster-recovery path for a crash-on-launch build stays a
direct sideload (Desktop-APK-copy rule, project AGENTS.md), not self-update. Keep that as
a named limit when scoping this, not an argument against it -- most future bugs will not
be launch crashes.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 22:33
---
VERIFIED independently at d09e139 (all re-checked from source, builds re-run by verifier, not trusted from report).

HARD GATE (decision-49) — PASS: git diff --stat c0f5db8..d09e139 -- project.pbxproj NFCTimeSheets.entitlements = EMPTY. Neither file appears in the commit filelist (only ContentView.swift, Localizable.xcstrings, decision-52). Re-checked git status after running xcodebuild: still clean.

Scope 1 (pick ONE shared scheme, do not invent silently) — decision-52 'proposed', frontmatter shape matches decision-51 byte-for-byte (id/title>-/date/status), opens with the same 'PROPOSED. Not accepted.' line. Records the call: shared WORDING, NOT a shared version NUMBER, with both alternatives (synced semver, calendar version) rejected in writing. ⚠ CONSEQUENCE THE OWNER MUST ACCEPT OR REJECT: the two apps still show DIFFERENT numbers — Android 0.5.7 (14), iOS 1.0 (4) — and will keep drifting. Decision-52 makes the drift legible, not gone.

Scope 2 (Android reads branding.properties) — PASS, zero code changes needed, already shipped. TimeSheetApp.kt:2067 stringResource(R.string.update_current_version, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE) — real BuildConfig fields, no literal. Source: branding.properties ts.versionName=0.5.7 / ts.versionCode=14.

Scope 3 (iOS reads Bundle.main.infoDictionary) — PASS. ContentView.swift:834-838 CFBundleShortVersionString / CFBundleVersion, no hardcoded string. PROOF the fields are actually populated: built Debug-iphonesimulator/NFCTimeSheets.app/Info.plist reads 1.0 and 4 via PlistBuddy, so the line renders 'Installed: 1.0 (4)', not the '?' fallback.

Scope 4 (Settings line on both, no dev tooling) — PASS, unconditional on both. Android: SettingsScreen:1789 calls UpdateSection unconditionally; UpdateSection has no early return, version Text is its 2nd child before any state branch. iOS: new trailing Form Section in SettingsView, no condition.

Scope 5 (Settings, not a splash/about screen) — PASS, both lines are in the Settings tab only.

Same format both platforms — verified side by side:
  Android de 'Installiert: %1$s (%2$d)' / en 'Installed: %1$s (%2$d)'
  iOS     de 'Installiert: %@ (%@)'      / en 'Installed: %@ (%@)'
Identical wording; only placeholder syntax differs (platform mechanics).

i18n (decision-8) — PASS. Android key exists in BOTH values/strings.xml:263 and values-en/strings.xml:185. New iOS key 'Installed: %@ (%@)' has a REAL German unit, state 'translated', value 'Installiert: %@ (%@)'. Whole-catalogue audit: 0 keys missing 'de'. sourceLanguage=en so en is implicit, matching every neighbouring entry.

Builds — BOTH RE-RUN BY VERIFIER: xcodebuild Debug -destination 'generic/platform=iOS Simulator' -> ** BUILD SUCCEEDED **; gradlew :app:compileDebugKotlin -> BUILD SUCCESSFUL.

NOT verified, stated plainly: no Simulator/device install, so the rendered line was not seen on a screen. Evidence is source + built Info.plist contents. No APK cut, no deploy, no docs/media, no version bumped on either platform (none was asked for).
---
<!-- COMMENTS:END -->
