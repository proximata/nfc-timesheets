---
id: TASK-364
title: Repair PR 7 Android and SMS verification gates
status: Done
assignee:
  - '@codex'
created_date: '2026-09-23 20:16'
updated_date: '2026-09-23 20:28'
labels: []
dependencies: []
priority: high
ordinal: 283000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Clean GitHub runners fail downloading the Android test JSON dependency and seeding the SMS fixture after company isolation. Route contract checks also assume obsolete source text.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Android checks pass with a freshly downloaded pinned dependency
- [x] #2 SMS tests pass under tenant isolation and restricted API database role
- [x] #3 PR 7 verification jobs pass on the updated commit
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Fix pinned test dependency and route assertions; migrate SMS fixtures to company-scoped setup; run local full suites; independent review; push fork and verify CI.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fresh canonical Maven download matches SHA-256 of the existing pinned 20250107 artifact; retained version and added checksum verification. All six locally adapted JVM groups pass, shell manifest/no-shift/reader gates pass, debug APK builds, and check-api passes with real local Postgres. SMS now seeds tenant context and runs API under restricted role. Local full SMS is blocked by missing psql; unchanged Linux migration runner will be exercised in CI.

GitHub PR Verify run 35915568205 at 047096a: android, server, ios and web all SUCCESS. Android ran all ten gates and assembleDebug on a clean Linux runner; SMS ran full migrations and all carrier-stub scenarios without bypassing RLS. Independent review read all 65 decisions and passed; branding all OK. No production deployment or merge.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed canonical Maven download with SHA-256 verification, company-aware SMS fixtures under restricted API role, robust bootstrap route assertions and Windows path normalization. All four PR CI jobs passed: https://github.com/proximata/nfc-timesheets/actions/runs/35915568205. Existing library version retained; production code and security constraints unchanged.
<!-- SECTION:FINAL_SUMMARY:END -->
