---
id: TASK-265
title: 'Admin: two different buttons in the building flow both read Objekt anlegen'
status: To Do
assignee: []
created_date: '2026-08-24 19:08'
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
- [ ] #1 The header trigger and the drawer submit button on /locations/ no longer share a visible label
- [ ] #2 The header trigger keeps its current wording; only the submit button changes
- [ ] #3 The other create drawers (/workers/, /operators/, /clients/) are checked for the same collision and brought into line if they have it
- [ ] #4 de.json and en.json gain or change the same keys with exact parity
<!-- AC:END -->
