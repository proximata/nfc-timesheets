---
id: TASK-168
title: 'Objekt einrichten: D1 becomes one thread of four steps instead of four screens'
status: To Do
assignee: []
created_date: '2026-08-18 03:19'
labels:
  - ux
  - ia
dependencies:
  - TASK-160
  - TASK-158
documentation:
  - backlog/docs/JOURNEYS.md
  - backlog/docs/IA-PLAN.md
priority: high
ordinal: 86000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
D1, rank 5, and it STARTS NEXT WEEK. Onboarding a new client today is four screens and the director's memory: create client, create contact, create building (14 fields), then a DIFFERENT screen to record the contract period with the building re-selected from its own table, then back to /locations/ for the tag URI, then back again for the portal link. JOURNEYS.md section 1 D1 marks steps 5, 6, 8 and 9 as broken.

The existing /locations/ drawer already says 'Schritt 1 von 2'. Grow it to four, each step SAVING before it advances (the C1 data-loss bug and its fix are the precedent - pressing Weiter must persist, and audit-overlays2.mjs detects it when it does not):

 1 Objekt + Kunde     name, slug, address, client (inline client and contact creation already exist and work)
 2 Vertrag + Ziel     valid_from, price, target minutes, payer -> writes location_contracts. This is the step that today sends the director to /contracts/ to re-find a building they just created.
 3 Zonen + Tag-URIs   create the zones, render each zone's /t?l=<uuid> verbatim with its copy control, adopt a foreign tag by typing its serial (needs TASK-158). A building with no zones is a valid, normal outcome - do not force a zone.
 4 Kundenlink         mint the portal grant (needs an active contact AND an active building), shown ONCE, with shareExplain stating exactly what the client can see

TWO THINGS THIS SCREEN MUST SAY OUT LOUD:
 - THE VERIFICATION TAP IS AN UNDELETABLE PAYROLL ROW. ScanActivity converges into ACTION_VIEW, so a successful diagnostic read CREATES A SHIFT, and there is no DELETE /admin/shifts/:id anywhere. With N zones that is N test shifts per building. Either the owner's answer to IA-PLAN.md section 8.4 has landed, or step 3 tells the director in words that every test tap must be corrected afterwards. Do not let this be discovered.
 - deactivating a building revokes that building's live client links, and deactivating a CONTACT revokes that person's links server-side - the second one is stated today only in a code comment.

MUST NOT CHANGE: the tag URI carries the UUID and never the slug (decision-21); the portal link is shown once and revocation is irreversible; half-open [valid_from, valid_to) Vienna calendar days with a real calendar check (2026-02-31 is refused; new Date would roll it to 2 March); money in integer cents.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 D1: a director creates a client, a building, its contract period, its zones with their tag URIs and the client portal link WITHOUT leaving the drawer and without re-finding the building in a second table
- [ ] #2 Each step persists before the next is shown: closing the drawer after step 2 leaves a building WITH a contract period, and closing after step 1 leaves a building with NO contract and no half-written row
- [ ] #3 Step 3 accepts zero zones as a normal outcome and the building then behaves exactly as today
- [ ] #4 Step 3 states in words that a verification tap creates a permanent payroll row that must be corrected afterwards
- [ ] #5 Step 4 states what the client can see, shows the link once, and is not offered when there is no active contact
- [ ] #6 de/en exact key parity for every new step, label and warning
<!-- AC:END -->
