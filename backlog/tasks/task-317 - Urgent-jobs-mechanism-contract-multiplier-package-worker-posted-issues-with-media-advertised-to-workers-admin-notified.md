---
id: TASK-317
title: >-
  Urgent-jobs mechanism: contract multiplier package, worker-posted issues with
  media, advertised to workers, admin notified
status: To Do
assignee: []
created_date: '2026-08-29 19:54'
labels:
  - 'for agent: clarify with operator'
dependencies: []
priority: medium
ordinal: 235000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
New feature, several parts, none exist today: (1) a contract may optionally include an urgent-work package billed at a given multiplier over the normal rate; (2) anyone can post an issue with attached media (photo/video) and a description; (3) that issue is advertised among workers; (4) the cleaning admin is notified.

Current state checked before filing: location_contracts (migration 003) has monthly_contract_cents + a plain note TEXT, no multiplier/urgent-package concept at all. material_requests (migration 003) is the closest existing shape - worker submits body text, admin decides status - but has no media attachment, no multiplier/billing tie-in, and no advertise-to-other-workers mechanism (it is a private worker-to-admin channel, not a board). There is zero file/media upload infrastructure anywhere in this codebase today (no multipart handling, no photo/video storage) - building this is a real new infra decision, not a small addition.

Open questions for the operator before this is designed: who can post an issue - any worker, only workers assigned to that location, or also the client portal; does posting require the location to have an urgent-work package on its contract, or is posting always allowed and only BILLING depends on the package; what happens when a worker "claims" an advertised issue - does it become a special shift type, a fixed fee, or hourly at the multiplier; how is "advertised among workers" delivered - push notification, an in-app list/board, both, and to which workers (all, or only ones near that location); does an issue need admin approval before it is advertised, or does it go out immediately; where is the multiplier configured - per-location, per-contract, or one global default; media storage requirements - size limits, retention period, who can view it later (this needs an explicit hosting/cost decision since no such infra exists).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Operator has answered who can post, approval-before-advertising, and how advertising is delivered
- [ ] #2 Billing model confirmed: how/where the multiplier is configured and how a claimed issue becomes payable hours
- [ ] #3 Media storage approach chosen (this app currently has zero upload infrastructure)
<!-- AC:END -->
