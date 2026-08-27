---
id: TASK-6
title: Write NDEF URI records to NFC tags
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-27 07:31'
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
- [x] #1 Each tag reads back correct NDEF URI via NFC Tools
- [ ] #2 Tag UID matches registered location
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit 2026-08-27: AC2 (raw Tag UID matches registered location) is superseded, not a gap - the whole tag/location model moved to zones (decision-43+) where a tag resolves through activePlace() to a zone or building, never a raw UID-to-location compare. Left unchecked deliberately.
<!-- SECTION:NOTES:END -->
