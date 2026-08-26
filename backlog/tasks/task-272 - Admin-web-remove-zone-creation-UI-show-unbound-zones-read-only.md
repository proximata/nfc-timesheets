---
id: TASK-272
title: 'Admin web: remove zone-creation UI, show unbound zones read-only'
status: Done
assignee: []
created_date: '2026-08-26 17:13'
updated_date: '2026-08-26 18:06'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
REVIEW GATE (TASK-275), 2026-08-26 — INDEPENDENTLY VERIFIED, stays Done.

decision-44's adopted-hardware tag-serial walk is UNTOUCHED, proved by extraction and diff rather than by reading the hunk headers:
- git show b77523c~1:web/app/locations/page.tsx and git show b77523c:... extracted, then submitZone() and the whole 'hidden={zoneStep !== 2}' JSX block diffed. submitZone: IDENTICAL (75 lines). zoneStep===2 tag walk: IDENTICAL (100 lines). The last hunk in the file ends at new line 2153; the step-2 block starts at 2266.
- The only change touching that drawer is the title (b77523c, new line 2147): zoneDraft?.id === undefined ? t('zoneCreate') : t('zoneEditHeading')  ->  t('zoneEditHeading'). Correct, since the create branch no longer exists.
- app/tags/page.tsx: the existing-zone <select> is byte-identical, just un-nested out of the removed action branch. resolveTagToExistingZone (tag_aliases) survives; only resolveTagToZone went.
- web/lib/api.ts:467-478 deletes the client helper as a COMMENT, not a dead export — same rule decision-47 set for resolveTagToBuilding.
- web/lib/objects.ts:113 correctly skips location_id === null so an unbound zone counts towards no building.
- openZoneEdit (page.tsx:766) and toggleZone (:888) both early-return on location_id === null, so an unbound zone really is read-only from the panel. Consequence worth naming: POST /admin/zones requires location_id and matches 'WHERE id = $1 AND location_id = $8', so an unbound zone is not editable by an admin AT ALL, not even its name. That matches decision-54 §1's word 'read-only'; it is one notch stricter than §2's 'keeps editing an EXISTING zone'.

pnpm verify: EXIT 0. scripts/check.mjs 'All checks passed' incl. de/en key-set parity, ICU parity, plural branches. Biome: 1 warning, app/payroll/page.tsx:749 useOptionalChain — pre-existing, that file is not in this commit. tsc clean, next build 18/18 static pages.
<!-- SECTION:NOTES:END -->
