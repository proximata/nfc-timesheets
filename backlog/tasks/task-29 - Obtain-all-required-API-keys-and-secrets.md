---
id: TASK-29
title: Obtain all required API keys and secrets
status: Done
assignee: []
created_date: '2026-07-28 14:03'
updated_date: '2026-08-04 16:51'
labels:
  - infra
  - secrets
  - blocker
dependencies: []
priority: high
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Audit all 3A tasks for external API dependencies. Use Chrome CDP to sign up and obtain keys where needed. Known requirements:
- Google Maps/Street View API key (TASK-16 map view, TASK-17 Street View photos) — Google Cloud Console
- Vercel account + project setup (decision-11 frontend deploy)
- Supabase account (if decision-12 accepted)
- Mapbox token (alternative to Google Maps, if chosen for TASK-16)
Store all keys in psst vault or .env.local (gitignored). Document in .env.example with placeholders.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All external API keys identified and obtained
- [x] #2 Keys stored in psst vault or .env.local
- [ ] #3 .env.example with placeholders checked into repo
- [ ] #4 Vercel project created and linked
- [x] #5 Google Cloud project with Maps API enabled (or Mapbox equivalent)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE for what this task asked (obtain + vault). NOT the same as installed.

AC1/AC2/AC5: GCP project `nfc-timesheets` with billing linked; Maps JS, Street View Static,
Static Maps and Geocoding enabled as APIs; two restricted keys created and stored in the psst
vault — NEXT_PUBLIC_GOOGLE_MAPS_KEY (browser, referrer-locked) and GOOGLE_GEOCODING_KEY (server,
API-locked). `.psst/envs/` is gitignored.
AC3: web/.env.example is checked in with placeholders.
AC4 stays unchecked and is OBSOLETE: decision-16 killed the Vercel deploy. Nothing deploys there,
so there is no Vercel project to link. The Vercel CLI is left authed; it costs nothing.

WHAT THIS TASK DID NOT COVER, AND WHICH IS THE REASON TWO SCREENS ARE HALF-DARK — the keys exist
in a vault and are NOT on the machine that needs them. /etc/nfc/env on the production VM
contains exactly three variables: APP_KEY, DATABASE_URL, PORT. Not GOOGLE_GEOCODING_KEY, not
SENTRY_DSN. And ops/deploy.sh never hands NEXT_PUBLIC_GOOGLE_MAPS_KEY to the web build.
Consequences are tracked where they bite: TASK-16 (blank map), TASK-17 (no photographs), and the
Sentry-in-production task.

Rotation still outstanding and NOT part of this task: state.md records that the legacy APP_KEY
value is burned. The current /etc/nfc/env APP_KEY was not compared against it — I did not print
the secret.
<!-- SECTION:NOTES:END -->
