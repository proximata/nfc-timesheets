---
id: TASK-18
title: Shifts table view with filters + color coding
status: Done
assignee: []
created_date: '2026-07-28 13:50'
updated_date: '2026-08-25 14:24'
labels:
  - web
milestone: m-3
dependencies:
  - TASK-15
  - TASK-3
priority: high
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Table: worker, building, date, start, end, duration, status. Filters: worker, building, date range, status. Server-side pagination 50/page. Joined view (names not IDs). manualFinish=amber row, needsCorrection=orange row. URL-persisted filters.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All shifts visible with human-readable names
- [x] #2 Filters narrow results, URL-persisted
- [x] #3 Pagination works with >100 shifts
- [x] #4 Color coding visible at a glance
- [x] #5 Sorting by any column
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED 2026-08-25, commit 16c3f4d. VERIFIED 2026-08-25 by an independent pass that re-ran every claim; all 5 acceptance criteria now hold with evidence.

--- WHAT THE IMPLEMENTING RUN SHIPPED -------------------------------------------------

AC3 pagination. /admin/data gained ?offset= (v.optionalOffset, 0..1e6, offset=abc is a 400 not a silent 0). web/lib/api.ts SHIFT_PAGE_SIZE=50; fetchShiftSnapshot sends limit=50&offset=(page-1)*50 only when query.page is set, so the four unpaged callers (/, /payroll/, /workers/, /locations/) are byte-identical. /shifts/ renders a pager and page/sort/dir joined FILTER_KEYS (mandatory: setFilters rebuilds the whole query from filterQuery(), so a param outside that list is wiped on the next filter write).

AC5 sorting. 7 columns (worker, location, start, end, duration, state, origin) via SHIFT_SORT, a LITERAL map looked up by key - the request string never reaches SQL. ORDER BY <col> <dir> NULLS LAST, s.id DESC. Headers are buttons with aria-sort; the direction indicator is a CSS ::after on th[aria-sort] and NOT text, because ResponsiveTableLabels copies thead th textContent onto every card caption under 1280px.

--- VERIFICATION, RE-RUN INDEPENDENTLY ------------------------------------------------

server/check-api.js: 210 ok, 1 FAILED. The failure is 'the REAL SDK payload leaks nothing and lands as ONE trace' (check-telemetry-wire.mjs) and it is PRE-EXISTING, proven not asserted: HEAD~1's own check-api.js, run from a temp copy, gives 203 ok and the SAME single failure. So this commit added exactly 7 tests and broke none. The 7 all pass, including '?offset= walks the whole result set exactly once', 'paging over rows that TIE is still exact', 'every sort key both directions vs an independent JS ordering', 'a malformed offset/sort/dir is a 400', 'shift_blocked_count counts the WINDOW, not the page'.

web: pnpm check OK ('All checks passed'), pnpm typecheck exit 0, pnpm build exit 0 ('Compiled successfully'), pnpm lint exit 0 with ONE standing warning in app/payroll/page.tsx (lint/complexity/useOptionalChain) - a file this commit never touched, therefore pre-existing.

node ops/check-branding.mjs: exit 0, 'check-branding: OK', with its one standing TODO quoted in full - 'iOS is still associated with the RENAMEABLE host schimmer-glanz.exe.xyz, not the permanent tag host timesheets.exe.xyz' (TASK-188, known, untouched by this work).

AC3 ON REAL DATA, not only on a synthetic fixture. check-api seeds 120 rows into a throwaway schema; that is >100 but it is generated. So the SHIPPED ORDER BY + LIMIT/OFFSET was additionally walked over the 348 REAL shift rows in the local nfc_demo database, read-only, page size 50: 14 orderings (7 sort keys x 2 directions), 7 pages each, every one returning exactly 348 rows and 348 DISTINCT ids equal to the full set, with the NULL row (1 running shift) last under both directions for sort=end and sort=duration. Stated plainly: this is the local demo database, NOT production - production row counts were not checked, because this pass is barred from ssh.

THE TIEBREAK IS NOW PROVEN LOAD-BEARING, closing the gap the implementing run honestly flagged (it could only make the guard red by SWAPPING in a nondeterministic tiebreak; merely deleting ', s.id DESC' stayed green on a 60-row seq scan). Re-run on the 348 real rows with tie-heavy sort columns, WITHOUT the tiebreak: sort=origin (2 distinct values) loses/duplicates 3 rows ascending and 4 descending; sort=state (4 distinct values) loses 6 ascending and 3 descending. WITH ', s.id DESC' all four are exact. The tiebreak is not defensive decoration.

AC2 IS NOW TICKED, and it is no longer a code reading. A real Chrome, logged in as the demo admin against nfc_demo, loaded /shifts/?period=all&location=<uuid>&sort=duration&dir=asc&page=2 and then pressed location.reload(). 13 of 13 assertions ok: the address bar survives the mount effect; ONE distinct building on screen; the building <select> shows that uuid; the chip reads 'Objekt: Aerztezentrum Landstrasse'; th[aria-sort]='ascending' on 'Dauer (Std:Min)'; the pager reads 'Seite 2 von 2' with 21 rows (71 shifts = 50 + 21). After the reload every one of those is byte-identical, including the first row's full text. demo/check-filters.mjs independently confirms the other half on the same build: 'every visible row really is that building', 'removing the chip restores every row', 'removing the chip takes the parameter out of the URL too', '?state=unresolved shows ONLY unconfirmed shifts'.

AC4 measured rather than eyeballed: the state colour is border-left-color on the row's first cell, not a background, and the three states are three distinct colours against a transparent normal row - is-open lab(66.73 -5.97 -57.23) 'Laeuft', is-unres lab(74.37 18.25 61.15) 'Nicht bestaetigt', is-corr lab(65.77 26.10 -40.76) 'Korrigiert', normal rgba(0,0,0,0) 'Abgeschlossen'. Colour is never the only channel: every row also carries the WORD.

AC1 seen in the same DOM read: rows render 'Andrea Steiner' and 'Aerztezentrum Landstrasse' as cross-links, not ids.

i18n: 6 new keys in BOTH de.json and en.json with identical ICU placeholders; shifts.truncated deleted from both and grepped for - the only surviving t('truncated') is materialRequests', its own namespace, and useTranslations('shifts') exists in exactly one file.

--- WHAT THIS RUN FOUND THAT THE IMPLEMENTING RUN DID NOT -----------------------------

TASK-269 (filed, high): demo/check-filters.mjs now FAILS at HEAD - 'FAIL /shifts/?location= arrives FILTERED, not merely at /shifts/ - 50 of 50 rows'. It is a STALE ASSERTION, not a broken filter: it asserts shiftsHere < allShifts, and with a fixed 50-row page both sides are 50 for any building with 50+ shifts in the period (the fixture building has 71 of 348). The four assertions after it, which actually test the filter, all pass. Attributable to this commit and worth fixing, but it does not falsify any of TASK-18's five criteria. The implementing run missed it because it ran no browser check.

OPEN, unchanged and still owner-facing: ?shift=<id> is now a SERVER filter, so arriving via a cross-link shows that one row with the drawer open rather than the whole log; the 'Schicht: 123 x' chip is one click back. Necessary at 50 rows a page - otherwise linkedShiftMissing fires falsely and decision-38 rule 3 breaks for every /payroll/ and / cross-link - but a director will notice.

FLAG, not this task's job: decision-38 section 5 still says URL parameters 'never become a server query'. TASK-235 contradicted that and this task extends the contradiction. Needs a superseding decision record.

NOT DONE: not pushed, not deployed, nothing under NFCTimeSheets/ touched, production database never queried.
<!-- SECTION:NOTES:END -->
