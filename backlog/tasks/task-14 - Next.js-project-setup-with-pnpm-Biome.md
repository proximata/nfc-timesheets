---
id: TASK-14
title: Next.js project setup with pnpm + Biome
status: To Do
assignee: []
created_date: '2026-07-28 13:49'
updated_date: '2026-07-28 14:46'
labels:
  - web
  - setup
milestone: m-3
dependencies:
  - TASK-1
priority: high
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Init Next.js App Router in /web. pnpm, Biome (not ESLint+Prettier), TypeScript. Pin all dependency versions (exact, no ranges). .npmrc save-exact=true. Latest stable Next.js minus one minor. Dev server port 3000.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pnpm dev starts on port 3000
- [ ] #2 pnpm lint (Biome) passes with zero warnings
- [ ] #3 biome.json configured for TS + React
- [ ] #4 All versions in package.json are exact
- [ ] #5 .npmrc with save-exact=true
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RETARGET (decision-16): deploy to the exe.dev VM, NOT Vercel and NOT Cloudflare Pages.

Next.js static export (output: 'export'), built locally, rsynced to the VM, served by the
same Node process that serves the API and AASA. One box, one deploy.

Why not Vercel: Hobby tier forbids commercial use (research finding) and decision-16 keeps
everything server-side this iteration.

Stack per prior decisions - unchanged:
- pnpm (decision-3), Biome not ESLint+Prettier (decision-3)
- exact pinned versions, no ^ or ~ (decision-9)
- i18n infra in place from day one, English default, German prepared (decision-8)

CONSEQUENCE TO FIX HERE: the Google Maps browser key is currently referrer-restricted to
http://localhost:3000/* and https://*.vercel.app/*. Since nothing deploys to Vercel, add the
VM origin and drop the Vercel entry:
  gcloud alpha services api-keys update 4d0bf9ca-e6d1-43ec-9e52-c53972430659 \
    --project=nfc-timesheets \
    --allowed-referrers='http://localhost:3000/*','https://timesheets.exe.xyz/*'
Key value lives in psst as NEXT_PUBLIC_GOOGLE_MAPS_KEY (tagged browser,vercel - retag).

Vercel CLI is authed (qwadratic / qwadratics-projects) but goes unused for 3A. Leave it;
costs nothing and decision-11 may un-defer later.
<!-- SECTION:NOTES:END -->
