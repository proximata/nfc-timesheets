---
id: TASK-253
title: 'Same app-version scheme on iOS and Android, shown in Settings on both'
status: To Do
assignee: []
created_date: '2026-08-24 14:57'
updated_date: '2026-08-24 15:31'
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
