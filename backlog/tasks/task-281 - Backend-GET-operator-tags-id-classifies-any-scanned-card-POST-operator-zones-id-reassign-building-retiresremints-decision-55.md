---
id: TASK-281
title: >-
  Backend: GET /operator/tags/:id classifies any scanned card; POST
  /operator/zones/:id/reassign-building retires+remints (decision-55)
status: Done
assignee: []
created_date: '2026-08-26 20:58'
updated_date: '2026-08-26 21:07'
labels:
  - server
  - operator
  - decision-55
dependencies: []
priority: high
ordinal: 199000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-55. Two new operator routes in server/routes/operator.js, no migration needed
(zones.active already exists, migration 006).

1. GET /operator/tags/:id -- read-only classifier, decision-55 section 1. Checks in order:
   active zone (bound or not) -> {kind:"zone", zone:{...same shape as GET
   /operator/zones/:id}}; active building -> {kind:"building"}; inactive zone ->
   {kind:"retired"}; reported-but-unresolved tag -> {kind:"tag_reported"}; else ->
   {kind:"unknown"}. Does NOT use activePlace (decision-55 explains why: that function is
   the tap path and must keep collapsing an unbound zone into unknown_location for a real
   cleaner's tap; this is a different question with its own small query). tag_aliases is
   explicitly out of scope (decision-55 names this), answers "unknown" -- do not silently
   try to widen it.

2. POST /operator/zones/:id/reassign-building {new_tag_id, location_id} -- decision-55
   section 3. :id must be an ACTIVE, BOUND zone. new_tag_id must be a reported-but-
   unresolved tag (reuse resolvedOrUnknown's 404/409 pattern). location_id must be an
   active building (422 unknown_location). ONE statement, EXISTS-gated CTEs, no partial
   application: old zone only retires (active=false) if the new tag is actually claimed at
   the same instant; the new tag is only claimed if the old zone is confirmed live+bound.
   Read decision-55 for the exact CTE shape reasoning. New zone carries the old zone's name
   and note forward, starts verified_at NULL. 409 duplicate_zone_name if the target
   building already has a live zone with that name (same unique index resolve-zone already
   hits). Does NOT touch location_id on the old row directly -- it is never UPDATEd, only
   deactivated.

Mirror the existing file's doc-comment density (see resolveTagToZone/bindZone/unbindZone
for the house style: what each status code means, why the SQL is shaped this way).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /operator/tags/:id returns the correct kind for 6 real fixtures: active bound zone, active unbound zone, active building, a just-retired inactive zone, a reported-unresolved tag, a genuinely unknown uuid
- [x] #2 POST /operator/zones/:id/reassign-building succeeds end to end: old zone becomes active=false, keeps its prior shift history and verified_at unchanged, new zone exists active=true bound to the new building with the same name/note, verified_at NULL, 0 shifts
- [x] #3 reassign-building is refused 404/409/422 for unknown zone id, an UNBOUND old zone, an unknown or already-resolved new_tag_id, an unknown or inactive target building
- [x] #4 no-partial-application is proven with a real fixture: a valid old zone plus an invalid new_tag_id leaves the old zone untouched, still active, still bound
- [x] #5 reassign-building refuses 409 duplicate_zone_name when the target building already has a live zone by that name, and the old zone was NOT retired in that failed attempt
- [x] #6 GET /operator/tags/:id after a reassign-building, scanning the OLD tag id again, returns kind retired
- [x] #7 server/check-api.js covers all of the above with real inserted rows against a live throwaway database, not mocked SQL
- [x] #8 full server/check-api.js suite has no new failures beyond the 1 pre-existing check-telemetry-wire failure (TASK-280)
- [x] #9 git diff shows only server/ files touched; nothing pushed or deployed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Committed 0cb3215 (server/check-api.js, server/routes/operator.js only; +413 lines, no other files).

Two operator routes, decision-55:
- GET /operator/tags/:id -> {kind: zone|building|retired|tag_reported|unknown}; zone payload deepEqual to GET /operator/zones/:id.
- POST /operator/zones/:id/reassign-building -> retires bound zone, mints fresh unverified zone on the newly reported card.

check-api: 223 ok, 1 FAILED = 'the REAL SDK payload leaks nothing and lands as ONE trace' (check-telemetry-wire, TASK-280, pre-existing; telemetry files untouched by this diff).

AC#4 no-partial-write: retirement is downstream-gated on the mint, not merely co-located. old CTE -> claim (UPDATE reported_tags WHERE id=$2 AND resolved_at IS NULL AND EXISTS old) -> minted (INSERT ... FROM claim CROSS JOIN old) -> retired (UPDATE zones SET active=false WHERE EXISTS(SELECT 1 FROM minted)). Bad tag => claim 0 rows => CROSS JOIN empty => minted 0 rows => retired matches 0 rows. Name clash raises unique-index violation inside the single statement, aborts atomically; handler then re-reads to classify 404/409 (pure read). Tests assert active=true, location_id=from after every refusal.

Refusals covered: 404 unknown_zone, 409 zone_unbound, 404 unknown_reported_tag, 409 already_resolved, 422 unknown_location (inactive + nonexistent), 409 duplicate_zone_name, 400 malformed body, 401 admin/worker/app-key.

Fixtures are real rows (admin.query INSERT into throwaway schema check_api_<pid>), routes hit over real HTTP. No mocks.

psst pre-commit false-positived on 'PORT' substring inside UUID literals 00000000-0000-4000-8000-000000000000 (check-api.js:1763,2534) - not a secret; gitleaks clean ('no leaks found'). Committed with PSST_SKIP_SCAN=1 per documented bypass.

Not pushed, not deployed. tag_aliases answering 'unknown' is by design (decision-55 sec 1, accepted cost).
<!-- SECTION:NOTES:END -->
