# PROBE · data, migration, wire — what is true at f6f7448

Adversarial re-test of the run whose verification agent timed out. Everything below was
measured this session against a **fresh production dump taken read-only** (`sudo -n -u
postgres pg_dump nfc`, 2026-08-20 01:53 UTC) restored into throwaway local databases.
`backlog/docs/RECON.md` was treated as claims to re-test, not as findings to repeat.

**Production was never written to.** One `pg_dump`, one `sudo -n cat` of the newest backup,
one `psql -Atc SELECT`. No migration, no deploy, no schema change. Every scratch database
was dropped and every dump wiped — proof in §8.

---

## 0 · Verdict

```
006 on the real database        ✓ REFUSES, then applies, twice, inventing zero rows
HOIV's pin                      ✓ survives 006 byte for byte  48.1761151/16.3953038
the field APK's clock-in        ✓ 201 after 006, zone NULL, and still 201 once the
                                  building HAS a zone — which nothing tested before
the field APK's CLOSE           ⚠ the shape everything asserted was NOT the shipped one
a rate-less worker              ✓ unrepresentable through every path that can write one
'hours that cost nothing'       ✗ still reachable — by ROUNDING, not by a missing rate
check-close-flag.mjs            ✗ 7 PASS over a line no code path can execute
check-prod-restore.mjs          ✗ died with a Node stack trace on a clean machine  (fixed)
```

Two defects were fixed here (`9072a8e`), two were filed (TASK-204, TASK-205), and one new
check plus its mutant runner were added (`fc730d5`).

---

## 1 · The dump, and what it says

```
source   sudo -n -u postgres pg_dump nfc          (read-only, 2026-08-20 01:53 UTC)
cross    /var/backups/nfc/nfc-20260820T000158Z.sql.gz   — same shape
state    5 migrations · 1 location · 1 worker · 0 shifts · 0 worker_sessions
```

`locations` — one row, and it is the tag on the wall:

```
c3c37d4a-ca0a-42c5-b248-9704b9907ec7  HOIV  Arsenalstrasse 11  48.1761151/16.3953038  active
```

`workers` — one row, and it is the blocker:

```
id 6 · TTL Test · hourly_rate_cents 0 · active f · created 2026-08-17
        + a LIVE unredeemed enrolment code hash, expires 2026-08-22
```

**RECON's claim is confirmed exactly.** The row 006's guard was written for is in
production right now.

---

## 2 · What 006 does to `TTL Test` — REFUSE

Not coerce, not drop, not deactivate. Measured three ways against the real dump:

```
node server/db/migrate.js                 ERROR  1 worker(s) have no hourly rate;
                                                 refusing to invent one.
                                          HINT   Set every rate on /workers/ ...
node server/db/migrate.js --dry-run       migrate --dry-run: 006 does NOT apply.
                                                 Nothing was written.                exit 1
after the refusal                         to_regclass('zones') IS NULL → t
                                          count(schema_migrations)     → 5
```

`psql -1` aborts the file, `migrate.js` records nothing, the database is byte-identical.
This is the correct behaviour and it is worth saying plainly: **a wage invented by a
migration would be worse than a migration that refuses**, and 006 refuses.

Then, after the documented ops step (`server/db/README.md §006`) on the scratch copy:

```
applied 006_zones_revenue_rates.sql       zones 0 · location_revenue 0 · shifts touched 0
re-run                                    up to date
locations after == locations before       id|name|active|lat|lng identical
HOIV                                      HOIV @ 48.1761151/16.3953038
API boots on the result                   /health 200 · /roster 200
```

⚠ Not in the runbook: `TTL Test` carries a **live enrolment code** expiring 2026-08-22. The
README's two options are `UPDATE ... SET hourly_rate_cents = 1500` or `DELETE`. Either is
fine — but whoever runs it should know they are also destroying an issued code, not only a
placeholder row.

---

## 3 · THE ONE THAT COSTS A DAY — the close body has three keys

`check-prod-restore.mjs` closes with `{client_uuid, end_time}` and its own comment calls
that *"the SHIPPED build's shape"*. **It is not.**

```
android/.../core/Wire.kt   CloseShiftRequest(clientUuid, endTime, autoClosed: Boolean)
                           Wire.obj(... "auto_closed" to autoClosed)   ← non-null, always emitted
```

And in the binaries, not in the tree — dex strings from all three APKs on disk:

| apk | open keys | close keys |
|---|---|---|
| `app-debug.apk` (Aug 11, the field build) | `client_uuid` `location_uuid` `start_time` | + `auto_closed` |
| `nfc-timesheets-0.2.0-3-release.apk` | same | + `auto_closed` |
| `nfc-timesheets-0.3.0-4-release.apk` | same | + `auto_closed` |

So the request the check has been proving is one **the phone has never sent**. Re-tested
with raw body strings, against the migrated real dump:

```
{"client_uuid":…,"location_uuid":"<HOIV>","start_time":…}                       → 201  start_zone_id null
{"client_uuid":…,"end_time":…,"auto_closed":false}                              → 200  auto_closed false
{"client_uuid":…,"end_time":…,"auto_closed":true}                               → 200  auto_closed true
replay of the open (offline queue)                                              → 200  duplicate, same id
replay of the close                                                             → 200  idempotent
```

✓ The old-shape clock-in survives 006, and so does the close the APK actually makes.

**Two traps found while proving it, both in the harness rather than in the product:**

- `end_time` beyond `now + 5 min` is `422 timestamp_in_future` (`CLOCK_SKEW_MS`,
  `lib/validate.js:8`). A fixture that closes "an hour later" tests the skew guard and
  nothing else. Correct behaviour; easy to mistake for a 006 regression.
- One node process cannot boot the API against two databases. `lib/db.js` builds its pool
  from `DATABASE_URL` at **import** time and the ESM cache hands the same module to the
  second `createServer()`, so the second server silently keeps talking to the first
  database and every request 401s on a session that is in the other one.

---

## 4 · The wall tag, and the mounted foreign tag

```
building uuid  c3c37d4a-…                → 201   location_id = building, start_zone_id null
serial         04:A1:A8:52:AE:5C:80      → storable on a zone, shipped verbatim by /roster
resolved zone id                         → 201   billed to the BUILDING, start_zone_id set
raw serial posted as a place             → 400   a serial is not a credential (decision-44 §3)
```

**The ordering nobody had tested.** `check-prod-restore.mjs` taps the building uuid FIRST,
then creates the zone, then deletes it before the file ends. So the state that matters on
the day a second tag goes on that wall — a **building tag against a building that already
has a live zone** (ZONES-MODEL §11 risk 3) — was never exercised. Tested now:

```
zone 'Stiege 1' live under HOIV  →  POST /shifts/open with the BUILDING uuid  → 201
                                    start_zone_id null (NOT silently widened to the zone)
```

✓ The wall card outlives its own building's zoning. The two mutants that would break it —
a zone predicate on the building branch of `activePlace`, and "resolve a building to its
first zone" — are both in the mutant runner and both go red.

---

## 5 · Is the rate genuinely required? — yes, and the deleted copy stays deleted

Every path that can write a `workers` row, on the migrated real dump:

| path | result |
|---|---|
| `INSERT` omitting `hourly_rate_cents` | `23502` — because 006 **drops the DEFAULT** |
| `INSERT` explicit `NULL` | `23502` |
| `INSERT` `0` / `-1` | `23514 workers_rate_positive` |
| `UPDATE` an existing worker to `0` | `23514` |
| `POST /admin/workers`, rate absent / null / "" / 0 | `422 rate_required`, field named |
| `POST /admin/workers`, rate `-5` / `"zwanzig"` / `1.5` | `400 invalid_field` |
| edit an existing worker's rate to ""/0/null | `422`, and the old wage is left intact |
| `server/db/seed.sql`, `demo/seed.sql` | both name a rate explicitly |
| any import | **there is none** — `grep -rn "INSERT INTO workers"` outside checks returns only the two seeds |
| `DELETE /admin/workers/:id` | SOFT (`active = false`), so no shift is ever orphaned from its rate |

Two properties easy to assume and now asserted rather than assumed:

```
workers_rate_positive convalidated = t     not NOT VALID — existing rows were checked
pg_attrdef for hourly_rate_cents  = 0 rows the DEFAULT 0 really is gone
```

**Verdict on the deleted `Kein Stundensatz` copy: it stays deleted.** Its cause — a worker
with no wage — is unrepresentable through every path above.

**But the sentence it backed is still falsifiable, by a different cause.** See §6. Deleting
copy about a MISSING WAGE was right; it does not license the broader claim that no building
can report hours that cost nothing.

---

## 6 · `labour_seconds = 1, labour_cents = 0` — measured

`lib/reporting.js` rounds **once per (location, worker) per period**:

```sql
SUM(secs) per worker  ->  SUM(ROUND(secs * hourly_rate_cents / 3600.0))
```

At 1500 c/h, one second is `ROUND(0.4167) = 0`.

Reachable through the field APK's exact wire shape, not only by SQL — tap in, tap out one
second later (wrong door, a normal thing for a cleaner to do):

```
POST /shifts/open   201
POST /shifts/close  200
                    labour_seconds = 1   labour_cents = 0
```

`check-api.js` already asserts the invariant this violates
(`b.labour_seconds > 0 → b.labour_cents > 0`). It passes **only because no fixture ever
totals one second** — a check whose negative case is absent from its own data. Filed as
**TASK-204** with the seeding step as its first acceptance criterion.

---

## 7 · Two checks that were not checking

### 7.1 `check-close-flag.mjs` guards an unreachable line — TASK-205

It greps `routes/app.js` for `auto_closed = auto_closed OR $3` and then evaluates a JS
truth table of `||`. It never opens a connection. 7 PASS.

There are exactly **two** writers of `shifts.auto_closed` in the tree, and both set
`end_time` in the same statement that raises the flag:

```
ops/sql/autoclose.sql  SET end_time = start+8h, auto_closed = true  WHERE end_time IS NULL
routes/app.js:292      SET end_time = $2, auto_closed = auto_closed OR $3
                       WHERE … AND end_time IS NULL
```

∴ `end_time IS NULL AND auto_closed` never exists ∴ on every row that UPDATE can match the
left operand is false ∴ `auto_closed OR $3` ≡ `$3`.

Measured: mutate the OR away → `check-api.js` **PASS**, `check-field-wire.mjs` **PASS**;
only the grep goes red. What actually protects the flag is the idempotent-close early
return at `app.js:270` — a replayed tap-out never reaches the UPDATE. That is now asserted
against the database, and its mutant needs three simultaneous edits precisely because the
three guards stack.

### 7.2 `check-prod-restore.mjs` died on a clean machine — fixed at `9072a8e`

A production `pg_dump` carries `ALTER TABLE … OWNER TO nfc` 22 times, so restoring it needs
a local role `nfc`. On a laptop that has never run the demo stack there is none, psql exits
3, and the file printed a raw `ERR_MODULE` stack — which an operator standing in front of a
migration window reads as *"the tooling is broken"*, not as *"one `createuser` away"*.

Now: `FAIL … the dump needs a local role "nfc" … fix: createuser nfc`, exit 1. **FAIL and
not SKIP** — once a dump has been handed to the file, exit 0 is the worst possible answer.

Both files also drop their throwaway databases on the early exit path. `process.exit()`
does not run a pending `finally`, so a **failed** pre-deploy check used to leave a restored
copy of the client's payroll on the laptop — the one artefact both headers promise not to
leave.

---

## 8 · The deploy window no health probe can see

HEAD's `v.activePlace` SELECTs from `zones`. Booted against the schema production has
**today** (005, from the real dump):

```
GET  /health        200   ← it only runs SELECT 1
GET  /roster        500   relation "zones" does not exist
POST /shifts/open   500   relation "zones" does not exist        0 rows written
```

`ops/deploy.sh` already migrates (step 5) before it restarts (step 6), and step 0a/0b now
stage and dry-run the migration before anything moves, so the ordering is right. The
residual window is a crash or a reboot between the step-3 code rsync and the step-5
migration. It is small. What matters is the shape: **`/health` cannot see it. Only a
cleaner can.** Asserted in `check-field-wire.mjs` so it stays true.

---

## 9 · What was added, and its negative case

```
server/db/check-field-wire.mjs          the five things check-prod-restore leaves unproven
server/db/check-field-wire-mutants.sh   8 mutants against SOURCE, every one shown RED
```

The wire keys are read out of the **dex**, not out of the Kotlin: a check that reads the
source proves the tree agrees with itself, and the phone in Vienna runs an August binary.

```
RED   the three guards that keep a replay from clearing auto_closed, removed together
RED   the building branch of activePlace demands a zone
RED   a building tag is widened to its first zone
RED   006 keeps DEFAULT 0 on hourly_rate_cents
RED   006 adds workers_rate_positive NOT VALID
RED   006 allows a rate of exactly 0
RED   a replayed open conflicts instead of converging
RED   /roster drops zones[]

mutants: 8 red, 0 alive       tree byte-identical afterwards (git diff --quiet)
```

Mutant 1 carries three edits **on purpose**, and that is §7.1's finding in executable form:
any single edit is masked by the other two.

The role fix was also shown red — `dropuser nfc` → both files exit 1 with the one-line fix
and **zero leftover databases**; `createuser nfc` → both green.

---

## 10 · Suite re-run, and cleanup

| check | result |
|---|---|
| `server/check-api.js` | PASS |
| `server/check-close-flag.mjs` | 7 pass, 0 fail — **only from the repo root**; it reads `server/routes/app.js` as a relative path and stack-traces from inside `server/` |
| `server/db/check-migrate.js` | OK |
| `server/db/check-prod-restore.mjs` | OK against the fresh dump |
| `server/db/check-field-wire.mjs` | OK (new) |
| `sh demo/check-guards.sh` | OK — 16 refusals, 64 files parse |

---

## 11 · What did NOT happen, and what could NOT be tested

- **Production was not written to.** `pg_dump`, `cat`, `SELECT`. Nothing else.
- **006 was not applied anywhere but throwaway local databases**, all dropped.
- **No `web/` file was touched.** Not one edit, not one staged path.
- **No deploy, no APK installed, no tag written, no iOS file read.**
- **`git add -A` was never used.** Every commit staged explicit paths.
- **A concurrent agent's uncommitted mutant was observed in the working tree**
  (`web/app/pl/page.tsx`, `t('revenueUnknown')` → `money(0)`, mtime 03:58, one minute
  before it was seen). It was **deliberately left alone** — reverting another run's
  in-flight mutation destroys its evidence — and it had reverted itself by the next commit.
  It is recorded because a `git add -A` in that minute would have shipped decision-42's
  exact violation.
- **`ROUND()` was tested at 1500 c/h only.** The floor at other rates in the collective
  agreement's range is arithmetic, not measurement, and is left to TASK-204.
- **No zone-aware APK exists to test against**, so "the phone posts the zone id it
  resolved" is proven at the wire and in `core/Zones.kt`'s JVM checks, never on a device.
- **`ops/deploy.sh` was read, never run.** The 500-on-005 finding is about the shape of the
  window, not a claim that the current script opens it.
- **A leftover scratch database from an earlier run was found on this laptop**
  (`portal_smoke_69166`). It was NOT dropped — it is not this run's, and dropping another
  run's database is the same mistake as reverting its mutant. Somebody should.

---

## 12 · Provenance — this file was committed by somebody else's commit

This document, TASK-204 and TASK-205 were `git add`ed by this probe and then committed by a
**concurrent agent** as part of `6757082 "Nothing asserted that the payroll screen and the
server aggregate agree"`, alongside `demo/check-money.mjs`, which is not this run's work.
Nothing was lost; the message is simply not about most of what the commit contains.

Recorded rather than repaired. Rewriting that commit means rebasing under other runs that
are committing into the same branch right now, which trades a wrong commit message for lost
work — the exact failure `AGENTS.md` describes.

The hazard it names was observed **twice in one hour** on this tree:

```
03:58  web/app/pl/page.tsx held another run's live mutant
       t('revenueUnknown') -> money(0)   = decision-42's exact violation, uncommitted
04:2x  three files staged by this run were swept into another run's commit
```

Staging explicit paths is necessary and **is not sufficient**: the index is shared. Two
agents cannot both hold a staged index in one working tree. If runs are to overlap, they
need separate worktrees, not discipline about `git add`.
