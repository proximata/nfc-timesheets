---
id: decision-62
title: >-
  An app update invalidates cached server reads on first launch, never the
  pending write queue - refetch beats reset
date: '2026-08-29 18:43'
status: accepted
---
## Context

The owner asked, in one line, to "delete local app data and refetch it from server" on first
run after an update, worried about stale cached data surviving a version bump - a real,
previously-hit bug class this session (Android's operator gate serving a stale cached
worklist past a server-side DB wipe; an equivalent stale-flag issue fixed on iOS as TASK-276).
Researched current mobile best practice before implementing the request literally: the
industry-standard pattern (general cache-invalidation literature, e.g. Retool/OutSystems/
NCache) is to invalidate cache by KEY/VERSION, not to wipe local storage wholesale on every
update - precisely because a full wipe destroys anything that is not simply re-derivable from
the server. This app has real un-synced local state that is NOT re-derivable: offline write
queues (a pending tag report or material request, made offline, not yet POSTed), and the
active worker/operator session cookie. Deleting those on an ordinary version bump would
silently drop already-completed work or force an unnecessary re-sign-in on every release - the
opposite of the "simple and frictionless" priority stated alongside this same request.

## Decision

1. Each platform stores the last app version it successfully booted as (`versionCode`/
   `CFBundleVersion` - the same value decision-52's version line already displays). On first
   launch after that value changes, the app invalidates and re-fetches exactly the CACHED
   READ surfaces - the roster/locations/zones snapshot (`GET /roster`), the cached operator
   worklist (`OperatorZoneCache`), and any cached shift-list pages - by clearing only those
   specific stores and re-hitting their existing fetch calls, the same calls pull-to-refresh
   already makes. Nothing new to build server-side.
2. Explicitly NEVER touched by this mechanism: the session cookie/token, any pending offline
   write queue (a pending tag report, a pending material request, an open shift's local
   mirror), and any SwiftData/Room SCHEMA migration - those keep using their platform's normal
   versioned-migration path (SwiftData automatic lightweight migration / Room `Migration`
   objects), never a blanket wipe.
3. If a future schema change is not lightweight-migratable, that is handled by a real,
   reviewed migration plan at that time - this decision does not pre-authorize a destructive
   fallback for that case.

## Consequences

- Closes the actual bug class the owner is worried about (a phone showing pre-update cached
  reads after a release) without the data-loss risk of wiping everything.
- A worker never has to sign in again just because the app updated - update friction stays at
  zero, matching "simple and frictionless".
- If a genuinely corrupt/unrecoverable local cache is ever found in the wild, a full local-
  data reset remains available later as a manual troubleshooting action - not built now, not
  required by this decision.

