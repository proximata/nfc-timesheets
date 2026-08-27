---
id: decision-57
title: >-
  Running-shift screen gets an opt-in playful theme (blue/black + procedural
  worker animation), gated by a feature-flag system with a scoped second admin
  account
date: '2026-08-27 10:38'
status: accepted
---
## Context

The owner asked for three things in one message: recolour the running-shift screen
(green->blue), give Android a black background, and add a "cool background animation of
workers doing work" - all behind a feature flag, plus a feature-flag system with its own
scoped admin account.

What is actually true on each platform today, checked in code before deciding anything:

- iOS `ShiftScreen.swift` hardcodes `let tint: Color = overdue ? .red : .green` - green IS
  literally there, a one-line change.
- Android's running-shift background is NOT green. `ui/Theme.kt` is achromatic by
  deliberate, heavily-documented, test-defended design: `docs/brand/DESIGN.md` measured the
  company mark as saturation-zero, a real incident shipped the phone's WALLPAPER colour
  onto this exact screen (bright pink), and the fix is pinned by THREE regression checks
  (`demo/check-app-not-wallpaper.mjs`, `demo/check-shift-screen-brand.mjs`,
  `core-check.kt` § 17 - every Material role must be assigned in both colour schemes).
  Dark mode is already near-black (`#0B0C0E`/`#131519`). The document's own thesis: "the
  accent is one thing per screen, not a half-screen wash" and the state must be legible in
  greyscale.

So an unconditional recolour+animation would directly reverse a decision Android already
fought to establish and tests against. A feature flag resolves this cleanly: OFF (the
default) is today's screen on both platforms, unchanged, and every existing check keeps
passing; ON is the playful variant. Nobody who does not opt in ever sees a wallpaper-style
regression return.

## Decision

1. **Feature flags, server-side, minimal.** One table, `feature_flags(name TEXT PRIMARY
   KEY, enabled BOOLEAN NOT NULL DEFAULT false, updated_at, updated_by)`. `GET /flags`
   (auth: worker) returns `{name: bool}` for all rows - the phone fetches it once at
   startup/roster-refresh and caches it, same idiom as the existing roster fetch. No
   percentage rollout, no per-user targeting, no client SDK - a name and a boolean is the
   whole feature for now. First (only) flag: `fun_shift_screen`.

2. **A scoped second admin account, via the smallest possible RBAC seed.** `admins` gains
   `role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','flags'))`. Every EXISTING
   admin route keeps requiring `role = 'admin'` exactly as today (a `flags`-role session is
   refused everywhere else - no payroll, no worker PII, no zones). Only the new `GET/PATCH
   /admin/flags` routes accept either role. One new admin row is inserted directly (same
   idiom already used this session for the test worker, since the vaulted ADMIN_PASSWORD
   was stale) with `role = 'flags'` and its own email+password, generated and stored in
   psst, never in chat or a screenshot.

3. **The flag's effect, gated behind `fun_shift_screen`, OFF by default:**
   - iOS: `tint` becomes `.blue` instead of `.green` (`.red` for overdue is unchanged - the
     one thing that must never mean "fine").
   - Android: the running-shift `container`/`onContainer` colours are forced to a true
     black background with light text, REGARDLESS of `isSystemInDarkTheme()`, only when the
     flag is on. `check-app-not-wallpaper.mjs` and `check-shift-screen-brand.mjs` run with
     the flag OFF (their existing, unchanged contract) plus a NEW assertion that the flag-ON
     screen is still non-wallpaper (a fixed black, not Material You's dynamic palette).
   - Both platforms: a small procedural animation (simple silhouette figures, a repeating
     sweep/mop motion) drawn with native primitives already in the dependency tree -
     SwiftUI `Canvas`/`TimelineView` on iOS, Compose `Canvas` + `rememberInfiniteTransition`
     on Android. No new asset pipeline, no Lottie/Rive/After-Effects dependency, no bundled
     image or video asset. CEILING: this looks like simple moving shapes, not illustrated
     characters - upgrade path is swapping in real Lottie/sprite assets later behind the
     SAME flag if the cheap version is not fun enough. The state words under the clock
     (DESIGN.md § 3.4's rule) are unaffected either way - the animation is decoration behind
     them, never the only signal.

4. **Admin UI**: one small Flags page (name + enabled toggle, no per-flag configuration
   screen), reachable by both admin roles.

## Consequences

- Every existing regression check (`check-app-not-wallpaper.mjs`,
  `check-shift-screen-brand.mjs`, `core-check.kt` § 17, iOS's own checks/run.sh) keeps
  passing unchanged with the flag OFF, because OFF is bit-for-bit today's behaviour.
- The `flags`-role account is real, scoped, blast-radius-limited access, not "a second full
  admin password" - it cannot read a worker's rate, a shift, or a client's revenue.
- This is the FIRST flag; the table/route shape is deliberately generic so a second flag
  later costs one row, not a schema change.
- Client work for this decision touches the SAME running-shift screens
  (`ShiftScreen.swift`, `TimeSheetApp.kt`'s `ShiftRunningScreen`) that decision-56's Stop
  button also touches - it is sequenced AFTER decision-56's mobile tasks land, not run
  concurrently with them, to avoid two workflow runs editing the same file at once.

