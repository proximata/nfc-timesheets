---
id: TASK-6
title: Write NDEF URI records to NFC tags
status: To Do
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-07-28 14:46'
labels:
  - ios
  - physical
milestone: m-1
dependencies:
  - TASK-4
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Using NFC Tools app, write NDEF URI record https://timesheets.exe.xyz/t?l=<LOCATION_ID> to each blank NTAG213/215 tag. Document tag UID to location mapping.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each tag reads back correct NDEF URI via NFC Tools
- [ ] #2 Tag UID matches registered location
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CONSTRAINT from decision-15: DO NOT LOCK THE TAGS.

NDEF tags are rewritable unless explicitly locked. Not calling the lock API is strictly less
work AND is the migration insurance that makes decision-15 (staying on timesheets.exe.xyz)
a reversible choice instead of an irreversible one. If the host ever moves, a rewrite
piggybacks on normal cleaning rounds - workers already enter every building.

Accepted trade-off, recorded in decision-15: an unlocked tag can be physically rewritten by a
worker to fake which building they are at. Low threat for 5-20 people with an audit trail, and
it requires physical presence at the tag being altered. TASK-3 must still validate the
location ID server-side against the locations table.

URI format: https://timesheets.exe.xyz/t?l=<locationId>   (decision-5: location ID in the URI,
NOT hardware UID. Confirmed correct by Android research - same URI works on Android App Links
with zero tag rewrites.)

BLOCKED UNTIL TASK-4 VERIFIES: both association files must return HTTP 200 with
Content-Type: application/json and no redirect hop. Writing tags before that means physically
revisiting every building to fix them. Run the curl checks in TASK-4 first.

Human-only task - cannot be automated by an agent. Requires physical tags + phone.
<!-- SECTION:NOTES:END -->
