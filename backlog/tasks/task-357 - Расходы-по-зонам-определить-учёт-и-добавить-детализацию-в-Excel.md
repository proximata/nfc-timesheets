---
id: TASK-357
title: 'Export as: выбор фильтров и разделов отчёта'
status: Done
assignee:
  - '@codex'
created_date: '2026-09-23 18:22'
updated_date: '2026-09-23 18:51'
labels:
  - reporting
  - zones
dependencies:
  - TASK-356
references:
  - >-
    backlog/decisions/decision-43 -
    Zones-carry-an-area-the-buildings-area-is-derived-an-unzoned-building-is-grey-but-never-unresolvable.md
type: feature
ordinal: 274000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner revised scope on 2026-09-23: show export options so customer chooses filters and report sections. No zone cost allocation is authorized; decision-43 stays unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Export as opens accessible options for period, worker, building and report sections in DE/EN.
- [x] #2 Selection applies consistently to preview and XLSX; zones carry area and unavailable-cost explanation, never invented costs.
- [x] #3 Empty, loading and error paths preserve selections; export has no database writes.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Build export drawer on payroll using existing filter range and snapshot, selected sections and shared workbook builder.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented in codex/tasks-351-358. Full pnpm verify and branding pass; dedicated real-browser fixture tests and decision/code review passed. PDF: output/pdf/tasks-351-358-report-ru.pdf. No production deployment, live DB authorization test or desktop Excel test.
<!-- SECTION:FINAL_SUMMARY:END -->
