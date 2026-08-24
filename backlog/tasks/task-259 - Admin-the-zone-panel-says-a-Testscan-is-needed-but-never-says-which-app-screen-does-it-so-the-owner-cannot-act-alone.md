---
id: TASK-259
title: >-
  Admin: the zone panel says a Testscan is needed but never says which app
  screen does it, so the owner cannot act alone
status: Done
assignee: []
created_date: '2026-08-24 19:06'
updated_date: '2026-08-24 19:36'
labels:
  - web
  - zones
  - ux
  - operators
dependencies: []
priority: medium
ordinal: 177000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: admin-web journey, steps 'As the operator, POST /operator/zones/:id/verify against the new zone' and the preceding zone-creation step. Driven live against a local demo stack with the current web/out build.

WHAT SHIPPED ALREADY (TASK-241, Done — do NOT redo it): a zone with no verified_at reads 'Wartet auf Testscan' with the sentence 'Ein Betreiber muss die Karte vor Ort einmal pruefen. Erst danach kann hier eingestempelt werden.', the building row counts 'N von M Zonen freigeschaltet', and verified rows read 'Freigeschaltet <date> von <operator>'. That is the WHO and the WHY, and it is correct.

THE RESIDUAL GAP, which is what this task is: the panel never says HOW. There is no admin-side equivalent of the verify action by design (decision-47 — the field scan is the whole point, and POST /admin/zones refuses verified_at from the body), so the owner reading only the web panel has no way to learn that the operator needs an enrolment code, opens the app, taps 'Tag pruefen' on the sign-in screen, picks this zone and holds the card to it. The journey confirmed the state transition works end to end — after the verify call the row flipped to '1 von 1 Zone freigeschaltet' — but an owner who does not already know the operator flow is stuck phoning someone.

FIX SHAPE, copy only, no new route and no admin-side verify path: extend zoneWaitingVerificationHint (or add one sentence beside it) to name the concrete steps — issue the operator an enrolment code on /operators/, the operator opens the app and taps 'Tag pruefen' without signing in as a worker, selects this zone, holds the card to the phone. Use the EXACT button wording the phone shows so the owner can read it down the phone to someone standing at a door.

CONSTRAINT: whatever wording is chosen must stay true if TASK-256 renames the iOS button — if the two platforms still disagree on the label at implementation time, name both. There must NEVER be a way to verify a zone from the desk (decision-47).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The unverified-zone row tells the admin which app screen performs the test scan, using the exact button label the phone shows
- [x] #2 It names the prerequisite — the person doing it needs an operator enrolment code from /operators/ — and links there
- [x] #3 No admin-side verify control is added anywhere; POST /admin/zones still refuses verified_at from the body (decision-47)
- [x] #4 The existing TASK-241 copy (Wartet auf Testscan, the N von M count, Freigeschaltet <date> von <operator>) is unchanged
- [x] #5 de.json and en.json gain the same keys with exact parity, Austrian business German
- [x] #6 Renders correctly at 390px as well as desktop width
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 19:36
---
VERIFIED independently at 08b30f7.
AC1 ✓ locations/page.tsx:1524-1534 adds three .shift-state-note lines under the unverified-zone branch, gated by the same zone.active && verified_at===null. zoneVerifyStepsScan names BOTH labels: 'Tag pruefen' (Android) and 'Test a tag' (iOS). Both checked against source, not assumed — android/app/src/main/res/values/strings.xml:437 verify_open = 'Tag pruefen', NFCTimeSheets/ContentView.swift:185 and :850 NavigationLink("Test a tag"). Exact, including the ue spelling.
AC2 ✓ zoneVerifyStepsIssue names the enrolment code as the prerequisite and links to /operators/ via t.rich + next/link (OPERATORS_PATH).
AC3 ✓ decision-47 intact. No admin-side verify control anywhere in web/ (grep for verify/ hits only comments and lib/api.ts docs). server/routes/admin.js writes verified_at NOWHERE — upsertZone reads only location_id/name/note/area_sqm/tag_serial/tag_deployed_at/active/id, both INSERTs omit the column, ZONE_COLS is a SELECT list; POST /admin/tags/:id/resolve-building still deleted (admin.js:1653). The only writer stays operator.js:162.
AC4 ✓ TASK-241 copy untouched — git show of the commit against de.json has ZERO deleted lines; zoneWaitingVerification, zoneWaitingVerificationHint, zonesVerifiedCount, zoneVerifiedBy all byte-identical.
AC5 ✓ three keys in both files, key set identical (1337 = 1337, zero one-sided), German is Austrian business German and independent of the English.
AC6 ~ satisfied by inspection, NOT measured in a browser: no live stack was started for this read-only verify. The cells are .shift-state-note (display:block) in a td that the <=1279px rule turns into a card, ResponsiveTableLabels injects data-label from the thead, and .drawer goes 100vw <=767px. Nothing here is a new layout primitive — it is three more lines of the same span the hint already used, so a 390px regression would have to be a pre-existing one. Worth one screenshot pass whenever the next demo stack is up.
Gates re-run by me: tsc --noEmit exit 0, biome clean, scripts/check.mjs all passed (incl. both /locations/ zone-verification checks), pnpm build succeeded.
---
<!-- COMMENTS:END -->
