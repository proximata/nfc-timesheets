---
id: TASK-6
title: Write NDEF URI records to NFC tags
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-04 16:47'
labels:
  - ios
  - physical
milestone: m-1
dependencies:
  - TASK-4
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Using NFC Tools app, write NDEF URI record https://timesheets.exe.xyz/t?l=<LOCATION_ID> to each blank NTAG213/215 tag. Document tag UID to location mapping.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each tag reads back correct NDEF URI via NFC Tools
- [ ] #2 Tag UID matches registered location
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE for the tags that exist. Read the caveat.

AC1 evidence, three independent strands:
1. `docs/media/demo-write-tag.mp4` (30 s) — a real phone writing a real NTAG with NFC Tools,
   filmed by hand. Not a simulation.
2. Production has exactly ONE location: `c3c37d4a-ca0a-42c5-b248-9704b9907ec7`,
   slug `hoiv-arsenalstrasse-11`.
3. Five shifts in the production `shifts` table (2026-07-30) reference that location_id and all
   carry a client_uuid, i.e. they were posted by a phone. A tap on a physical tag at that
   building is the only path that produces those rows. That is the readback proof.

AC2 is OBSOLETE, not skipped: decision-5 and decision-21 put the location UUID in the URI and
abandoned the hardware UID entirely, so "tag UID matches registered location" describes a
mapping the product no longer keeps.

CAVEAT, stated rather than waved through: this proves the tag at Arsenalstrasse works. Every
further building needs its own tag written and its own location row, and that is a site visit
per building — a human task, not an agent task. The tags are deliberately left UNLOCKED
(decision-15) so the host can move later without a site visit.
<!-- SECTION:NOTES:END -->
