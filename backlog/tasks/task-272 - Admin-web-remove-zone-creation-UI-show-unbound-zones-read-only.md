---
id: TASK-272
title: 'Admin web: remove zone-creation UI, show unbound zones read-only'
status: Done
assignee: []
created_date: '2026-08-26 17:13'
updated_date: '2026-08-26 17:28'
labels: []
dependencies:
  - TASK-271
ordinal: 190000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-54. Depends on TASK-271's backend routes. web/app/locations/page.tsx: remove openZoneCreate and its trigger button/entry point, and remove the 'optional first zone' step 3 in submitLocation's new-building flow (firstZoneName/firstZoneArea/firstZoneNote fields and the conditional saveZone call). KEEP openZoneEdit/submitZone's step-2 tag-walk (decision-44 adopted-serial flow, a different mechanism, out of scope) and toggleZone (soft delete/reactivate). web/app/tags/page.tsx: remove the resolveTagToZone (new-zone) admin UI path since the backend route is gone; KEEP resolveTagToExistingZone (tag aliasing onto an EXISTING zone, out of scope, not zone creation). Zones list/table: show unbound zones (location_name null) as a plain, clearly-labelled read-only row -- no edit-building action on them from admin.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 openZoneCreate and its UI entry point are removed from web/app/locations/page.tsx
- [x] #2 new-building drawer's optional first-zone step is removed
- [x] #3 openZoneEdit, submitZone's existing tag-serial-walk (step 2), and toggleZone are unchanged and still work
- [x] #4 web/app/tags/page.tsx no longer offers creating a new zone from a reported tag; resolveTagToExistingZone (tag aliasing) is untouched
- [x] #5 an unbound zone (location_id null) is visible somewhere in the admin zones view, clearly marked, with no edit/bind affordance
- [x] #6 pnpm verify (Biome + build) passes
<!-- AC:END -->
