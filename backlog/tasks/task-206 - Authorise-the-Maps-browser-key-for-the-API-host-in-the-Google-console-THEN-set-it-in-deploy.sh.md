---
id: TASK-206
title: >-
  Authorise the Maps browser key for the API host in the Google console, THEN
  set it in deploy.sh
status: To Do
assignee: []
created_date: '2026-08-20 04:03'
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
- [ ] #1 node demo/check-map-key.mjs exits 0: both hosts draw a canvas and pins
- [ ] #2 http://127.0.0.1:8080/* is still on the allowlist afterwards - re-run BASE=http://127.0.0.1:8080 node demo/probe-zones-revenue.mjs and confirm the grey-pin assertions still say 'ok' and not 'SKIP'
- [ ] #3 ops/deploy.sh sets NEXT_PUBLIC_GOOGLE_MAPS_KEY from psst, and a deploy dry-run shows the built bundle contains AIzaSy
- [ ] #4 after deploy: curl the live index, fetch every chunk, and count at least one AIzaSy - the same measurement that reads 0 today
- [ ] #5 the negative case is exercised: remove the API host from the allowlist again and check-map-key goes red
<!-- AC:END -->
