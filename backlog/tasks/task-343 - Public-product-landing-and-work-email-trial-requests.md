---
id: TASK-343
title: Public product landing and work-email trial requests
status: Done
assignee: []
created_date: '2026-09-23 15:43'
updated_date: '2026-09-23 16:15'
labels: []
dependencies: []
ordinal: 260000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Responsive bilingual landing with vector NFC-to-dashboard story; EUR300/month up to10 workers, first month free, negotiated additional workers. Persist work-email requests for platform review without automatic access or email.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Responsive DE/EN landing with reduced-motion animation and working request form
- [x] #2 Requests persist, duplicates are safe, and only platform staff can read them
- [x] #3 Browser verification and pnpm verify results recorded
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Implement public /product/ route and platform inbox with plain Node/Postgres API. Preserve current authenticated root routing and hosting. Verify real form submission, errors and access isolation.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented public bilingual /product/ with CSS/SVG NFC story, owner-specified pricing and real work-email requests visible only in platform inbox. Verified desktop/mobile browser layout, DE/EN, required/invalid fields, submitted synthetic request in PostgreSQL and platform inbox, and tenant denial. API integration, typecheck, lint and static build pass. pnpm verify was run and reports four pre-existing Windows path assertions; no path rewriting. Branding passes. No deployment or automatic emails.
<!-- SECTION:FINAL_SUMMARY:END -->
