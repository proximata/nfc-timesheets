---
id: TASK-206
title: >-
  The Maps key is shipped and authorised — but ~1 load in 5 still gets
  RefererNotAllowedMapError
status: To Do
assignee: []
created_date: '2026-08-20 04:03'
updated_date: '2026-08-20 22:46'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RE-MEASURED 2026-08-21 against the live host by ops/prove-live.sh, and TWO of the three original facts are now FALSE. Both were fixed by work that did not know it was closing this task, which is exactly why they were re-measured rather than trusted.

1. WAS: 'production ships NO key, occurrences of AIzaSy: 0'. NOW FALSE. ops/deploy.sh:116 reads NEXT_PUBLIC_GOOGLE_MAPS_KEY from env or psst, FATALs without it unless ALLOW_NO_MAP_KEY=1, and passes it into the build. The key is in the live bundle: /_next/static/chunks/ed8b6eca5935f573.js carries AIzaSy... (one chunk of the 13 fetched).

2. WAS: 'the key would not work if it did — RefererNotAllowedMapError, canvas=0 pins=0'. NOW MOSTLY FALSE. The referrer IS on the key. Five identical loads of https://schimmer-glanz.exe.xyz/ through headless Chrome, logged in, waiting for the map to LEAVE its loading state:

  4/5  'Auf der Karte: 1. Ohne Koordinaten: 0.'   <- HOIV, pinned
  1/5  RefererNotAllowedMapError, Google naming 'https://schimmer-glanz.exe.xyz/'

A key WITHOUT the referrer fails every time; a key with it should fail none. So what is left is not a missing console entry — it is an intermittent rejection.

3. WHAT IS ACTUALLY LEFT, and it is the only thing worth doing here: find out whether that 1-in-5 is real for the director or an artefact of the measurement. Every sample was headless Chrome with a COLD --user-data-dir; a warm browser with a warmed HTTP cache may never see it. Until that is known, the director may be seeing a grey box some fraction of the time and has no way to tell it from a slow one.

ACCEPTANCE
- load https://schimmer-glanz.exe.xyz/ ten times in a normal, warm Chrome, logged in as the director, and record how many draw. Console open: RefererNotAllowedMapError is the only witness — an unauthorised key does NOT fail the script load (web/lib/map.ts says so).
- if a warm browser never fails: close this, and delete the 'intermittent' note from CORE-FLOW section 2b and the note ops/prove-live.sh prints.
- if it does fail: check the Cloud console for a SECOND restriction (API restrictions, or a quota), and for whether the allowlist entry is 'https://schimmer-glanz.exe.xyz/*' with the trailing wildcard rather than the bare origin.
- http://127.0.0.1:8080/* must stay on the key either way. It is the only loopback origin the allowlist has and every local map check in this repo runs against it.

EVIDENCE ON DISK: docs/media/prove-live/05-map-drawn.png (pinned) and 05-map-blocked.png with 05-map-blocked.console.txt (Google's own error), taken minutes apart from the same page.
<!-- SECTION:NOTES:END -->
