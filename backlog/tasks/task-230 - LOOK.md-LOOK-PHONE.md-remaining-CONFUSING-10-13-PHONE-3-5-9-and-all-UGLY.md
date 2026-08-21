---
id: TASK-230
title: >-
  LOOK.md / LOOK-PHONE.md remaining: CONFUSING (10/13), PHONE #3/#5-#9, and all
  UGLY
status: To Do
assignee: []
created_date: '2026-08-21 02:56'
updated_date: '2026-08-21 03:23'
labels:
  - ux
  - web
dependencies: []
priority: medium
ordinal: 148000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
This Fix run closed all 7 WRONG findings (W1-W7), the highest-cost PHONE finding (#1, the nav-strip CSS bug), and three CONFUSING findings (C1 /tags/ unreachable, C3 the 36-char id vs the phone's six, C4 raw server codes) — each shown RED then GREEN with a committed check, per backlog/docs/LOOK.md and backlog/docs/LOOK-PHONE.md. See commits 665b563, 9693b69, 1267c1d, 9e612d6, ba329d6, a732f28, 40fd4d3 on main.

STILL OPEN, in cost order, from the same two documents (read them before starting — every finding already has a file:line, a screenshot reference and a proposed fix; this task is a pointer, not a restatement):

CONFUSING (LOOK.md section 2), not yet touched:
- C2 phone says Betreiber, admin says Operator — a terminology unification across web/messages/{de,en}.json and every operators/* string. Bigger than the others: touches ~15+ message keys plus the heading text.
- C5 offline shows both a red error AND a permanent 'Wird berechnet...', no attached retry
- C6 401 drops the director on a blank sign-in card with no 'Ihre Sitzung ist abgelaufen'
- C7 the tag URI wraps 4x in a 175px column with hyphen ambiguity at the wrap points
- C8 italic means absent everywhere except 'Am Tag gescannt', which is a real value
- C9 'unbekannt' next to a euro amount reads as if it qualifies the amount
- C10 .btn-quiet row actions (Zonen verwalten, Deaktivieren...) look exactly like plain text cells
- C11 /analytics/ never answers 'Wo geht die Zeit hin?' — six rows, no total, no ranking
- C12 STUNDEN (decimal) vs DAUER (STD:MIN) — two notations for one quantity, no unit on the payroll header
- C13 'Kunden anlegen' (plural) for editing exactly one client

PHONE (LOOK-PHONE.md), not yet touched:
- #3 /shifts/ triage has no tappable control; the ledger is 39.7 screens long
- #5 a 500 shows 'failed' and 'loading' at once on /payroll/ and /shifts/, no retry
- #6 only 2/9 nav entries visible on a phone, 'you are here' scrolled off
- #7 the state pill is 11px, below the design system's own stated floor
- #8 a card transform right-aligns prose that should stay left
- #9 the client portal wraps 'Mo.,'/'17.08.2026' and '3:45'/'Std.' mid-token

UGLY (LOOK.md section 3, U1-U16): genuinely cosmetic by the owner's own instruction for this run ('stop when the remaining items are genuinely cosmetic') — U1 (dead .col-numeric right-align rule) and U2 (buttons 8px low on every table) are the two with the most reach if this list is ever picked up.

Also still open, unrelated to LOOK: TASK-180 AC #2/#4 (the zero-BUILDINGS vacuous-0 case on /pl/, /analytics/, /) and TASK-181 (raw geocode status tokens) — both pre-existing, noted here only because they rhyme with W4/C4 and might get picked up in the same pass.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERDICT PASS 2026-08-21 (backlog/docs/STATE-OF-THE-PRODUCT.md, commits 0ece084 / f41b358 / e3bf0e3 / 4c95145) — two entries here are PARTLY STALE and must be re-read before anyone starts.

C5 and PHONE #5, first half: ALREADY FIXED, verified in a browser. demo/verdict-failure.mjs blocks every /admin/* response with Network.setBlockedURLs and reads five screens back. Result: /, /payroll/, /shifts/, /pl/ and /locations/ each show the error and NOT ONE of them still says 'Wird berechnet…' / 'Wird geladen…'. Commit 5456650 (the RELIABILITY run) fixed that half after LOOK.md was written. Evidence: docs/media/verdict/failure/*.png + *.json.

C5 and PHONE #5, second half: STILL TRUE and unchanged. 4 of 5 screens offer NO retry control at all — only / has 'Aktualisieren'. 'versuchen Sie es noch einmal' is an instruction attached to nothing on /payroll/, /shifts/, /pl/ and /locations/. That is the whole of what is left of C5.

NEW, in no report, found in the same photographs: on all five screens the failure sentence is printed TWICE — once as .form-error (red, 14px) and once as an ordinary near-white paragraph (15px) below the filter card. Nothing is misleading; it is said twice, in two weights, and neither copy is a button. Fold this into whatever fixes the retry control.

UGLY re-confirmed by eye on the deployed bundle, not just in source: U1 (every money column left-aligned — 236,25 € and 3.874,51 € share a left edge on /payroll/) and U5 (brand wraps to two lines at 1280) are both live on schimmer-glanz.exe.xyz right now.
<!-- SECTION:NOTES:END -->
