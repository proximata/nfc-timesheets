---
id: TASK-179
title: >-
  At 390px the two least-used controls hold the top of the screen: 760 of 844
  pixels before the first fact
status: To Do
assignee: []
created_date: '2026-08-18 18:54'
labels:
  - ux
dependencies: []
priority: medium
ordinal: 97000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: docs/media/states/home-390-dark-top.png. Measured order down a 390x844 viewport: brand (y=24) -> Darstellung select -> Sprache select -> Abmelden button -> a horizontally scrolling nav strip cut off mid-word -> h1 -> question -> answer band -> 'Karte anzeigen' -> a paragraph explaining the map is collapsed -> the Objektliste's own two-line note -> the FIRST building name at y~=760.

So on the device decision-28 exists for, the phone shows: the theme switcher, the language switcher, a sign-out button, and one building name. Theme and language are the two controls a director touches once ever. They are already grouped under 'Konto' in the sidebar's own grouping at desktop width.

Related, same screen, same cause: demo/shoot-ia.mjs reports 175 controls under 44px on /shifts/ at 390px and 12 on /. The row links are 17-20px tall, which is under the 24px minimum as well as the 44px target.

FIX: at 390px, collapse Darstellung + Sprache + Abmelden into one disclosure and put it after the nav, not before the brand. Raise the row-link hit area to at least 44px. Nothing is removed; it moves and it grows.

DO NOT collapse the nav strip into a hamburger as part of this: nine visible destinations on a scrolling strip is a deliberate choice from the IA round and changing it is a separate argument.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 At 390x844 on /, the first building name is above y=560
- [ ] #2 Darstellung, Sprache and Abmelden are all still reachable at 390px, without a page change
- [ ] #3 At 1680px the header is unchanged
- [ ] #4 demo/shoot-ia.mjs reports no control under 44px on / at 390px other than the brand link
- [ ] #5 The count of controls under 44px on /shifts/ at 390px drops below 20
- [ ] #6 Journey D4 (JOURNEYS.md 2.D4, the daily 'is everything running' check): the answer band and at least one Objektliste row are on the first phone screen
- [ ] #7 Journey D5 (JOURNEYS.md 2.D5): a shift row link is tappable at 44px on a phone
<!-- AC:END -->
