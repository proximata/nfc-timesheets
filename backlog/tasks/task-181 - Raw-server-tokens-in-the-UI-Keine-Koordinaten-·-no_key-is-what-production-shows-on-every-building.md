---
id: TASK-181
title: >-
  Raw server tokens in the UI: 'Keine Koordinaten · no_key' is what production
  shows on every building
status: To Do
assignee: []
created_date: '2026-08-18 18:55'
labels:
  - ux
dependencies: []
priority: medium
ordinal: 99000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
objectsGeoFailed is 'Keine Koordinaten \u00b7 {status}' and {status} is the server enum, verbatim. Evidence: docs/media/states/home-map-nopins-1680-dark-top.png \u2014 five rows read 'Keine Koordinaten \u00b7 no_key' and one reads 'Keine Koordinaten \u00b7 noch nie abgefragt', so the same column is half German and half machine.

This is not an edge case: production's single building carries geocode_status = 'no_key' (IA-PLAN.md 9, verified read-only against production), and every building created before the geocoding key was installed carries it. The four values that actually occur are no_key, ZERO_RESULTS, REQUEST_DENIED and OVER_QUERY_LIMIT, and all four are the moment a director is deciding whether to press 'Koordinaten holen'.

FIX: map the four known statuses to German sentences that say what to do; for anything else keep objectsGeoUnknown AND print the raw token in parentheses. Never drop the raw token \u2014 the operator reading a support message needs it.

Same interpolation exists on /analytics/ (geoFailed {status}, geoStatusUnknown). Fix both from one helper.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 no_key renders as a German sentence naming that the key was not configured when the building was created, not as 'no_key'
- [ ] #2 ZERO_RESULTS, REQUEST_DENIED and OVER_QUERY_LIMIT each render as a German sentence
- [ ] #3 An unrecognised status renders the 'Grund unbekannt' wording followed by the raw token in parentheses
- [ ] #4 The same mapping is used on / (Objektliste) and on /analytics/, from one shared helper
- [ ] #5 de.json and en.json gain the same keys, exact parity, Austrian business German
- [ ] #6 Journey D1 (JOURNEYS.md 2.D1) and D2 (2.D2): the row that tells the director a building has no pin says why in words they can act on
<!-- AC:END -->
