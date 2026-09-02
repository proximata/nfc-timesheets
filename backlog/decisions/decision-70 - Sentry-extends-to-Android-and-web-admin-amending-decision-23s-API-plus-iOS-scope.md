---
id: decision-70
title: >-
  Sentry extends to Android and web admin, amending decision-23's API-plus-iOS
  scope
date: '2026-08-30 07:03'
status: accepted
---
**ACCEPTED 2026-08-30 by the owner**, who signed in to Sentry themselves and asked for
cross-app, cross-device telemetry with verbose logging for the pilot.

## Context

decision-23 added Sentry to the API and iOS only, and android/gradle/libs.versions.toml's
own header names the omission deliberately: "Sentry — telemetry is scoped to API + iOS
(decision-23). A third SDK is a decision." web/ has never had Sentry either. Both gaps are
now real operational blind spots: an admin-panel crash or an Android-only tap failure
produces the same "zero server-side evidence" defect decision-23 exists to fix, just on a
different surface.

Four separate Sentry projects were created under the existing `qwadratic` Sentry org (one
per platform: `nfc-timesheets-server`, `nfc-timesheets-android`, `nfc-timesheets-ios`,
`nfc-timesheets-web`) rather than one shared project, matching Sentry's own per-platform
grouping convention — a Kotlin stack trace and a Next.js one are never the same issue.

## Decision

**Android and web admin get the same three rules decision-23 already established for the
API and iOS, verbatim:**

1. **Fail soft, no exceptions.** An absent DSN means the SDK never initialises — not
   "initialised disabled". No crash-loop risk, no behaviour change, ships before any
   Sentry project exists (true here only in the historical sense: both projects already
   exist, but the code must not assume that).
2. **One file is the PII boundary.** `android/core/Scrub.kt` and `web/lib/scrub.ts` mirror
   `server/lib/scrub.js` and iOS's `Scrub.swift` — same denylist, same shape, so a value
   sensitive enough to redact on one platform is redacted on all four. Every event passes
   through the mirrored `beforeSend`/`beforeSendTransaction`/`beforeBreadcrumb` hooks
   before it leaves the process.
3. **DSNs are WRITE-ONLY endpoints, committed with eyes open — not "not secrets".**
   A DSN cannot read anything out of Sentry; the readable credential is the auth token,
   which is never committed. So the exposure is not data loss, it is **quota abuse**:
   anyone holding it can post junk events until the free tier is exhausted, which blinds
   exactly the telemetry this decision adds.

   `ts.sentryDsnAndroid` and the iOS `Info.plist` key are committed anyway, and
   `proximata/nfc-timesheets` is a **PUBLIC** repo. That is a deliberate trade, not an
   oversight: both values ship inside the distributed APK/IPA regardless, so committing
   them lowers the attacker's cost from "unpack a binary" to "read a file" rather than
   creating the exposure. Accepted while pre-production, where a DSN can be rotated
   freely (Sentry → project → Settings → Client Keys → new key, revoke old; then update
   the one line here and ship a build). **Revisit before real payroll data is live** — at
   that point the cheap fix is the one web already uses: inject at build time from a CI
   secret and keep the checked-in value blank.

   Web is already injected rather than committed (`NEXT_PUBLIC_SENTRY_DSN`, from the
   `WEB_SENTRY_DSN` repo secret), because a static export has a build step to inject at.

   **This is NOT the same trust tier as `ts.appKey`.** That key is a real shared secret
   sent as `X-App-Key`; its presence in this same public file is a pre-existing exposure
   this decision neither creates nor blesses.

**Logging is verbose for the pilot, not sampled down.** Android and web both enable the
SDK's structured-logs feature (parity with the server's `enableLogs: true`); tracing
samples every auth/shift-shaped transaction at 1.0 on all three client platforms it
applies to, matching decision-23's existing server-side `tracesSampler`.

**web/'s Sentry adds a new npm dependency** (`@sentry/nextjs`) — this project has never
locked web's dependency list the way decision-23 locks the server's (`pg` + `@sentry/node`
only); only the server carries that budget. Pinned exact per decision-9, `save-exact=true`
unaffected.

**Android's Scrub.kt is written but NOT given the same mutation-tested check rigor as
`checks/scrub-check.swift`/the server's scrub tests in this pass.** Named as a real gap,
not hidden: `core-check.kt` gains a small smoke check (known-sensitive keys, known-safe
keys, a redacted value, a stripped query string) run on every `checks/run.sh`, not a
mutation-tested suite. Upgrade path if Android telemetry ever carries a field the other
two platforms don't: a `checks/scrub-check.kt` mirroring the existing mutation-test shape.

## Consequences

- `android/gradle/libs.versions.toml`'s "deliberately ABSENT" comment for Sentry is
  corrected to point here instead of forbidding it.
- Four Sentry projects, one org, one team (`dev`) hold this app's entire telemetry
  surface; DSNs are recorded in psst (`SENTRY_DSN_SERVER`/`_ANDROID`/`_IOS`/`_WEB`) as the
  operator's own reference copy, not because they are secret.
- iOS's own Sentry activation is unaffected by this record: the Swift Package still has to
  be added in Xcode by the owner (decision-49's owner-only surface), so `SentryDSN` in
  Info.plist can be set now and will sit inert until that one click happens.
- Revisit trigger: if Sentry's free-tier event quota is exhausted by the verbose pilot
  sampling, the `tracesSampler`/`inheritOrSampleWith` catch-all rate is the first knob to
  turn down, not the auth/shift-path rate the whole feature exists to keep at 1.0.
