---
id: TASK-174
title: >-
  An uppercased UUID in the address bar says 'unbekannt' instead of finding the
  building
status: Done
assignee: []
created_date: '2026-08-18 09:37'
labels:
  - a11y
  - ia
dependencies: []
ordinal: 92000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED, demo/audit-params.mjs, the only real failure in 60 assertions:

  FAIL an UPPERCASED but otherwise identical uuid still finds its building
       -> 'Objekt: unbekannt - dieses Objekt ist hier nicht vorhanden'

lib/filters.ts:133 accepts the shape case-insensitively and then passes the value through
unchanged:
    const UUID_RE = /^[0-9a-f]{8}-...$/i
    location: location !== null && isUuid(location) ? location : null
The row lookup is a string compare against the lowercase id from Postgres, so a URL that is
correct to any human, and correct per RFC 4122 (hex digits are case-insensitive on input),
resolves to nothing.

SEVERITY: it degrades SAFELY - it says 'unbekannt' out loud and shows no other object's
data, which is the behaviour decision-38 asks for. It is wrong, not dangerous. It matters
because UUIDs get uppercased in transit: Windows and .NET format them uppercase, and so do
several NFC tag writers - and decision-21 puts the location UUID in the tag URI.

FIX: lowercase at the parse boundary in lib/filters.ts, where both isUuid callers are
(location and open). One line, one place - that is what lib/filters.ts is for.

AC
1. ?location=<UPPERCASE uuid> opens the same building as the lowercase form, on every
   screen that reads the parameter.
2. Same for ?open= on /locations/.
3. demo/audit-params.mjs reports 60/60, and the uppercase assertion goes RED if the
   lowercasing is removed.
4. A well-formed uuid that names nothing still says 'unbekannt' - the two wrongs keep their
   two different answers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 an uppercased ?location= opens the same building as the lowercase form on every screen
- [ ] #2 same for ?open= on /locations/
- [ ] #3 audit-params reports 60/60 and goes RED without the lowercasing
- [ ] #4 a well-formed uuid naming nothing still says unbekannt
<!-- AC:END -->
