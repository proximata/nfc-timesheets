---
id: TASK-167
title: Zone block and tag truth in the Objektpanel
status: To Do
assignee: []
created_date: '2026-08-18 03:19'
labels:
  - ux
  - zones
  - map
dependencies:
  - TASK-158
  - TASK-163
documentation:
  - backlog/docs/ZONES-DESIGN.md
  - backlog/docs/MAP-HOME-SPEC.md
priority: medium
ordinal: 85000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
JOURNEYS.md section 6 names four facts that live only in a human's memory. This block gives the first one a home: WHICH WALLS HAVE TAGS, and whether the tag is ours or adopted. Bound by decision-37 (PROPOSED). Spec: MAP-HOME-SPEC.md sections 3.2 and 4.

One row per active zone, below the five numbers:
  triangle Eingang     Vesna G. - 17.11. auto-beendet, nicht bestaetigt   vor 4 Std.
  filled  Stiege 2     Marta N. - laeuft seit 13:20                       seit 38 min
  hollow  Tiefgarage   Tomasz L. - 20.11.                                 vor 6 Std.
  square  Buero 2. OG  kein Tag hinterlegt                                -

Per zone, one line of tag truth: 'eigener Tag' (tag_deployed_at set) / 'fremder Tag uebernommen' (tag_serial set) / 'kein Tag' (neither), plus 'zuletzt getappt {when}' and the zone's own /t?l=<zone uuid> with the SAME verbatim code-block and copy control the building tag URI already uses on /locations/ - not a new pattern.

THE UNRESOLVED SHIFT IS USUALLY NOT THE MOST RECENT SHIFT ON THAT ZONE. Carry it explicitly, or the row captions the wrong worker and the wrong date with 'nicht bestaetigt'. The PoC hit exactly this.

WHAT THIS BLOCK MUST NEVER PRINT: per-zone hours and per-zone euros. decision-37 makes a shift building-level; there is no per-zone duration and no per-zone money. 'Die Tiefgarage wurde seit 14. Mai nicht getappt' is answerable; 'die Tiefgarage kostet 180 EUR/Monat' is a fabricated measurement.

Sources, all derived, no new aggregate columns: zone list from zones WHERE location_id = ? AND active (EMPTY IS THE NORMAL CASE); 'zuletzt getappt' from MAX over shifts naming that zone (decision-37 deliberately has no last_tapped_at column); tag state from tag_serial / tag_deployed_at.

THE SEQUENCING WARNING BELONGS ON THIS SCREEN. The APK in the field compares raw tag ids, so it reads an intra-building zone tap as a BUILDING SWITCH: auto_closed = true, a new shift, and a flood of unresolved unpaid work. Wherever a second tag URI could be copied, the panel states it in words, de/en: 'Zweiter Tag in diesem Objekt erst, wenn alle Telefone die neue App haben.'
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A building with no zones renders one stated line - 'Keine Zonen angelegt. Dieses Objekt verhaelt sich wie bisher: ein Ort, ein Tag.' - and no empty table
- [ ] #2 A zone with no tag says so in words; a zone on an adopted tag says 'fremder Tag uebernommen'; a zone with our own tag says 'eigener Tag'. Each is readable in a desaturated screenshot
- [ ] #3 The 'nicht bestaetigt' caption names the UNRESOLVED shift's worker and date, not the most recent shift's - proven with a zone whose newest shift is resolved and whose older one is not
- [ ] #4 No zone row prints hours or euros anywhere in the block
- [ ] #5 Each zone renders its own /t?l=<zone uuid> verbatim with a copy control that copies THAT zone's URI, and the UUID is printed underneath
- [ ] #6 The 'second tag only when every phone has the new app' warning is rendered in de and en wherever a second zone's URI can be copied
<!-- AC:END -->
