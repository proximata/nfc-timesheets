---
id: TASK-340
title: 'Company workspaces: isolate existing business data and sessions'
status: Done
assignee:
  - '@codex'
created_date: '2026-09-22 12:02'
updated_date: '2026-09-23 14:57'
labels:
  - server
  - tenancy
dependencies: []
ordinal: 257000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the approved doc-1 first prerequisite using the existing Postgres and Node API. Preserve legacy data, tags and mobile contracts. No production deployment.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every authenticated company request reads and changes only its own company records, including referenced IDs and mobile tag flows.
- [x] #2 Existing records and sessions migrate to the first company without rewriting tag URLs.
- [x] #3 A local two-company API and database test proves isolation and the existing API checks remain passing.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inventory domain tables, identity bootstrap and SQL entrypoints. 2. Add tenant migration, database policies and verified-session scope with fail-closed connections. 3. Scope bootstrap/public credentials and composite references. 4. Exercise two-company and legacy API regressions locally.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Migration, RLS runtime scope and legacy API regression implemented; check-api PASS under a restricted PostgreSQL role. Two-company fixture now exercises the real migration chain and pooled queries. Dedicated feature/decision review still pending.

Final 2026-09-23: check-api PASS; check-workspaces PASS using actual migration chain and restricted runtime role. Includes atomic identity replacement rollback and simultaneous operator tag reports. Independent earlier API matrix (59 checks) and Android worker/operator journeys passed; physical NFC/iOS not exercised. Branding OK without TODO lines. Final decision/code review pending.

Dedicated final ADR/code-quality review PASS: no blockers. Independent check-workspaces PASS; branding OK; diff check clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Isolated company records and sessions with FORCE RLS and composite references, preserved legacy IDs, added atomic owner invitations and scoped maintenance. Real legacy API suite and two-company regression suite PASS; identity conflicts preserve existing login and concurrent tag reports stay idempotent. No production migration or deployment.
<!-- SECTION:FINAL_SUMMARY:END -->
