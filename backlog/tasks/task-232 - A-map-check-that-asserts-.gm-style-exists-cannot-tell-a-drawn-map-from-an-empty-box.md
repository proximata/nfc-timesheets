---
id: TASK-232
title: >-
  A map check that asserts .gm-style exists cannot tell a drawn map from an
  empty box
status: To Do
assignee: []
created_date: '2026-08-21 03:24'
labels:
  - web
  - checks
dependencies: []
priority: medium
ordinal: 150000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED 2026-08-21, and it nearly became the fourth misdiagnosis of the map in this project.

The verdict pass photographed the live home screen full-page and the map was a BLACK RECTANGLE — while .gm-style was in the DOM, the banner read 'Auf der Karte: 1. Ohne Koordinaten: 0.' and every existing assertion was green. The map was in fact FINE: the black rectangle was an artefact of Page.captureScreenshot with captureBeyondViewport, which relays out the absolutely-positioned tile layer.

demo/verdict-map.mjs settled it by asking four questions instead of one:
  tiles   18 requests to maps.googleapis.com/maps/vt seen by the network layer
  dom     30 tile <img> nodes, Google attribution present
  pixels  the clipped map rectangle holds 140 distinct colours
  console 0 RefererNotAllowedMapError
and the clip (docs/media/verdict/map-clip.png) shows Vienna, dark-styled, with the HOIV pin labelled 'HOIV · 0 vor Ort · kein Tag · ohne Zone'.

THE POINT: .gm-style is created by the Maps loader BEFORE a single tile is requested. Every check in this repo that concludes 'the map drew' from its presence would pass over a completely empty box — which is the exact failure mode a referrer-key rejection produces, and the one this project has already misdiagnosed twice in the other direction.

WHAT TO DO:
- fold the pixel test into demo/check-map-home.mjs and demo/check-map-key.mjs: clip the map's own bounding rect, count distinct colours off a canvas, and fail below a threshold. No image library — the page decodes its own screenshot (see demo/verdict-map.mjs).
- never use captureBeyondViewport on a screen containing the map, or the evidence will lie to the reader. Say so in a comment where the shot is taken.
- ACCEPTANCE, shown RED: run the same check against an origin that is NOT on the browser key's referrer allowlist (any port other than 127.0.0.1:8080) — the rectangle must come back flat and the check must fail with 'nothing was drawn', not pass on the container.

WATCH OUT: the referrer allowlist is 127.0.0.1:8080 and the production host ONLY. A map probe on any other port shows zero pins and looks exactly like a defect. That is the RED case here, deliberately — do not 'fix' it by widening the allowlist.
<!-- SECTION:DESCRIPTION:END -->
