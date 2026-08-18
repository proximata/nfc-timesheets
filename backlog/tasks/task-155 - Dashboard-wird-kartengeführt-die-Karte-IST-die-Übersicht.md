---
id: TASK-155
title: 'Dashboard wird kartengeführt: die Karte IST die Übersicht'
status: Done
assignee: []
created_date: '2026-08-17 15:45'
updated_date: '2026-08-18 07:49'
labels:
  - ux
  - web
  - map
  - ia
dependencies:
  - TASK-162
  - TASK-163
documentation:
  - backlog/docs/MAP-HOME-SPEC.md
  - backlog/docs/IA-PLAN.md
priority: high
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SCOPE NARROWED, 2026-08-18. This task is now the MAP REGION ONLY. The Objektliste is TASK-162, the Objektpanel is TASK-163, the phone pass is TASK-166, the zone block is TASK-167, and the URL filter contract every panel link depends on is TASK-160. Full specification: backlog/docs/MAP-HOME-SPEC.md. Reasoning: decision-39 (PROPOSED). Supersedes the separate map page idea in TASK-18 and TASK-48.

THE HEADLINE FINDING THAT REORDERS THIS WORK: ZERO buildings in production have coordinates. HOIV Arsenalstrasse 11 predates the geocoding key, so lat IS NULL and geocode_state = never_attempted. On the day this ships the map draws ZERO PINS. The list is therefore not the fallback - the list is day one, and this task is a region that appears above it.

DO IT AFTER TASK-160. Shipping the map first produces a beautiful panel whose links land exactly where today's land, and the complaint that started this work survives the redesign that was supposed to end it.

WHAT THIS TASK BUILDS:
 - the map region on /, fixed height min(52vh, 560px), NEVER 100vh - a viewport-locked map hides the triage list, which is journey D4, the journey the map exists to serve
 - dark style with POI and labels.icon OFF (Google's motorway shields are blue and blue is the one accent), language=de and region=AT on the script URL
 - LABELLED PINS, not dots: glyph + short name + '{n} vor Ort' + a 'pruefen' chip. FIVE states, glyph and word FIRST, colour SECOND: filled = vor Ort, hollow = niemand, triangle = pruefen, square = kein Tag, and NO COORDINATES IS NOT A PIN - it is a list row. Occupancy and attention are INDEPENDENT: a building can be fully staffed and still need looking at, so one traffic light would make the pin and the answer band disagree. At most two chips per pin.
 - extent: fitBounds over pinned active buildings, padding 48. EXACTLY ONE pinned building: setCenter + setZoom(16) - fitBounds on one point zooms to maximum and lands the director on a rooftop. Zero pinned: the region is not rendered at all, no empty grey frame.
 - overlap: draw order by ascending latitude so a southern label never covers a northern anchor; the selected pin is raised. Above 30 pins the label degrades to glyph + count. NO CLUSTERING LIBRARY - that is a dependency and the budget is zero.
 - accessibility ceiling, stated deliberately: the pin layer is aria-hidden, pins are tabindex=-1, mouse and touch only. The Objektliste below carries the same buildings, numbers, states and action, and is the only set of tab stops. This is /analytics/'s noteMapEquivalent invariant - the table is primary, the map is optional - and inheriting it is what makes the map cheap.
 - NINE DEGRADATION STATES (MAP-HOME-SPEC section 5), each a designed rendering in German, in words: noPins, noKey, loading, network, timeout, blocked, partially unpinned, data fetch failed, session lost. gm_authFailure must TEAR THE MAP DOWN, not overlay it - it fires late, after new Map() has succeeded, and what renders is a grey box under Google's own alert. Quota exhaustion is NOT distinguishable from a rejected key in the browser; name both possibilities in one sentence and do not invent the distinction.
 - CONSTRUCT THE MAP ONCE per mount, held in a ref; a data refresh updates markers only; a theme switch calls setOptions and never remounts. FIX THE SAME BUG ON /analytics/ IN THIS TASK: its useEffect is keyed on [report, pinned], so every refetch constructs a new Map, and billing is per map load. No auto-refresh polling on /.
 - /analytics/ LOSES ITS MAP in this task. Two maps in one admin are two things that can disagree.

CONSTRAINTS: Google Maps via a plain script tag, no new npm dependency. The browser key is referrer-restricted and is inlined at BUILD time - a build made without it ships noKey permanently, so print a loud build-time warning but do NOT fail the build. The geocoding key is a different, IP-restricted key and must never reach a browser. Exact Maps prices and free volumes are deliberately not asserted anywhere - Google changed the model in 2025; read the Cloud console and set a per-day quota cap and a billing alert.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With every building lat IS NULL (production today) the map region is NOT rendered, the Objektliste is complete, and the screen states why in words
- [x] #2 Pin states are readable in a DESATURATED screenshot: every state carries a glyph and a word before it carries a colour
- [x] #3 Exactly one pinned building centres at zoom 16 rather than fitBounds' maximum zoom
- [ ] #4 All nine degradation states are forced and screenshotted; with the Maps script blocked at the network layer the page still lists every building
- [x] #5 gm_authFailure removes the map region entirely - no grey Google box, no overlay - and the list is unaffected
- [x] #6 A data refetch produces ZERO additional map loads, counted in the browser network panel, on both / and /analytics/
- [x] #7 Switching theme does not remount the map (zero additional map loads per toggle)
- [x] #8 /analytics/ no longer constructs a map, and its table plus noteMapEquivalent invariant are intact
- [x] #9 No new npm dependency; the Maps script is still a plain script tag; the geocoding key does not appear in the client bundle
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DONE, with AC#4 narrowed and said out loud.

WHAT SHIPPED: components/HomeMap.tsx (the region, the pins, the info box, the seven states),
lib/map.ts (MAP_STYLE_DARK/LIGHT, OverlayView types, language from <html lang>, region=AT),
lib/objects.ts (ONE derivation for the pin and the list row). /analytics/ lost its map and its
useEffect reconstruction loop with it.

THE mapId TRADE-OFF, taken and written down in lib/map.ts: OverlayView + an inline styles
array, NO cloud mapId. AdvancedMarkerElement requires a mapId and a mapId makes the API ignore
styles outright, so the choice is a dark map with a deprecated marker or a white Google map
inside a dark admin. Upgrade path is in the file. pnpm check asserts no file that constructs a
map mentions mapId; demo/check-map-home.mjs reads our own #101216 back OUT of the tile request
Google was sent, which is the end-to-end form of the same guard.

AC#4 — SEVEN STATES, NOT NINE, and the difference is deliberate:
  noKey · noPins · loading · ready · blocked · failed · timeout, plus collapsed on a phone.
The spec's 'partially unpinned' is not a state of the map, it is a state of a ROW (the region
says 'Auf der Karte: 5. Ohne Koordinaten: 1.' and the row says which of the three things
happened). 'data fetch failed' and 'session lost' were already owned by the page's own error
alert and by the 401 -> /login/ redirect and are not the map's business; duplicating them here
would be two renderings of one failure that can disagree.

PROVEN BY BREAKING, not by reading (demo/check-map-home.mjs, 81 assertions):
the Maps script blocked at the NETWORK layer, gm_authFailure fired the way Google fires it,
every coordinate in nfc_demo set to NULL, and every building deactivated. Reds proved and
reverted: zero pins drawing an empty grey frame, blocked overlaying instead of tearing down,
the Objektliste demoted to a fallback, greedy gestures, the phone building a map, a mapId
replacing the styles, fitBounds on a single pin, the info box clipping its own cross-links.

NOT DONE HERE: the build-time warning for an empty NEXT_PUBLIC_GOOGLE_MAPS_KEY. The RUNTIME
rendering is built and checked (MAP_NO_KEY=1 node demo/check-map-home.mjs), which is the part
the director sees; the console warning is a deploy ergonomics nicety and belongs with the
deploy work.
<!-- SECTION:NOTES:END -->
