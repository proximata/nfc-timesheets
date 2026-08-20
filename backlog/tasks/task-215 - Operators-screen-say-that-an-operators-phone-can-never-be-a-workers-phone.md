---
id: TASK-215
title: 'Operators screen: say that an operator''s phone can never be a worker''s phone'
status: To Do
assignee: []
created_date: '2026-08-20 12:56'
labels:
  - ux
  - i18n
  - operators
dependencies: []
ordinal: 133000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED, this session, on the built screen at 1680 dark/light and 390 dark/light (demo/check-operators.mjs, assertion "the screen says an operator phone cannot also be a worker phone", currently the file's ONE named KNOWN_GAP).

THE STATE OF THINGS. The rule is real and structural: server/routes/admin.js's createOperator claims the number in ONE writable CTE, so phone_identities' primary key raises 23505 and the route answers 409 phone_claimed. Typing worker Anna Berger's claimed number (+436600000004) into /operators/ is refused, the drawer stays open, the phone field is aria-invalid, and the message reads: 'Diese Telefonnummer ist bereits vergeben.'

THE DEFECT IS THAT NOTHING SAYS WHY, ANYWHERE, EVER. Before typing, the only hint under the field is the format one ('Mit 0 oder +43 beginnen…') and the phone preview. After the refusal, the message names no namespace. The director's mental model is pushed the other way by the screen's own 'Auch Mitarbeiter' column, which shows a person who IS both — that person (Nikola Petrovic in the seed) exists because phone_identities carries worker_id AND operator_id on ONE row (OPERATOR-MODEL §3), while the create path this screen owns can only ever INSERT a fresh claim. So the screen shows 'both is possible' and refuses 'both' without explaining that the second half is an admin action, not a re-typed number.

WHAT TO DO. Copy only, both locales, EXACT key parity, no schema and no route change:
 1. web/messages/{de,en}.json operators.phoneHint — add the namespace sentence, e.g. de: 'Eine Nummer kann nur einer Person gehören: eine Nummer, die bereits einem Mitarbeiter gehört, kann hier nicht verwendet werden.' Austrian business German, and it must not promise a merge flow that does not exist.
 2. operators.errorPhoneClaimed — say which namespace is full without saying WHO holds it. Anti-enumeration is deliberate (decision-45 §7, web/lib/api.ts's comment): never name the person.
 3. If the wording claims 'ask an admin to link the existing person', check first: no route builds that (OPERATOR-MODEL §3 says one UPDATE, NOT BUILT). Do not write copy for a button that does not exist.

ACCEPTANCE. 'DEMO_BASE=http://127.0.0.1:8080 node demo/check-operators.mjs' prints STALE-GAP for this assertion and exits 1 — the signal to delete the KNOWN_GAPS entry, after which the run is green. 'cd web && pnpm check' still reports exact de/en key parity. Do not regress: contrast on the note in both themes, and 390px.

NOT DECIDED HERE: decisions 41-44 are still PROPOSED and none is touched — this is two message keys.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 operators.phoneHint states, in both locales, that a number already belonging to a worker cannot be used here
- [ ] #2 operators.errorPhoneClaimed names the namespace without naming the holder (anti-enumeration, decision-45 §7)
- [ ] #3 demo/check-operators.mjs's KNOWN_GAPS entry is deleted and the run exits 0
- [ ] #4 cd web && pnpm check still reports exact de/en key parity
<!-- AC:END -->
