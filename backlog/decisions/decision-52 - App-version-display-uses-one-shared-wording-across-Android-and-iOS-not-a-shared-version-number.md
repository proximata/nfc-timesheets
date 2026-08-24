---
id: decision-52
title: >-
  App version display uses one shared wording across Android and iOS, not a
  shared version number
date: '2026-08-24 22:29'
status: proposed
---
**PROPOSED. Not accepted. The owner accepts decisions.**

Relates to decision-8 (i18n parity, no hardcoded strings on either platform), decision-49
(iOS: never edit `project.pbxproj` or `NFCTimeSheets.entitlements`, not even to bump a
version — the owner's hand-edited files), decision-24 (`ops/branding.json`, unrelated to app
version numbers, not touched here).

## Context

Android's self-update UI (`UpdateSection` in `TimeSheetApp.kt`, unconditionally visible in
Settings) already renders "Installed: {version} ({build})" as a side effect of separate
self-update work — full de/en parity already in `strings.xml`. iOS's Settings screen had no
version display at all. TASK-253 asked for a version line visible on both platforms within
~30 seconds of opening Settings, without dev tooling.

## Decision

App version is shown in Settings on both platforms using ONE shared display wording, reusing
exactly what Android's self-update UI already renders — "Installed: {version} ({build})" (en)
/ "Installiert: {version} ({build})" (de) — where {version}/{build} are each platform's own
existing native fields (Android: `versionName`/`versionCode` from `branding.properties` via
`BuildConfig`; iOS: `CFBundleShortVersionString`/`CFBundleVersion` from `project.pbxproj`'s
`MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` via `Bundle.main.infoDictionary`).

This is a shared DISPLAY FORMAT, not a shared version NUMBER: no cross-platform
version-string synchronization is introduced, and none is implied by this decision. Android
needed zero code changes — the line already existed, unconditionally, in Settings →
UpdateSection. iOS gains one new trailing `Form` `Section` in `SettingsView` plus one manual
`Localizable.xcstrings` entry; `project.pbxproj` and `NFCTimeSheets.entitlements` are
untouched, per decision-49's standing rule that only the owner hand-edits those files.

**Rejected alternatives.** A synced-semver scheme (one literal version string shared across
both platforms) would force the owner into lockstep: every Android release — which happens
far more often, agent-driven — would obligate a manual `pbxproj` edit on iOS just to keep the
numbers matching, or the "shared" version immediately drifts and the scheme is a lie on day
one. That is not what the task asks for and it manufactures a coordination cost this project
has spent multiple decisions (24, 40, 49) deliberately keeping out of agent hands. Calendar
versioning (e.g. `2026.08.24`) was considered next and rejected for a sharper reason: it
doesn't touch the actual asymmetry at all. The bump step is still a manual `pbxproj` edit on
iOS regardless of what the number LOOKS like, while `CURRENT_PROJECT_VERSION` is already a
clean monotonic per-build integer — a calendar-shaped `MARKETING_VERSION` would just be a
second, redundant "when" field competing with it.

## Consequences

**Good.**

- A version line is now visible, in Settings, on both platforms, without dev tooling, in
  under 30 seconds — the acceptance bar TASK-253's incident notes set.
- Zero Android code changes; iOS reads native fields it already ships (`INFOPLIST_FILE`
  wiring already existed) — no build-setting change, only two files touched
  (`ContentView.swift`, `Localizable.xcstrings`).
- Byte-for-byte the same English/German wording on both screens; only the placeholder syntax
  differs (`%1$s`/`%2$d` vs `%@`/`%@`), a platform mechanical difference, not a wording one.

**Costs, accepted plainly.**

- **ACCEPTED CONSTRAINT, not solved here:** because bumping `MARKETING_VERSION`/
  `CURRENT_PROJECT_VERSION` requires a manual owner click in Xcode while Android's equivalent
  bump is a routine agent-editable `branding.properties` change, the two platforms' version
  numbers will keep drifting independently in cadence and in absolute value. This decision
  makes that drift LEGIBLE (both numbers are now visible, in the same wording, on both
  screens) rather than eliminating it, and eliminating it was explicitly out of scope.
- This display cannot rescue a crash-on-launch build — Settings never paints in that failure
  mode. Sideload via the Desktop-APK-copy path remains the disaster-recovery route for that
  failure mode, unchanged by this decision.

