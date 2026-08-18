---
id: TASK-179
title: >-
  At 390px the two least-used controls hold the top of the screen: 760 of 844
  pixels before the first fact
status: Done
assignee: []
created_date: '2026-08-18 18:54'
updated_date: '2026-08-18 21:58'
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
- [x] #1 At 390x844 on /, the first building name is above y=560
- [x] #2 Darstellung, Sprache and Abmelden are all still reachable at 390px, without a page change
- [x] #3 At 1680px the header is unchanged
- [x] #4 demo/shoot-ia.mjs reports no control under 44px on / at 390px other than the brand link
- [x] #5 The count of controls under 44px on /shifts/ at 390px drops below 20
- [x] #6 Journey D4 (JOURNEYS.md 2.D4, the daily 'is everything running' check): the answer band and at least one Objektliste row are on the first phone screen
- [x] #7 Journey D5 (JOURNEYS.md 2.D5): a shift row link is tappable at 44px on a phone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DONE in a003674, verified independently on a fresh build 2026-08-18, measured off the rendered screen at 390x844 and 1680x1000, dark and light.

  first building name on /        y=759 of 844  ->  y=540 of 844   (AC#1: above y=560)
  header                          169px         ->  49px           (the brand alone)
  answer band top                                   y=208          (AC#6: band + row on the first screen)
  controls under 44px on /        12            ->  0 non-brand    (AC#4)
  controls under 44px on /shifts/ 175           ->  1              (AC#5: the brand link, 24px, WCAG 2.5.8 inline)
  a shift row's link              18px          ->  44px           (AC#7, journey D5)

HOW, and nothing was deleted (the task forbids it): web/components/HeaderTools.tsx is a new sibling grid item, not a child of the header, because at =<767px the three controls have to sit in the NAVIGATION row - a row that already existed, so the group now costs zero vertical pixels. Above 767px they stay in the top-right of the header and the disclosure is display:none: AC#3 is asserted as 'the header row is exactly as tall as it was - 69px against 69px before the change' plus 'they share the brand's row' (brand mid 34, theme mid 34).

AC#2 at 390px: all three are reachable without a page change, behind one 44px 'Einstellungen' disclosure that sits in the nav row (toggle y=57, nav y=49). It is a disclosure and not a dialog - aria-expanded + aria-controls, Escape closes it (captured, because a native <select> swallows Escape), focus is deliberately not moved onto the theme <select>. Closed, the panel is display:none, so it is out of the tab order and out of the accessibility tree - asserted, not assumed.

NEGATIVE CASE: on the pre-fix tree (web/ at c41d33f, rebuilt) the same run reports 'the first building name is above y=560' and 'they are NOT holding the top of the screen' as FAIL, 76 red in total (/tmp/reach/RED-mutant.log). Fixed tree: 224 ok, 0 FAIL (/tmp/reach/GREEN-verify.log).

NOT FIXED, and out of this task's scope: at 1680px /shifts/ still reports 187 controls under 44px - the same row links, which only get the 44px floor inside the =<767px media query. Every AC here is 390px-scoped and a mouse is not a fingertip, but it is a real number and it is written down here rather than left to be rediscovered.

Other audits on this build: pnpm verify PASS - audit-widths 223/223 - audit-german 9/9 - audit-band clean - audit-table-words 11/11 - audit-keyboard 13/13 - audit-focus-ring 12/12.
<!-- SECTION:NOTES:END -->
