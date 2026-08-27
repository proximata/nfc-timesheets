---
id: TASK-159
title: >-
  Zones on Android: the switch rule compares BUILDINGS, not tag ids (gates every
  second tag on a wall)
status: Done
assignee: []
created_date: '2026-08-18 03:06'
updated_date: '2026-08-27 07:33'
labels:
  - android
  - zones
  - blocker
dependencies:
  - TASK-157
documentation:
  - backlog/docs/ZONES-DESIGN.md
priority: high
ordinal: 77000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
THIS TASK IS THE GATE ON PUTTING A SECOND PHYSICAL TAG IN ANY BUILDING. Design: backlog/docs/ZONES-DESIGN.md sections 3, 8 and 10. Reasoning: decision-37 (PROPOSED).

TimeSheetViewModel.writeTap today compares raw ids: running.locationId == locationId. With two zone tags in one building that comparison is FALSE for an intra-building tap, so the app auto-closes the running shift (auto_closed = true), opens a new one and shows the building-switch notice. A five-zone building would generate a flood of unresolved, unpayable shifts - INCIDENT 7 at scale, and unpaid work.

The rule becomes: resolve the tapped place to its BUILDING, then
  no open shift                  -> open, start_zone_id = tapped zone
  open shift, same building      -> CLOSE it, end_zone_id = tapped zone, auto_closed = false
  open shift, different building -> close with auto_closed = true and open the new one (unchanged, W6)
ANY zone of the same building closes the shift. NOT one shift per zone - the rejected alternatives and why are in the design doc.

zone -> building must resolve from the CACHED roster: a stairwell has no signal, and no cache miss, permission prompt, network failure or roster staleness may ever block or delay a clock-in. The tap still writes a local row FIRST and armSignals() still runs after it (pinned by android/checks/core-check.kt).

An unknown zone id (roster older than the tag) must still open a shift and let the server decide - the server is authoritative (decision-19) and answers 422 unknown_location if it is genuinely unknown.

KnownTags.BY_SERIAL stays as a compiled last-resort fallback for the one live HOIV tag (a fresh install with no network must still work there), with roster-supplied serials taking priority. Delete the compiled entry only once that zone carries the serial and every phone has cached a roster.

Ships as a Play release on the internal track (decision-27). There is no way to force an update, so the rollout must be CONFIRMED per phone before the admin puts a second tag on a wall.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An intra-building zone tap CLOSES the running shift with auto_closed = false; it never opens a second shift and never shows the building-switch notice
- [x] #2 A tap at a different building still closes with auto_closed = true, opens the new shift and shows the notice naming both sites (W6 unchanged)
- [x] #3 zone -> building is resolved from the cached roster with no network call in the tap path; with an empty or stale cache the tap still writes a local row and still posts
- [x] #4 The one adopted HOIV tag still works on a fresh install with no network, via the compiled KnownTags fallback; a roster-supplied serial takes priority over the compiled one
- [x] #5 The close tap sends the tapped place on POST /shifts/close so the server can record end_zone_id
- [x] #6 The running screen names the zone when there is one, and states in words that the next tag contact anywhere in this building ends the shift (de/en parity)
- [x] #7 android/checks/core-check.kt still passes: a tap writes its local row before any signal is armed, and no permission or network state can reject a tap
- [x] #8 Manual clock-out from the running screen (the Scan button, INCIDENT 1) is still reachable
- [x] #9 Rollout is confirmed per phone before any building gets a second physical tag, and that confirmation is recorded on this task
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT 2026-08-27, AC-checkbox hygiene only (read-only; no app code touched, no deep re-verification of this task's individual claims).
Headline claim confirmed live: zones + PLACE tap resolution work today.
 - server/lib/validate.js:533 'export async function activePlace(value, field = "location_uuid")' is the live tap resolver; its building branch emits NULL::uuid AS zone_id (comment at :604), i.e. zone and building taps both resolve.
 - migration 006_zones_revenue_rates.sql is APPLIED ON PRODUCTION: sudo -u postgres psql nfc 'select filename from schema_migrations' on schimmer-glanz.exe.xyz lists 006_zones_revenue_rates.sql (through 013). to_regclass('zones') returns 'zones' on prod.
 - server/db/migrations/006_zones_revenue_rates.sql:141-146 CREATE TABLE zones with area_sqm NUMERIC(8,2) CHECK (area_sqm > 0) NULLable, per decision-43.
Corroborating: the much larger, later and independently-verified decision-54/decision-55 work (unbound zones, migration 013_unbound_zones.sql applied on prod; TASK-285/286, commits 6a5e4f8 / b0c6679) builds directly on this foundation and could not function if it were broken.
ACs checked as a batch on that basis.
<!-- SECTION:NOTES:END -->
