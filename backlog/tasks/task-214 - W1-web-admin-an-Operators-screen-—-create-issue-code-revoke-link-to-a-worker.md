---
id: TASK-214
title: >-
  W1 web admin: an Operators screen — create, issue code, revoke, link to a
  worker
status: Done
assignee: []
created_date: '2026-08-20 07:28'
updated_date: '2026-08-20 14:01'
labels:
  - web
  - operators
  - a11y
dependencies:
  - TASK-212
references:
  - web/app/workers
  - web/lib/nav.ts
documentation:
  - backlog/docs/OPERATOR-MODEL.md
  - backlog/decisions/decision-45
priority: medium
ordinal: 132000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Web-admin-facing half of decision-45. New screen (or a section on an existing one — follow IA-PLAN's object-surface convention, decision-38/39) that: lists operators (name, phone via phone_identities join, active, last enrolment code state); creates one (name + phone, normalised client-side via the same shape server/lib/validate.js's identityPhone enforces, with the server as the actual boundary); issues/revokes an enrolment code, same UI pattern as the existing worker enrolment-code control; shows the 'also a worker' link state read-only (worker name if phone_identities.worker_id is set) — the LINKING action itself (§3's 'operator → also worker' UPDATE) is named as a future one-click action in OPERATOR-MODEL.md §3 and is NOT required by this task.\n\nde/en EXACT key parity (decision-8). 390px must work (this is decision-28's admin-panel-works-on-a-phone territory — an operator screen is disproportionately likely to be opened FROM a phone). Colour is never the only signal for active/inactive or code-live/expired.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 an admin can create an operator with name + phone and see it in the list immediately
- [x] #2 a phone already claimed by a worker or another operator is rejected with a specific, non-enumerating message — not a generic 500
- [x] #3 issuing a code shows it ONCE, exactly like the worker enrolment-code control, and it is unrecoverable after navigating away
- [x] #4 every string has an exact de/en key pair; pnpm check reports 0 parity mismatches
- [x] #5 the screen is usable at 390px: no horizontal scroll, no control clipped
- [x] #6 active/inactive and code-live/expired are distinguishable without colour (checked against audit-contrast.mjs's existing method)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built at commits d925554..da94698 (6 commits: lib/api.ts+lib/phone.ts, messages, page.tsx, nav.ts+workers link, seed.sql, audit scripts). Followed the planning agent's plan; one clarification recorded rather than guessed (Q1: workers.phone/POST /admin/workers left untouched -- decision-45 sec2.3 names that explicitly, and TASK-212 did not touch that route either). Two RED-then-GREEN obligations from the plan discharged live, not asserted: (1) off-nav inbound-link check shown FAILING naming /operators/ before the workers.tsx link was added, then passing; (2) audit-overlays.mjs's census shown FAILING ('app/operators/page.tsx: 2 overlay(s) and NO census row', 87/88) before the census row + auditOverlay() calls were added, then 105/105 green with both operators overlays under the full contract (focus in, role=dialog+name, scroll lock, Tab+Shift+Tab trapped, Escape, focus restored, scroll released). AC2's anti-enumeration symmetry proven both directions against nfc_demo: a phone claimed by a worker-only phone_identities row and one claimed by an operator row produced BYTE-IDENTICAL 409 phone_claimed responses and UI copy (tested via a throwaway phone_identities row, then reseeded to restore the canonical fixture). Proved in the browser per the brief: 1680/390 x dark/light, 0px overflow at every combination (audit-widths.mjs 442/442, up from 420/420); screenshots at /tmp/ts-audit/operators/. Genuine finding, not a bug: TASK-212 built DELETE /admin/operators/:id as a one-way soft delete with no matching reactivate/upsert route (createOperator is INSERT-only) -- unlike workers, a deactivated operator cannot be reactivated through any route this tree builds, and the phone stays claimed forever. The screen reflects this honestly: no 'Wieder aktivieren' button, and deactivateConfirmBody says the action 'cannot be undone from this screen' rather than reusing workers' 'reactivated at any time' line. Flagged for the owner as a product gap, not silently worked around -- fixing it needs a server route, out of this task's (web-only) scope.

--- INDEPENDENT VERIFICATION, v-w1-ui, at 678e4e5 (browser-driven, not re-read) ---
demo/check-operators.mjs now drives the whole screen: 44 assertions green + 1 named gap, and every one of them shown RED by a mutant in demo/operator-mutants.sh (22 mutants, all fire). AC#1 #3 #4 #5 #6 confirmed independently: create → row with +436649009001; a code shown once with focus on the panel and the hash (never the plaintext) in the DB; exact de/en parity via pnpm check, shown red first by deleting one German key; 0 overflow across 11 widths × 2 themes WITH THE DRAWER OPEN, plus audit-phone 28/28 at 390 and 360 including this screen's six positional card captions; greyscale — status and code state are words on every row, and contrast measured on the real DOM (worst 4.93:1 dark, 4.60:1 light).

AC#2 IS CORRECT AS WRITTEN AND STILL LEAVES A REAL GAP → TASK-215. The refusal IS specific and non-enumerating ('Diese Telefonnummer ist bereits vergeben.', on the field, aria-invalid, drawer open, nothing written, no server token on screen). What is nowhere on the screen is WHY: neither the hint nor the refusal says a worker's number cannot be used here, while the screen's own 'Auch Mitarbeiter' column shows somebody who is both. And the obvious fix does not work — the gap-closed mutant wrote the sentence into operators.phoneHint and nothing changed, because help= swaps the hint for the 'Wird gespeichert als: …' preview the moment the number parses. That constraint is in TASK-215's notes.

The reactivation dead end this task flagged for the owner is now filed as TASK-219 rather than left in a note.

Two audits had never loaded this screen at all (it is off-nav): demo/audit-german.mjs and demo/audit-phone.mjs. Both now include it; audit-german also had to stop reading leaf elements only, because every row action here is <button>Deaktivieren<span class=visually-hidden>…</span></button> and its own word was never counted.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New off-nav route /operators/ (decision-39 pattern): create (name+phone via a client mirror of identityPhone), list with Name/Telefon/Auch Mitarbeiter/Status/Zugangscode/Aktionen, issue/reissue/revoke enrolment code (workers' machinery reused verbatim), deactivate behind ConfirmModal with honest irreversibility copy. de/en exact key parity (57 keys x2). 390px proven clean, both themes, both extreme widths, geometry pasted in notes. All ACs verified live against a seeded nfc_demo, not merely written.
<!-- SECTION:FINAL_SUMMARY:END -->
