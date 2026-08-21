# SCALE PROOF — /shifts/ windowing and /pl/ bulk entry, measured

Written after TASK-235 and TASK-236, against `nfc_demo` grown from 6 buildings / 7 workers /
351 shifts to **8 buildings, 20 workers, 2862 shifts** — the density
`backlog/docs/STATE-OF-THE-PRODUCT.md` itself measures against ("a 20-worker operation
writes ~440-880 shifts a month"). Nothing here touched production.

Reproduce:

```
DATABASE_URL=postgres:///nfc_demo node server/db/migrate.js       # 009 wasn't applied locally
DATABASE_URL=postgres:///nfc_demo node demo/seed-scale.mjs        # +2 buildings, +13 workers, 2 months
DATABASE_URL=postgres:///nfc_demo SEED_MONTHS_BACK_START=3 \
  SEED_MONTHS_BACK_COUNT=4 node demo/seed-scale.mjs               # +4 more months, past the 2000 cap
cd server && DATABASE_URL=postgres:///nfc_demo APP_KEY=demo-key PORT=8092 node server.js &
curl -s -c cookies.txt -X POST :8092/admin/login -d '{"email":"demo@example.test","password":"demo-nur-lokal-2026"}' -H 'content-type: application/json'
```

---

## 1 · The bug windowing actually fixes, reproduced at real volume

`/shifts/` used to fetch `GET /admin/data?limit=2000` with **no `from`/`to`** and filter the
period in the browser — the newest 2000 rows in the WHOLE ledger, regardless of which period
was on screen. At 2862 total shifts that cap bites for real:

```
unbounded fetch (the OLD request /shifts/ made for every period)
  rows fetched:         2000  (shift_limit 2000)
  oldest row in it:     2026-04-06T06:37:00Z
  March 2026 rows in it:   0        <- 410 real shifts, invisible

windowed fetch (the NEW request, scoped to March 2026)
  rows returned:         410
  truncated:            false
  shift_outside_count:  2452
```

**A director opening "März 2026" under the old design got an empty table for a month with
410 real shifts** — indistinguishable from "nobody worked that month," and the old
`outsideCount` (computed only from what the truncated 2000-row payload happened to hold)
would have read **2000**, not the true 2452, while ALSO showing the truncation warning next
to an empty table. Two contradictory signals, both wrong, at once. The new windowed request
answers March correctly regardless of how large the rest of the ledger is.

## 2 · The 2000-row ceiling, truthful at its own boundary — at scale, not just the isolated test

`server/check-api.js` proves this against an isolated worker+location (see TASK-235); here
it is the same fact read off the real seeded ledger:

```
period = 2026 (Jan-Dec), 8 buildings, 20 workers
  real matching rows (SQL count):  2862
  rows returned:                   2000
  truncated (rows.length >= limit): true
  shift_outside_count:              0     <- every one of the 2862 IS inside 2026;
                                              none is "outside", the cap just bit
```

Truncated and "outside the period" are different facts and the response never conflates
them: a period with 2862 matching rows and 0 outside it is reported as **truncated, not
missing** — the correct reading, and the one the old design could not produce because it
never queried by date at all.

## 3 · Windowing vs paging — the decision, on this evidence

| period | real rows | verdict |
|---|---|---|
| `thisMonth` (Aug, partial) | 59 | trivial either way |
| `lastMonth` (July, full month) | 540 | **windowing alone is enough — under the cap** |
| `thisQuarter` (Jul+Aug) | 599 | **windowing alone is enough** |
| `thisYear` (Jan-Aug 2026) | 2862 | **over the cap — truncates, and says so truthfully** |

Windowing wins for the common cases (a month, a quarter) at this density without any new
UI or a second filter mechanism — it reuses `period`, which every cross-link already
carries (`web/lib/filters.ts`). Paging would have needed a NEW parameter (page/offset) that
`filterHref` does not know today, for a case (`thisYear`/`all` at a very large company)
that already has a truthful, tested fallback: report the cap and the count outside it. The
existing `truncated` sentence — "only the newest N loaded" — is still correct and still the
right answer for a ledger that is unconditionally larger than any one screen should render.

**What windowing does NOT fix, stated plainly.** The RENDERED length of a full month at
this density is still real:

```
lastMonth (July, 540 shifts)   540 * 358px / 844px per phone screen  ≈ 229 phone screens
thisQuarter (599 shifts)                                              ≈ 254 phone screens
```

Windowing fixes the FETCH (correctness, and no longer a global 2000-row prize fought over
by every period) and the CEILING message (truthful at 1999/2000/2001, per TASK-235). It
does not fix "540 rows in one scroll," which is a rendering/UX question — already filed as
LOOK-PHONE.md finding #3 — and was not in scope here. Not solved; not claimed solved.

## 4 · `/pl/` bulk entry, measured against the literal 96-cell case

Before: `app_settings` had 0 rows (`pl_margin_baseline_bp` unset) and `location_revenue`
had 8 rows total, covering one building for one month. Every building read
`Nicht beurteilbar`.

```
POST /admin/revenue   {entries: [96 objects]}    8 buildings x 12 months (Sep 2025-Aug 2026)
  HTTP 200, 42ms, 96 entries written — ONE request, not 96 drawer submissions
POST /admin/settings  {key: pl_margin_baseline_bp, value: 0}
  HTTP 200 — the SUGGESTED placeholder value, typed and confirmed like any other

GET /admin/pl?<July 2026>
  baseline_set: true
  8 of 8 buildings now ASSESSABLE (2 flagged, at margin -233bp and -2596bp)
```

The 8 pre-existing rows were not lost: they are `superseded_at`-stamped history now (append-
only, same as every single-cell correction) — `location_revenue` holds 104 rows, 96 live.

## 5 · What this run did NOT do

- **Production was not touched.** Every number above is `127.0.0.1:8092` against
  `nfc_demo`. `ops/deploy.sh` is run separately, after this file, and is its own evidence.
- **No screenshot was taken.** The proof here is the JSON contract (row counts, flags,
  `shift_outside_count`) rather than a rendered page — `pnpm check` / `tsc` / `build` all
  passed for the UI, and `server/check-api.js` covers the same boundary in an isolated
  fixture, but nobody looked at `/shifts/` or `/pl/` in a browser this run.
- **The phone-scroll length of a full month's ledger was not shortened.** See §3.
- **`nfc_demo` was left grown.** It is local demo data; `demo/seed.sql` still rebuilds it
  from scratch on request and TRUNCATEs first, as it always did.
