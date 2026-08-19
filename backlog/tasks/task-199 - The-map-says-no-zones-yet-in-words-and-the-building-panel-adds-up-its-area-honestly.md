---
id: TASK-199
title: >-
  The map says 'no zones yet' in words, and the building panel adds up its area
  honestly
status: To Do
assignee: []
created_date: '2026-08-19 14:09'
labels:
  - web
  - zones
  - map
  - a11y
  - i18n
dependencies:
  - TASK-196
  - TASK-198
documentation:
  - backlog/decisions/decision-43
  - backlog/docs/ZONES-MODEL.md
priority: medium
ordinal: 117000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-43, the map half. ZONES-MODEL.md $3.4, $3.6, $8.

An UNZONED building -- contract, contact, no zones -- is a legitimate state and renders GREY on
the map with a named next action.

  zone_state = 'unzoned'  ->  grey pin + 'Noch keine Zonen — Fläche unbekannt' + [ Zone anlegen ]
  zone_state = 'zoned'    ->  normal

*** GREY IS THE SECOND SIGNAL. THE WORDS ARE THE FIRST. *** A pin that is only distinguishable
by colour fails decision-28's rule and fails greyscale. Pin shape or a label carries the state;
colour reinforces it.

*** AND THE THING THAT MUST NOT LEAK INTO THE SERVER ***
zone_state is DERIVED and PRESENTATION ONLY. It is NOT locations.active. An unzoned building's
own uuid still resolves on a tap, for ever (TASK-196, TASK-197 pin 1). Nothing on this screen
may be wired to resolution.

BUILDING PANEL gains:
  Fläche   mindestens 420 m² (2 von 5 Zonen ohne Fläche)      <- when any active zone is NULL
           420 m² (5 Zonen)                                    <- when all are measured
           keine Zonen                                         <- unzoned; NOT '0 m²'
  Zonen    the list from TASK-198, with last-contact per zone

The 'mindestens' wording is not decoration: a denominator that is silently too small inflates
every per-m2 figure downstream (TASK-200). A total that pretends completeness is the failure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An unzoned building renders grey AND carries the words; the state survives a greyscale render
- [ ] #2 RED, seeded: a building with one measured and one unmeasured zone shows 'mindestens X m² (1 von 2 Zonen ohne Fläche)'. Make the sum ignore the unknown -> the check goes red
- [ ] #3 An unzoned building shows 'keine Zonen', never '0 m²'
- [ ] #4 RED, seeded: tap an unzoned building's uuid while its pin is grey -> still 201. The grey state is proven not to be wired to resolution
- [ ] #5 de/en exact key parity; Austrian business German; plurals through ICU
- [ ] #6 Renders at 1680 and 390; the panel's area line wraps rather than truncating its qualifier
<!-- AC:END -->
