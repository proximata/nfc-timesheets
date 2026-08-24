---
id: TASK-251
title: >-
  activePlace() and the locations UI both resolve/expose a building-level tag
  for EVERY building, not just the HOIV grandfather
status: To Do
assignee: []
created_date: '2026-08-24 14:31'
labels:
  - security
  - tap-path
  - zones
dependencies: []
references:
  - docs/media/tasks/building-tag-gap.png
  - server/lib/validate.js
  - web/app/locations/page.tsx
modified_files:
  - server/lib/validate.js
  - web/app/locations/page.tsx
priority: high
ordinal: 169000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-47 deleted resolve-building so a tag can no longer MINT a new building. It never restricted the RESOLVE side: server/lib/validate.js activePlace()'s first UNION arm is `WHERE l.id = $1 AND l.active`, unconditional on identity, emitting zone_id NULL for ANY active building — and requireVerifiedPlace returns unconditionally when zone_id IS NULL. So today, ANY building's raw UUID written on a tag clocks in with zero zone verification, not just HOIV's one physical legacy card the comment block argues for.

The admin UI compounds it: web/app/locations/page.tsx renders the 'Building tag (existing)' disclosure (tagLegacySummary, ~line 1804) for EVERY location unconditionally, with a live Copy-tag-URL button — unlike the zonesNoneVerified line 20 lines above it, which already correctly gates on `location.id === HOIV_BUILDING_ID`. Screenshot attached: docs/media/tasks/building-tag-gap.png, taken live post-wipe against a freshly created building (uuid 5c96bb23-9d65-45f0-9eea-b18c70f4b867, not HOIV's c3c37d4a-...), showing a fully working copyable building-level tap URL for a building that was created AFTER resolve-building was deleted.

Fix, scoped narrowly (touches the tap-resolution core, treat with care):
- server: restrict activePlace()'s building UNION arm from 'any active building' to the one literal grandfathered id (same HOIV_BUILDING_ID already hardcoded in web), so every other building can only ever resolve through a zone
- web: gate the disclosure the same way zonesNoneVerified already does: location.id === HOIV_BUILDING_ID, not unconditional
- keep the HOIV branch's own reasoning (unconditional on locations.active, NULL zone columns, no zone predicate) fully intact for that one id — do not touch why it exists, only who it applies to

Not yet fixed. Flagged live during UAT, not from a report.
<!-- SECTION:DESCRIPTION:END -->
