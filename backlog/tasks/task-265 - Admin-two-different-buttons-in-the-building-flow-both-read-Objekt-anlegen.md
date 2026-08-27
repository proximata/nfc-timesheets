---
id: TASK-265
title: 'Admin: two different buttons in the building flow both read Objekt anlegen'
status: Done
assignee: []
created_date: '2026-08-24 19:08'
updated_date: '2026-08-27 07:32'
labels:
  - web
  - ux
  - a11y
dependencies: []
priority: low
ordinal: 183000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: admin-web journey, step 'Advance through Step 2 and Step 3 and submit'. Driven live against a local demo stack with the current web/out build.

MEASURED: on /locations/, the header trigger that OPENS the create-building drawer and the drawer's own step-3 SUBMIT button carry the exact same visible text, 'Objekt anlegen'. During the journey the automation clicked the wrong one and nothing happened.

HONEST FRAMING: that specific miss was a scripting mistake, not a trap a mouse user falls into — the drawer is modal and its scrim covers the header trigger. This is filed low on purpose. It is still worth fixing because 'find the control named X' is exactly how support scripts, future browser checks (demo/check-*.mjs), and a screen reader's element list address a page, and all three now see two controls with one name. A screen reader user tabbing the page hears 'Objekt anlegen' twice with nothing to tell them apart.

FIX: rename the drawer's submit button to what it does — 'Speichern' or 'Objekt anlegen und schliessen' — and leave the header trigger alone, since that is the label the owner learns from the empty state. Check the other drawers on /workers/, /operators/ and /clients/ for the same pattern in the same pass; if they already say Speichern, this is just bringing /locations/ into line.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The header trigger and the drawer submit button on /locations/ no longer share a visible label
- [x] #2 The header trigger keeps its current wording; only the submit button changes
- [x] #3 The other create drawers (/workers/, /operators/, /clients/) are checked for the same collision and brought into line if they have it
- [x] #4 de.json and en.json gain or change the same keys with exact parity
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT 2026-08-27 (read-only, re-grepped at HEAD 68743c6).
AC1/AC2: web/app/locations/page.tsx:1161 header trigger renders t('createHeading') = de.json:385 'Objekt anlegen' (header wording intact); drawer submit page.tsx:1876 renders t('submitCreate') = de.json:412 'Speichern'. No shared label.
AC3: same split present on the other create drawers - workers de.json:259 'Mitarbeiter anlegen' / :269 'Speichern'; operators :1201 'Betreiber anlegen' / :1228 'Speichern'; clients :592 'Kunde anlegen' / :596 'Speichern' and :598 'Ansprechperson anlegen' / :608 'Speichern'; inventory :736 'Eintrag anlegen' / :746 'Speichern'. Zero createHeading/submitCreate value collisions.
AC4: web/scripts/check.mjs re-run this audit -> 'All checks passed.' (key-set parity + ICU-argument parity across de.json/en.json).
Verdict: present in current source, not reverted. Status stays Done.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 22:44
---
VERIFIED independently at d11bb36 (web-verify). AC#1: /locations/ header trigger = locations.createHeading 'Objekt anlegen' (page.tsx:1226), drawer submit = locations.submitCreate now 'Speichern'/'Save' (page.tsx:1951) - no shared label. AC#2: git diff of d11bb36 on both message files touches ONLY submitCreate-family lines + one new areaAllUnmeasured key; createHeading/createTitle/newHeading/zoneCreate values byte-identical to d11bb36~1 in de.json AND en.json (diff empty). Empty-state copy that teaches the trigger name is unchanged. AC#3: exhaustive mechanical scan of ALL namespaces for createHeading-family x submitCreate-family value equality in de+en -> 0 collisions. Brought into line: workers, locations, inventory, operators, clients.clientSubmitCreate, clients.contactSubmitCreate. shifts (Schicht nachtragen / Schicht erfassen) and contracts (Neue Vertragsperiode / Neue Periode speichern) already differed, correctly untouched. locations.zoneCreate 'Zone anlegen' vs zoneSubmitStepOne/Two also differ. AC#4: identical keys in de.json+en.json, scripts/check.mjs key-parity + ICU-argument gates pass. Gates re-run by verifier: tsc --noEmit exit 0; biome check exit 0 (1 warning, pre-existing, app/payroll/page.tsx:749, file untouched by this commit); node scripts/check.mjs 'All checks passed'; pnpm build exit 0, 18 routes static. NOTE (not a gap, no action): DE 'Speichern' now also equals workers.rateLimitSave and is shared by both /clients/ drawers - all inside Drawer role=dialog aria-modal=true, so no two same-named controls are ever in one AT context.
---
<!-- COMMENTS:END -->
