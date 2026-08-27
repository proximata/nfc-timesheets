---
id: TASK-174
title: >-
  An uppercased UUID in the address bar says 'unbekannt' instead of finding the
  building
status: Done
assignee: []
created_date: '2026-08-18 09:37'
updated_date: '2026-08-27 07:49'
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
- [x] #1 an uppercased ?location= opens the same building as the lowercase form on every screen
- [x] #2 same for ?open= on /locations/
- [ ] #3 audit-params reports 60/60 and goes RED without the lowercasing
- [x] #4 a well-formed uuid naming nothing still says unbekannt
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT 2026-08-27, demo/audit-params.mjs on 127.0.0.1:8080 (keyed build, nfc_demo). No app code touched.

AC1 VERIFIED. Section 2b, real stdout:
  ok   fixture: the lower-case uuid DOES name its building - Objekt: Aerztezentrum Landstrasse
  ok   an UPPERCASED but otherwise identical uuid still finds its building - Objekt: Aerztezentrum Landstrasse
  ok   ...and whatever it decides, it never shows another building - upper rows=6 drawer=false . lower rows=6 drawer=false . same objects . same chips
The 'Objekt: unbekannt' answer named in the description is gone.

AC2 VERIFIED FROM CODE, not from a browser assertion - the script has no uppercase case for ?open=. The fix is at the shared parse boundary and both callers go through it:
  web/lib/filters.ts:214  export function toUuid(value: string | null): string | null {
  web/lib/filters.ts:216    return value.toLowerCase()
  web/lib/filters.ts:247    location: toUuid(location),
  web/lib/filters.ts:254    open: toUuid(open),
  web/lib/filters.ts:255    zones: toUuid(text('zones')),
so ?open= and ?zones= are lowercased by the same line as ?location=.

AC4 VERIFIED. Section 3 is ok on all ten screens, e.g.
  ok   /locations/ ?open=<well-formed, names nothing> -> the screen says it is unknown - via=notice notice='Ein Filter aus der Adresse verweist auf einen Datensatz, den' rows=6 (baseline 6)
  ok   /payroll/ ?location=<well-formed, names nothing> -> the screen says it is unknown - via=chip chips=['Objekt: unbekannt - dieses Objekt ist hier nicht vorhanden'] rows=0 (baseline 6)
plus a matching 'no panel opens on another object' for each.

AC3 LEFT UNCHECKED - the run is 59/60, and the one FAIL is the script's OWN self-test, not a parameter defect:
  FAIL self-test: a REAL ?location= really filters - 50 of 50 rows
It asserts real.rows < unfiltered.rows on /shifts/, but /shifts/ pages at 50 rows (web/app/shifts/page.tsx:912 prints '50 von 431'), so filtered and unfiltered both come back at exactly 50 and the assertion can never be green against this seed. That is probe rot from the later pagination work, not TASK-174 - fix belongs in demo/audit-params.mjs (compare the first row / the chip, or use a building with <50 shifts). The mutation half of AC3 was also not run: removing the lowercasing means editing web/lib/filters.ts, which this read-only audit does not do.
NOTE: an earlier run of the same script in this session reported 54/60 with six extra '/shifts/ ... objects differ - missing [] unexpected []' FAILs that did not reproduce on the second run - the /shifts/ shape reads are timing-flaky at the configured settle. Same probe-hygiene bucket.
<!-- SECTION:NOTES:END -->
