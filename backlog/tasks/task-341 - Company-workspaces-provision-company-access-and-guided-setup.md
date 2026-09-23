---
id: TASK-341
title: 'Company workspaces: provision company access and guided setup'
status: Done
assignee:
  - '@codex'
created_date: '2026-09-22 12:02'
updated_date: '2026-09-23 15:00'
labels:
  - web
  - server
  - onboarding
dependencies:
  - TASK-340
ordinal: 258000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Approved doc-1: platform administration creates a company workspace and expiring owner invitation; the company owner completes a resumable setup using existing locations, workers and NFC verification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Only platform administrators can provision another company and issue owner access; invitation redemption is expiring and single use.
- [x] #2 Company settings, location and worker setup persist and the readiness checklist reflects actual saved records and verified tags.
- [x] #3 All new user-visible strings exist in German and English and browser journeys are verified.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add atomic expiring owner invitation and explicit platform provisioning. 2. Implement DE/EN platform page and resumable four-stage setup using shared CRUD/API validation. 3. Verify invite expiry/reuse, refresh/resume and two-company browser journeys.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Final real-browser verification 2026-09-23 PASS: platform provisioning, activation, mismatch/consumed/missing invite rejection, company/building/worker wizard, required address, rates 0/-1/abc rejected and 15,50 stored as 1550 cents, reload persistence, DE/EN. Independent DB readback: exactly one company owner/worker/building, no fabricated operators/zones/shifts. Evidence captures/company-workspaces/final-verification.md. Initial approval review block resolved after explicit user continuation. Final ADR review PASS.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered platform owner invitations and four-step company setup. Browser and real PostgreSQL readback confirm correct persistence, validation and honest unfinished NFC readiness. Both locales included. No production deployment.
<!-- SECTION:FINAL_SUMMARY:END -->
