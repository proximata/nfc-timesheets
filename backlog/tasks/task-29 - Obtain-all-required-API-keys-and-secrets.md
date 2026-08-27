---
id: TASK-29
title: Obtain all required API keys and secrets
status: Done
assignee: []
created_date: '2026-07-28 14:03'
updated_date: '2026-08-27 07:29'
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
- [x] #3 .env.example with placeholders checked into repo
- [ ] #4 Vercel project created and linked
- [x] #5 Google Cloud project with Maps API enabled (or Mapbox equivalent)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit 2026-08-27: AC3 confirmed - web/.env.example exists with placeholders. AC4 (Vercel project) is permanently moot, not a gap: decision-11 (Vercel) was explicitly superseded by decision-16 (self-hosted on the one exe.dev VM); the project never uses Vercel. Left unchecked deliberately, task stays Done - the moot AC does not block closure.
<!-- SECTION:NOTES:END -->
