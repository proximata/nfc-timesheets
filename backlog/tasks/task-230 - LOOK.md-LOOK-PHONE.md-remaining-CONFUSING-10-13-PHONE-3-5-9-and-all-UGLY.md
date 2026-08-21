---
id: TASK-230
title: >-
  LOOK.md / LOOK-PHONE.md remaining: CONFUSING (10/13), PHONE #3/#5-#9, and all
  UGLY
status: In Progress
assignee: []
created_date: '2026-08-21 02:56'
updated_date: '2026-08-21 13:04'
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
VERIFIED LIVE ON PRODUCTION by the verdict pass 2026-08-21, in a real browser against the shipped bundle — not against the source tree. Every one of the nine closed items is green on the box: Betreiber never Operator; a 401 returns to /payroll/?period=2026-07 and says the session expired; 'Erneut versuchen' at 44px on /payroll/ /shifts/ /pl/ /locations/ and it actually reloads; the 12px badge floor; .btn-quiet underlined; .form-error luma 178 >= prose 173; 'Kunde anlegen' singular; the nav strip self-scrolls to 'you are here'; the 390px shell whole (nav 61px, h1 y=122, scrollWidth 390).

STAYS IN PROGRESS. Remainder unchanged: C7, C9, C11, C12, PHONE #3/#8/#9, UGLY U3-U16.

MEASURED THIS PASS FOR PHONE #3, so the remainder has a number on it: /shifts/ at 390px renders FOUR shifts in 2318 CSS px — roughly 0.7 phone screens each. TASK-235 fixed the fetch and the truncation message and explicitly not this. A 20-worker month is 440-880 shifts. That is the first thing a second client will feel.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-21 09:21
---
CLARITY PASS 2026-08-21 (this run) — 9 findings closed, each shown RED then GREEN with a committed, runnable check. Commits, oldest to newest:

23d881c C2  Betreiber/Operator unified — web German now says Betreiber everywhere; pnpm check gained a standing German-never-says-Operator / English-never-says-Betreiber rule (web/messages/*.json values + android strings.xml).
0dd5fe8 C6  401 sends him back to the screen and filters he was on (/login/?returnTo=), not a bare blank form; login.sessionExpired shown only when reached this way. demo/check-login-return.mjs.
43ee1fb C5 / PHONE #5  /payroll/, /shifts/, /pl/, /locations/ each gained a real retry control (new components/LoadStatus.tsx) wired to the screens own load(). demo/check-retry-control.mjs.
c557747 U1 + U5  money/duration columns actually right-align now (.data-table td.col-numeric outranks the old left-align default on specificity); brand stops wrapping to two lines at 1280 (white-space: nowrap, inherited). demo/check-brand-nowrap.mjs; upgraded check-clients-contracts-inventory.mjs own note into a real assertion.
85b4b1c PHONE #6  the phone nav strip scrolls itself to the current entry on every navigation (was stuck at its left edge, Konto sat 300+px off-screen). demo/check-nav-scroll.mjs.
fcecbbc TASK-229 (1)  .form-error is no longer dimmer (luma) than the body text beside it — new --danger-text token, dark theme only. demo/check-form-error-luma.mjs; extended demo/audit-contrast.mjs.
387ac50 C13  Kunde anlegen / Kunde bearbeiten, singular, matching every sibling drawer (was Kunden...). Standing check in web/scripts/check.mjs — its first version was vacuous (wrong flattened key path), caught by re-seeding the bad string and watching it stay green, then fixed for real.
9463672 C10  .btn-quiet row actions get a muted underline so they read as controls, not status text. demo/check-btn-quiet-underline.mjs.
c518ac5 PHONE #7  state pills grow from 11px to DESIGN.md own 12px floor. demo/check-badge-size.mjs.
3d68d34 C8  Am Tag gescannt stops being typeset with the same italic/muted style used for absent values everywhere else on /shifts/. New .shift-origin-tap class. demo/check-tap-origin-not-muted.mjs.

INVESTIGATED, NOT A BUG: U2 (buttons 8px low). Measured directly in a real browser on /inventory/ (the screen LOOK.md cited): a text glyphs rendered top and a same-row buttons box top are ~2px apart, not 8 — the original 8px figure compares a CELLs own border-box top (which is never where content starts, padding exists) against a BUTTONs box top, an apples-to-oranges reading. Screenshot confirms no visible stagger. Left unchanged; a fix here would be styling something that is not actually broken.

STILL OPEN, in LOOK.md/LOOK-PHONE.md own ranking: C7 (tag URI wraps 4x with hyphen ambiguity), C9 (unbekannt next to a euro amount), C11 (/analytics/ never answers its own question — the largest of what is left, needs a total plus ranking, not a style fix), C12 (STUNDEN decimal vs DAUER STD:MIN, two notations for one quantity), PHONE #3 (shifts triage has no tappable control, 39.7 screens — a real feature, not a style fix), PHONE #8 (card transform right-aligns prose), PHONE #9 (client portal wraps short columns), and UGLY U3 through U16 (U1/U2 were the two named as highest-reach; U2 turned out not to reproduce, U1 is done).

Every fix above: seeded the negative condition (git stash on the source file, rebuilt, re-ran the check) and watched it go RED before restoring and confirming GREEN. Full regression after each commit: pnpm check, pnpm lint, pnpm typecheck, pnpm build, sh demo/check-guards.sh, demo/audit-contrast.mjs, and the other demo/check-*.mjs scripts already in the tree — all green. Nothing deployed to production this pass (local nfc_demo plus demo-server.mjs only, per the constraint that production has no meaningful work to break).
---
<!-- COMMENTS:END -->
