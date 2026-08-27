---
id: TASK-170
title: >-
  Geocode-Backfill in den Deploy einhängen und einmal gegen Produktion laufen
  lassen
status: In Progress
assignee: []
created_date: '2026-08-18 07:50'
updated_date: '2026-08-27 07:30'
labels:
  - ops
  - map
  - geocode
dependencies: []
ordinal: 88000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ops/backfill-geocode.mjs EXISTS, is checked (demo/check-backfill.mjs, 28 assertions) and has NEVER been run against production. Until it runs there, the map on / draws ZERO pins for the only building this company cleans — locations holds exactly one row, HOIV Arsenalstrasse 11, lat NULL, lng NULL, geocode_status 'no_key', created before GOOGLE_GEOCODING_KEY was installed on the machine.

The key works: Arsenalstrasse 11 resolves to 48.1761151, 16.3953038 (verified against the live endpoint from a laptop during the map work).

WHAT TO DO:
 1. ssh timesheets.exe.xyz, then: node ops/backfill-geocode.mjs --dry-run   (writes nothing, names each building it would ask about and the state it is in)
 2. node ops/backfill-geocode.mjs                                            (one round trip per building, 200ms apart)
 3. Confirm on / that the pin is there and the Objektliste row no longer says 'Keine Koordinaten'.
 4. THEN wire it into ops/deploy.sh, after the migration step and before the health check.

WHY IT IS SAFE TO PUT IN A DEPLOY, each property proved by demo/check-backfill.mjs and each with its red proved:
 - FAILS SOFT: no key -> a line and exit 0; a geocoder that throws -> that building keeps its row, the loop continues, the reason is recorded as retryable and the NEXT run picks it back up; a quota error -> the status is written, no coordinate is invented, exit 0.
 - IDEMPOTENT: the second run selects nothing and writes nothing ('nichts zu tun').
 - NEVER OVERWRITES A FRESHER PIN: the write is WHERE id = $1 AND lat IS NULL, so a pin the admin set from the panel mid-run survives and the log says 'keep'.
 - NAMES what it skipped: ZERO_RESULTS is 'the address is the problem', is not re-asked, and is printed with the slug so somebody can go and fix it. --all forces it.

DEPLOY-STEP REQUIREMENT: it must not be able to fail the deploy. It already exits 0 on every failure path including an unreachable database; keep it that way and do NOT add 'set -e' semantics around it. A missing map pin may not stop the admin shipping.

NOTE ON THE KEY: GOOGLE_GEOCODING_KEY is the SERVER key, IP-restricted, read inside server/lib/geocode.js from /etc/nfc/env. It is a different key from NEXT_PUBLIC_GOOGLE_MAPS_KEY and must never reach a browser — pnnpm check now fails if any file under web/ so much as names it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 node ops/backfill-geocode.mjs --dry-run has been run against production and its output is in the task notes, before anything was written
- [ ] #2 The production HOIV row has lat and lng, and / draws one pin at zoom 16 rather than fitBounds' rooftop
- [ ] #3 Running it a second time against production writes nothing and says 'nichts zu tun'
- [ ] #4 ops/deploy.sh runs it, and a deliberately broken run (key removed) still lets the deploy finish green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT 2026-08-27, FALSE CLOSURE FOUND: this was marked Done with all 4 ACs unchecked and zero notes - nobody ever verified it. grep -n backfill ops/deploy.sh returns NOTHING: AC4 (wire the backfill into deploy.sh) was never done. AC1's dry-run output was never recorded. AC2's premise is now stale: production was fully reset since this task was written (the original HOIV Arsenalstrasse 11 row is gone; per TASK-16's current notes the sole production location is now a row named test with an empty address, so there is nothing to geocode yet regardless of wiring). A second script, server/bin/geocode-backfill.js, now also exists alongside the one this task names (ops/backfill-geocode.mjs) - unclear which is current, needs checking before any fix. Real remaining, distinct work: decide which backfill script is canonical, then actually wire it into ops/deploy.sh so every future deploy keeps geocoding fresh instead of needing a one-off manual run (which is what TASK-16 already did once, manually, per its own notes). Reopened to In Progress; do not close again without grep evidence the wiring exists.
<!-- SECTION:NOTES:END -->
