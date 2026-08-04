---
id: TASK-28
title: 'Research: Supabase + Edge Functions vs bare VM for API + DB'
status: Done
assignee: []
created_date: '2026-07-28 14:03'
updated_date: '2026-08-04 16:50'
labels:
  - research
  - infra
  - blocker
dependencies: []
priority: high
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evaluate whether Supabase (managed Postgres + Edge Functions) can replace the exe.dev VM for API hosting. Check: all API features feasible as Edge Functions, pg_cron for 8h shift timeout, AASA file serving, free tier limits for pilot, EU region availability, Cloudflare in front for reliability. Compare: Supabase+Vercel (zero ops) vs VM+PM2+Postgres (current plan). Include fallback path. BLOCKER: this decision gates TASK-1 through TASK-5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Written analysis comparing both architectures
- [x] #2 All 3A API features mapped to Supabase equivalent or gap identified
- [x] #3 pg_cron feasibility for shift auto-timeout confirmed or denied
- [x] #4 AASA serving solution identified for both architectures
- [x] #5 Free tier limits documented vs pilot requirements
- [x] #6 Decision-12 status updated to accepted or rejected
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE. This was the blocker gating TASK-1..TASK-5 and it was resolved.

AC1: `research/supabase-vs-vm.md`, plus research/decision-brief.md.
AC6: the verdict is decision-16 — "MVP stays fully server-side on the exe.dev VM; Supabase and
Cloudflare deferred". decision-12 is DEFERRED, explicitly not rejected, and decision-13 (the
free-tier zero-backup risk) is mooted by it.
AC3: pg_cron was assessed and DECLINED for self-hosted Postgres — it needs the extension, a
shared_preload_libraries change and a DB restart. What shipped instead is a systemd timer, which
survives an API crash and is running in production right now (TASK-11).
AC4: AASA is served by the same Node process; live and correct (TASK-4).
AC2/AC5: the free-tier limits and the feature mapping are in the document; the decision was
taken on operational grounds rather than limits.

The follow-through matters more than the paper: the constraint the research imposed — keep route
handlers thin and portable so a later move to Supabase stays cheap — is visibly honoured. The
server has exactly two runtime dependencies, `pg` and `@sentry/node` (server/package.json), a
plain node:http listener and a hand-written route table. No framework, no ORM, no router.
<!-- SECTION:NOTES:END -->
