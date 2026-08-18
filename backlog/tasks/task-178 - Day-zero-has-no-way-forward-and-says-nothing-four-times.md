---
id: TASK-178
title: 'Day zero has no way forward, and says nothing four times'
status: To Do
assignee: []
created_date: '2026-08-18 18:54'
labels:
  - ux
dependencies: []
priority: high
ordinal: 96000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The state the new client will be onboarded into, photographed for the first time. Evidence: docs/media/states/state-empty-home-1680-dark.png and state-empty-home-390-dark.png (regenerate with STATES_PHASE=2 STATES_ONLY=empty node demo/shoot-states.mjs).

With no building, no worker and no shift, / renders four empty panels and the sentence 'Es ist kein aktives Objekt angelegt. Sobald ein Objekt angelegt ist, erscheint es hier und auf der Karte.' \u2014 with NO LINK to the screen that creates one. The only action in the header is 'Aktualisieren'. A director on their first morning is told what will happen and not how to make it happen.

Two smaller faults on the same screen:
1. 'Zurzeit ist niemand eingestempelt.' is printed three times (answer band sub, 'Zu erledigen' empty state, 'Gerade im Einsatz' empty state) and 'Nichts offen.' a fourth. Roughly 1.000px of chrome explaining absence.
2. The map region says '0 Objekte haben keine Koordinaten, daher gibt es nichts zu zeichnen.' That sentence is self-contradictory: if zero objects lack coordinates there should be something to draw. mapNoPins is being reused for the zero-building case, which IS production's day one \u2014 production holds one building today and it has no coordinates, and after the backfill the count goes to zero and this sentence appears.

FIX, all of it cheap and none of it deletes a truth:
- the empty Objektliste gains the link it already describes, to /locations/
- the zero-building case gets its own sentence instead of borrowing mapNoPins
- the duplicate 'niemand eingestempelt' is stated once, in the panel that owns it

DO NOT remove the empty-state sentences themselves. An empty exception view reading as data loss is the incident this whole ledger design exists to prevent (REDESIGN-INVENTORY.md 1).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a database with zero active buildings, / offers a link or button that reaches the screen where a building is created
- [ ] #2 The map region no longer claims '0 Objekte haben keine Koordinaten' when there are no buildings at all: the zero-building case has its own sentence
- [ ] #3 'Zurzeit ist niemand eingestempelt.' appears at most twice on the empty dashboard (the answer band's sub plus the panel that owns it), not four restatements of nothing
- [ ] #4 Every empty-state sentence that exists today still exists: no empty panel becomes a dash or a blank
- [ ] #5 de.json and en.json gain the same keys, exact parity
- [ ] #6 Journey D1 (JOURNEYS.md 2.D1, onboard a new client from nothing): from a freshly migrated database the director reaches the building-creation form from the landing screen without using the sidebar or typing a URL
- [ ] #7 demo/shoot-states.mjs empty scenario re-shot and the four panels still name what is missing
<!-- AC:END -->
