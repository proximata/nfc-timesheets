---
id: TASK-14
title: Next.js project setup with pnpm + Biome
status: Done
assignee: []
created_date: '2026-07-28 13:49'
updated_date: '2026-08-04 16:48'
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
- [x] #1 pnpm dev starts on port 3000
- [x] #2 pnpm lint (Biome) passes with zero warnings
- [x] #3 biome.json configured for TS + React
- [x] #4 All versions in package.json are exact
- [x] #5 .npmrc with save-exact=true
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE, and DEPLOYED, which this task did not originally ask for.

AC4/AC5: web/.npmrc is `save-exact=true` + `engine-strict=true`; every version in
web/package.json is exact (next 16.1.7, react 19.1.9, next-intl 4.12.0, @biomejs/biome 2.4.16,
typescript 5.9.3 — no ^ or ~). decision-9 and decision-3 both hold.
AC3: web/biome.json. AC2: `pnpm lint` is part of `pnpm verify`, which ops/deploy.sh runs as a
GATE before any rsync (deploy.sh step 1/7). AC1: `pnpm dev --port 3000`.

Retarget honoured: static export served by the same Node process, NOT Vercel and NOT Cloudflare
(decision-16). Live: `curl https://timesheets.exe.xyz/` -> 200 text/html, and /login/, /payroll/,
/locations/ all 200.

The Google Maps key consequence noted in this task was NOT resolved and is now the open half of
TASK-16: ops/deploy.sh:44 passes only NEXT_PUBLIC_DEFAULT_LOCALE, so the production bundle
contains no key at all — I downloaded all 13 chunks of the live /locations/ page and there is no
`AIza…` string in 744 KB of JavaScript.
<!-- SECTION:NOTES:END -->
