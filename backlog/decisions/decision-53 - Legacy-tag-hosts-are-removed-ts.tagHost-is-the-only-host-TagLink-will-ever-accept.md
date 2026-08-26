---
id: decision-53
title: >-
  Legacy tag hosts are removed: ts.tagHost is the only host TagLink will ever
  accept
date: '2026-08-26 13:18'
status: accepted
---

**ACCEPTED 2026-08-26 by the owner**, in real time, in the same conversation that ordered it.

Amends decision-40. Decision-40's own accepted text established `ts.legacyTagHosts` as
permanent architecture ("legacy tag hosts are a parser-only widening with no passive-tap
support"). This record strikes that clause. Everything else in decision-40 — the tagHost /
apiHost split itself, the ban on apiHost ever appearing in an autoVerify intent-filter, the
full migration checklist — is untouched.

## Context

`android/branding.properties` carried `ts.legacyTagHosts=schimmer-glanz.exe.xyz`, accepted
by `TagLink`'s parser (never the manifest) so a card written during the window between the
July VM rename and decision-40's fix would still work for a manual operator scan, even
though it could never wake the app passively. The owner's own comment in
`branding.properties` said plainly: "a card may exist carrying it. It is not dead."

The owner ordered this removed anyway, in the same breath as ordering the iOS host bug
(TASK-188) fixed, on the reasoning that the product should carry exactly one tag host,
full stop, and that a second accepted host — however narrowly scoped to manual scan only —
is a standing source of exactly the kind of silent-drift bug this whole tagHost/apiHost
split exists to prevent.

## Decision

`TagLink` (Android and iOS both) accepts exactly one host: whatever `ts.tagHost` /
`Branding.tagHost` currently names. There is no widened set, no manual-scan fallback, no
parser-level tolerance for a card written under a host this build has stopped using.

Concretely, removed this session:

- `android/branding.properties`'s `ts.legacyTagHosts` key and its explanatory comment block
- `TagLink.kt`'s `legacyHosts` constructor parameter and `acceptedHosts` set — `TagLink` is
  now a one-host class on both platforms (iOS's `TagLink.swift` was already one-host; it
  never had a legacy allowance to begin with)
- `build.gradle.kts`'s `BuildConfig.LEGACY_TAG_HOSTS` field and the now-dead `brandList()`
  helper that only ever served it
- `TimeSheetsApplication.kt`'s `TagLink(BuildConfig.TAG_HOST, BuildConfig.LEGACY_TAG_HOSTS.toList())`
  → `TagLink(BuildConfig.TAG_HOST)`
- every legacy-host test case in `core-check.kt`, `tag-writer-check.kt` and
  `live-flow-check.kt` — one substitute is worth naming: the byte-comparison test that used
  to prove "parses to the right uuid is not the same guarantee as byte-identical" via a
  legacy-host card now proves the identical point via a trailing-slash card
  (`/t/?l=<uuid>` vs `/t?l=<uuid>`), a real accepted-but-different-bytes case that still
  exists without needing a second host at all

## Consequences

- **If a physical card anywhere carries a host other than the current `ts.tagHost`, it is
  now unreadable on every path** — passive tap AND the operator's manual Verify/Write
  scan — until it is physically rewritten at the location. There is no software recovery.
  This was true for passive tap already; it is now also true for manual scan, which is the
  actual behaviour change this record authorises.
- Changing `ts.tagHost` again in the future costs a site visit per affected building, with
  no parser-level grace period. `android/README.md` and `ops/REBRAND.md` say so at the
  point where a future rebrand would touch this value.
- The codebase is simpler for it: one host, one constructor argument, no "which set is this
  host in" question anywhere `TagLink` is used.
