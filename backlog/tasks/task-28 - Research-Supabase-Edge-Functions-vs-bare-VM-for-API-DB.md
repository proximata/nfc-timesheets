---
id: TASK-28
title: 'Research: Supabase + Edge Functions vs bare VM for API + DB'
status: To Do
assignee: []
created_date: '2026-07-28 14:03'
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
- [ ] #1 Written analysis comparing both architectures
- [ ] #2 All 3A API features mapped to Supabase equivalent or gap identified
- [ ] #3 pg_cron feasibility for shift auto-timeout confirmed or denied
- [ ] #4 AASA serving solution identified for both architectures
- [ ] #5 Free tier limits documented vs pilot requirements
- [ ] #6 Decision-12 status updated to accepted or rejected
<!-- AC:END -->
