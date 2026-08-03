---
id: TASK-29
title: Obtain all required API keys and secrets
status: To Do
assignee: []
created_date: '2026-07-28 14:03'
updated_date: '2026-07-28 14:25'
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
- [ ] #1 All external API keys identified and obtained
- [ ] #2 Keys stored in psst vault or .env.local
- [ ] #3 .env.example with placeholders checked into repo
- [ ] #4 Vercel project created and linked
- [ ] #5 Google Cloud project with Maps API enabled (or Mapbox equivalent)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PROGRESS:

DONE - Google Maps Platform:
- GCP project 'nfc-timesheets' created, billing account linked
- APIs enabled: maps-backend (Maps JS), street-view-image-backend, static-maps-backend, geocoding-backend
- 2 restricted keys created, stored in psst vault: NEXT_PUBLIC_GOOGLE_MAPS_KEY (browser, referrer-locked), GOOGLE_GEOCODING_KEY (server, API-locked)
- Verified working against live Street View metadata endpoint

DONE - Auth sessions (gstack browse, cookies imported from Chrome):
- Vercel: authed as <owner-email-redacted>, team qwadratics-projects
- GitHub: authed
- Google Cloud: authed (gcloud CLI also authed as same account)

CLI TOOLING (all pre-installed, prefer over browser automation):
- gcloud 562.0.0 - authed
- vercel CLI - NOT logged in yet, run 'vercel login'
- supabase CLI - authed, zero projects

REMAINING:
- vercel login (CLI token) - needed for TASK-14 deploy
- Supabase account/project - BLOCKED pending TASK-28 verdict, do not create until decision-12 resolved
- APNs keys - out of scope for 3A (TASK-26 documents prerequisites only)

SECURITY: never commit key values. psst vault at .psst/envs/ is gitignored. Pre-commit hooks (psst scan --staged + gitleaks) should be installed via secure-repo-init.sh before first commit.
<!-- SECTION:NOTES:END -->
