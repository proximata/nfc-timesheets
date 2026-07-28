---
id: decision-11
title: Frontend static deploy on Vercel, VM only hosts API + DB
date: '2026-07-28 14:05'
status: superseded
---
## Context

Putting Next.js frontend on the same VM as the API means a bug or load spike on the server can take down the admin panel. Vercel provides free static/SSR hosting with CDN, automatic deploys, and zero-downtime.

## Decision

- Next.js web admin deployed to Vercel (static export or SSR on Vercel's edge)
- exe.dev VM hosts only the REST API server + Postgres database
- API base URL configured as environment variable in Vercel project
- CORS configured on API server to allow Vercel origin

## Consequences

- Frontend survives API outages (at least shows cached/static content)
- Vercel free tier sufficient for admin panel traffic
- Requires CORS setup on API
- API must be publicly accessible (already is via exe.dev HTTPS proxy)
- Supersedes the "everything on one VM" aspect of decision-1 (VM still used, just not for frontend)

## SUPERSEDED by decision-16 (2026-07-28)

Admin panel is static-exported and served from the exe.dev VM, not Vercel. Also avoids the
Vercel Hobby non-commercial ToS problem. Vercel remains a valid future option.
