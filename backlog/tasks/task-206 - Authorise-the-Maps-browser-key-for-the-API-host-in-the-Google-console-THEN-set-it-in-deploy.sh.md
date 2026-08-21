---
id: TASK-206
title: >-
  The Maps key is shipped and authorised — but ~1 load in 5 still gets
  RefererNotAllowedMapError
status: Done
assignee: []
created_date: '2026-08-20 04:03'
updated_date: '2026-08-21 03:24'
labels:
  - web
  - ops
  - measured
dependencies: []
priority: high
ordinal: 124000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED at 8702615, live, read-only. RECON rank 4 said 'ship the maps key in ops/deploy.sh. One line.' That is WRONG AS WRITTEN and one line produces a bundle that loads Google Maps and is REFUSED by Google.

Two independent facts, and only the first was in RECON:

1. production ships NO key. 13 chunks fetched off https://schimmer-glanz.exe.xyz/ this session, occurrences of AIzaSy: 0. ops/deploy.sh never sets NEXT_PUBLIC_GOOGLE_MAPS_KEY.
2. the key would not work if it did. node demo/check-map-key.mjs -> FAIL https://schimmer-glanz.exe.xyz/ canvas=0 pins=0 RefererNotAllowedMapError, while the same key on http://127.0.0.1:8080/ draws canvas=1 pins=5.

So the director sees the no-map rendering TODAY on the surface decision-39 calls the landing surface, and has since the map shipped (TASK-16, In Progress since 2026-08-04).

The console step is NOT IN THIS REPO, which is why no check could ever have caught it by grepping:

  Google Cloud console > APIs & Services > Credentials > the browser key
    > Application restrictions > Websites > add  https://schimmer-glanz.exe.xyz/*
    > KEEP http://127.0.0.1:8080/*  - it is the ONLY loopback origin the allowlist has,
      and every local map check in this repo runs against it. Removing it silently
      disarms probe-zones-revenue, check-ia-greyscale and check-map-home.
  then ops/deploy.sh: export NEXT_PUBLIC_GOOGLE_MAPS_KEY=$(psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY)

node demo/check-map-key.mjs is the gate. It is RED right now and asks the question under the real hostname rather than grepping for it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 node demo/check-map-key.mjs exits 0: both hosts draw a canvas and pins
- [x] #2 http://127.0.0.1:8080/* is still on the allowlist afterwards - re-run BASE=http://127.0.0.1:8080 node demo/probe-zones-revenue.mjs and confirm the grey-pin assertions still say 'ok' and not 'SKIP'
- [x] #3 ops/deploy.sh sets NEXT_PUBLIC_GOOGLE_MAPS_KEY from psst, and a deploy dry-run shows the built bundle contains AIzaSy
- [x] #4 after deploy: curl the live index, fetch every chunk, and count at least one AIzaSy - the same measurement that reads 0 today
- [x] #5 the negative case is exercised: remove the API host from the allowlist again and check-map-key goes red
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RE-VERIFIED by the verdict pass 2026-08-21, independently of the run that closed it: 5/5 fresh loads of https://schimmer-glanz.exe.xyz/ (cache-busted) drew, 0 RefererNotAllowedMapError in the browser console, and the map rectangle was clipped and checked for PIXELS rather than for a container element — 18 tile requests, 30 tile nodes, 140 distinct colours, HOIV pinned and labelled (docs/media/verdict/map-clip.png). Stays Done.

Caveat for whoever reads this next: a full-page screenshot of that same screen shows the map as a black rectangle. That is captureBeyondViewport relaying out the tile layer, NOT a defect — filed as TASK-232 so it is not misdiagnosed a fourth time.
<!-- SECTION:NOTES:END -->
