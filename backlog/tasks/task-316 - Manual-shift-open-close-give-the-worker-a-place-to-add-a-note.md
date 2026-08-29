---
id: TASK-316
title: 'Manual shift open/close: give the worker a place to add a note'
status: To Do
assignee: []
created_date: '2026-08-29 19:54'
labels:
  - 'for agent: clarify with operator'
dependencies: []
priority: medium
ordinal: 234000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-56 added manual_start/manual_close (both BOOLEAN, audit-only, no text) to shifts, confirmed via server/db/migrations/014_manual_shift_entry.sql. There is currently NO note/reason column anywhere on the shifts table, and neither app UI has a text field for it. The request: when a worker manually opens or closes a shift (no tag), let them attach a short note, e.g. why - broken card, dead phone NFC, forgot to tap.

Open questions for the operator before this is designed: optional or required on every manual action, or only on manual close (Stop button) not manual open; free text or a short preset-reason picker; length limit and translation requirement (both apps default to German); shown to admin only (web shifts page) or also echoed back to the worker afterward; new shifts.note column (additive, like migration 014) or reuse an existing field.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Operator has answered: required vs optional, free text vs presets, per-action scope (open/close/both)
- [ ] #2 Schema/UI location decided and written down before any code is touched
<!-- AC:END -->
