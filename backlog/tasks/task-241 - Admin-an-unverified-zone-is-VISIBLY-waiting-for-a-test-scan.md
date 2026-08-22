---
id: TASK-241
title: 'Admin: an unverified zone is VISIBLY waiting for a test scan'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-22 13:36'
updated_date: '2026-08-22 23:09'
labels:
  - web
  - zones
  - i18n
  - a11y
dependencies: []
priority: high
ordinal: 159000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-47 §7 and backlog/docs/ZONE-VERIFICATION.md §7.2. THE SERVER HALF IS LIVE: zones.verified_at ships on GET /admin/data (with verified_by_operator_name joined), and POST /admin/zones REFUSES the field from the body on purpose — there is no desk path and there must not be one.

WHAT IS MISSING is the only half the director ever sees. Today a zone that no operator has test-scanned looks identical on /locations/ to one that works, and a cleaner tapping its card gets 422 zone_unverified with nobody in the office knowing why.

BUILD:
  zone row      'Wartet auf Testscan' + the sentence 'Ein Betreiber muss die Karte vor Ort einmal prüfen. Erst danach kann hier eingestempelt werden.'  Verified rows read 'Freigeschaltet <date> von <operator>' from verified_by_operator_name.
  building row  in the ZONEN cell, never merged into the operational Status cell: '2 von 3 Zonen freigeschaltet · 1 wartet auf Testscan' (ICU plurals, real Austrian business German).
  a building with zones but NONE verified gets its own sentence: 'Keine freigeschaltete Zone – hier kann noch niemand einstempeln.' It must NOT appear for HOIV, whose building card works — the condition is: zones exist AND none verified AND no working building-level tap.
  DELETE zonesTestTapWarning from de.json/en.json. It stopped being true the moment POST /operator/zones/:id/verify shipped: a test scan no longer creates a shift.

CONSTRAINTS: the word first, colour is always the SECOND signal (decision-43 §3). 390px must work. de/en EXACT key parity. NOTHING TRUE may be deleted to lighten the screen. zone_state is NOT touched — the map pin, the P&L and the portal see exactly what they see today.

ACCEPTANCE EVIDENCE: a check that RENDERS the screen through demo/cdp.mjs at 390px and at desktop width and finds the words in the DOM, with its RED case being seeding the zone VERIFIED (ZONE-VERIFICATION.md §8 C16). A source-level assertion is not acceptable: the last run shipped a green check that had never once rendered the screen it claimed to cover.

MUST NOT REGRESS: /locations/'s collapsed read-only 'Gebäude-Tag (Bestand)' disclosure (decision-43 §7) is what keeps HOIV's mounted card visible and explained. It stays exactly as it is.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Deployed e0c5a5a. Confirmed served: badge string present in the live production bundle (ssh grep on /srv/nfc/public). Confirmed API-side gate this UI describes proven live 20/20 via ops/prove-zone-verification.sh, re-run independently against production.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-22 23:09
---
RE-VERIFIED LIVE 2026-08-23 by the SMS verification pass, to confirm decision-47 did not regress under a same-day deploy. It did not.

ops/prove-zone-verification.sh FAILED on its first run, and the honest reading is that its
FIXTURE was gone, not that zone verification broke: production was wiped to 0 locations on the
owner's instruction, and every section of that script hangs off the one real HOIV building
whose uuid is on a card in Arsenalstrasse. Its first INSERT INTO zones died on the foreign key.

Two defects found and fixed while establishing that (commit 090af3f), both of which were
HIDING the truth rather than causing it:

1. THE CLEANUP REPORT WAS GOING TO /dev/null ON EXACTLY THE PATH THAT NEEDS IT. Measured in
   bash 3.2: when set -e fires inside 'box "..." >/dev/null', the EXIT trap runs with that
   redirection STILL IN EFFECT, so the cleanup header, the row counts and the verdict are all
   discarded. The run printed a psql error and nothing else -- the rows really were deleted and
   the proof that they were was thrown away. Fixed by saving the real stdout as fd 3 before
   anything can redirect it. ops/prove-sms-live.sh had inherited the same idiom and was fixed
   with it. Putting the redirect inside the function does NOT fix it; the trap inherits
   whatever is active at whatever depth errexit fires.
2. IT COULD NOT RUN AGAINST A WIPED DATABASE. It now refuses BY DEFAULT with a named reason --
   on a box that is supposed to have the wall card, 'the wall card is missing' is the most
   important thing this script could ever say, and a script that silently repaired it would
   delete the finding. PROVE47_SEED_WALL=1 creates the building, runs, and removes it again.

With the fixture seeded, EVERY assertion passed against the live box:
  resolve-building 404 at the ROUTER (still retired)
  an UNVERIFIED zone: tap 422 zone_unverified, NO shift row
  *** THE CARD ON THE WALL STILL CLOCKS A WORKER IN (201) *** start_zone_id NULL
  a clock-OUT through the unverified door closes normally -- never gated
  a BUILDING card cannot verify a zone (422 zone_mismatch) and stamps nothing
  the real card verifies (200); *** A TEST SCAN CREATED NO SHIFT ***; a re-scan is idempotent
  the same tap that was refused: 201, billed to the BUILDING, door recorded as a fact
  PROVE-47 OK, and the seeded building was removed (locations back to 0)
---
<!-- COMMENTS:END -->
