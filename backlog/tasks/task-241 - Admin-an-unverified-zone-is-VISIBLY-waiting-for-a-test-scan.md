---
id: TASK-241
title: 'Admin: an unverified zone is VISIBLY waiting for a test scan'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-22 13:36'
updated_date: '2026-08-22 20:48'
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
