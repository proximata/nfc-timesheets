---
id: TASK-155
title: 'Dashboard wird kartengeführt: die Karte IST die Übersicht'
status: To Do
assignee: []
created_date: '2026-08-17 15:45'
updated_date: '2026-08-18 03:20'
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
- [ ] #1 With every building lat IS NULL (production today) the map region is NOT rendered, the Objektliste is complete, and the screen states why in words
- [ ] #2 Pin states are readable in a DESATURATED screenshot: every state carries a glyph and a word before it carries a colour
- [ ] #3 Exactly one pinned building centres at zoom 16 rather than fitBounds' maximum zoom
- [ ] #4 All nine degradation states are forced and screenshotted; with the Maps script blocked at the network layer the page still lists every building
- [ ] #5 gm_authFailure removes the map region entirely - no grey Google box, no overlay - and the list is unaffected
- [ ] #6 A data refetch produces ZERO additional map loads, counted in the browser network panel, on both / and /analytics/
- [ ] #7 Switching theme does not remount the map (zero additional map loads per toggle)
- [ ] #8 /analytics/ no longer constructs a map, and its table plus noteMapEquivalent invariant are intact
- [ ] #9 No new npm dependency; the Maps script is still a plain script tag; the geocoding key does not appear in the client bundle
<!-- AC:END -->
