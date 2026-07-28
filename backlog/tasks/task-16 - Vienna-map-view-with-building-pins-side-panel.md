---
id: TASK-16
title: Vienna map view with building pins + side panel
status: To Do
assignee: []
created_date: '2026-07-28 13:49'
labels:
  - web
  - ux
milestone: m-3
dependencies:
  - TASK-15
  - TASK-2
priority: high
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dashboard home = map of Vienna (Leaflet or Mapbox free tier). Buildings as pins with thumbnails. Click pin -> side panel slides in with building summary: name, address, photo, total hours, top 5 metrics. Period selector: this week/month/quarter/year/all (5 views, default this week).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Map renders centered on Vienna
- [ ] #2 Each building appears as pin at coordinates
- [ ] #3 Pin shows thumbnail photo or placeholder
- [ ] #4 Side panel slides in with summary on click
- [ ] #5 Period selector switches all displayed metrics
- [ ] #6 Panel closable, map interactive behind it
<!-- AC:END -->
