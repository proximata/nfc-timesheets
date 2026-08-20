# VERDICT-W1-DB — the database, the migrations and the wire, at d43edc1

The W1 verification agent died before writing a verdict. It left four checks on disk
(`check-phone-namespace`, `check-reset-w1`, `check-reach`, `check-field-wire`) and four
scratch databases nobody dropped. This file re-runs all of it, mutation-tests what it
relies on, and answers the five questions the brief asked by name.

**Production was READ ONLY.** One `sudo -n cat` of a nightly backup file
(`/var/backups/nfc/nfc-20260820T000158Z.sql.gz`, 5053 B) and one read-only
`SELECT count(*) FROM schema_migrations`. No write, no migration, no deploy, no restart.
Every measurement below is against a **restored copy in a scratch database on this laptop**,
dropped in §9.

---

## 0 · Verdict

```
006 on production TODAY      ✗ REFUSES. Worker 6 untouched: rate 0, active f. Nothing applied.
                               NOT coerced, NOT dropped, NO wage invented.  ← the right answer
006 → 007 after the ops step ✓ both apply, in order, idempotent, ZERO rows invented, HOIV keeps its pin
the field APK's clock-in     ✓ old-shape open 201 and shipped 3-key close 200, after BOTH migrations
operator has no clock-in     ✓ 401 by session, by forged worker_id, by replayed cookie — and MUTATION-PROVEN
phone collision, DB layer    ✓ IMPOSSIBLE: PK + two UNIQUEs, both spellings, and a held row lock
phone collision, PANEL       ✗ NOT closed. POST /admin/workers takes an operator's number → 201.  D1
the W1 reset                 ✓ twice, on the client's own rows, owner still logs in, no orphans
```

One defect, one methodology trap, one deploy-order fact. §1–§3.

---

## 1 · D1 — the owner's sentence is enforced over `phone_identities`, not over the panel

The owner, verbatim: *"Operator phones and worker phones live in ONE namespace and may
never collide, so the uniqueness has to be enforced by the database, not by a screen."*

The brief asked for three doors and said **all three must fail**. Measured, on a database
restored from the production dump and migrated to 007:

| door | worker takes an operator's number | operator takes a worker's number |
|---|---|---|
| admin API `POST /admin/operators` | — | **409 `phone_claimed`** ✓ |
| the panel's own create path `POST /admin/workers` | **201 CREATED** ✗ | — |
| direct SQL `INSERT INTO phone_identities` | **23505** ✓ | **23505** ✓ |

Both spellings of one Austrian number are ONE identity — `"0664 900 55 01"` and
`"+43 664/9005501"` → `+436649005501`, second claim 409. A concurrent cross-kind race
blocks on the uncommitted row for >250 ms and then loses on `phone_identities_pkey`, so
there is no app-level read-then-write anywhere. All verified.

**The hole, precisely.** `routes/admin.js` has exactly **one** write into
`phone_identities` (line 629, operator create) and **zero** for workers. `POST
/admin/workers` (line 468) runs `v.optionalPhone` — free contact text, deliberately never
normalised — and claims nothing. So:

```
grep -c 'INSERT INTO phone_identities' server/routes/admin.js   →  1   (operator create)
workers rows that ever enter the registry through any route     →  0
```

∴ the registry today contains **only operator claims**. The cross-kind refusal is real in
the DDL and **unreachable through any route**, because no worker row is ever an identity.
`check-phone-namespace.mjs` has to seed the worker side with a raw `INSERT` to test it at
all, and says so.

This is decision-45 §2.3 **as designed**, and `check-phone-namespace` §3 measures it
honestly rather than asserting it away. It is listed as a DEFECT here because the brief's
sentence and the owner's sentence are not yet true of the deployed system, and because the
day it closes is a day nobody has scheduled: `POST /operator/workers` is **absent (404)**,
blocked on `OPERATOR-MODEL.md` §8 / decision-41, which is `proposed`.

**Ceiling, stated:** every worker row created through the panel before that route exists
holds an unclaimed phone string that a W5 SMS login could resolve to two person-rows.
Nothing in the tree will notice.

**Not resolved here** — decision-41 is one of the four the owner still has to rule on.

---

## 2 · The five named questions

### 2.1 What does 006 do to `workers id 6 · TTL Test · rate 0`?

**It REFUSES.** Not coerce, not drop, not deactivate. On the restored production dump:

```
DATABASE_URL=postgres:///vw1_prod node server/db/migrate.js        → exit 1
ERROR:  1 worker(s) have no hourly rate; refusing to invent one.
HINT:   Set every rate on /workers/ (or remove the leftover row), then re-run migration 006.

state afterwards:  schema_migrations = 5
                   zones · operators · phone_identities · location_revenue  ALL absent
                   workers id 6 → hourly_rate_cents 0, active f   (byte-unchanged)
```

`psql -1` aborts the file, `migrate.js` records nothing. It refuses **even though the row is
already inactive and has zero shifts, zero material requests and zero sessions** —
decision-41 §3 has no inactive exemption, on purpose. A wage invented by a migration would
be worse.

Both documented ops branches were then exercised on separate restores:

```
UPDATE workers SET hourly_rate_cents = 1500 WHERE id = 6   → 006, 007 apply. Row survives at 1500.
DELETE FROM workers WHERE id = 6                           → 006, 007 apply. Row gone.
```

The `DELETE` branch is only safe because that row has no history; it also destroys the
unredeemed enrolment code on it. `server/db/README.md §006` already says both.

### 2.2 006 THEN 007 on a restored production dump — order, idempotence, HOIV, boot

Both ops branches, measured identically:

```
schema_migrations                          7 rows, matching migrations/ exactly
applied_at(006) < applied_at(007)          t          ← order, not assumed
re-run migrate.js                          "up to date", 7 rows unchanged
rows invented by 006+007                   zones 0 · location_revenue 0 · operators 0
                                           phone_identities 0 · operator_sessions 0
HOIV                                       48.1761151 / 16.3953038, active t   ← pin survives
```

**The order is convention, not a dependency, and that is fine.** 007 applied ALONE to a
005 schema succeeds — it references `workers`, `admins` and itself, never `zones`. That is
decision-45 §2.1's table boundary doing exactly what it was drawn for. What the order *does*
buy is the deploy-order fact in §3.

### 2.3 The one that costs the client a day: does the field APK still clock in?

`node server/db/check-field-wire.mjs /tmp/nfc-prod.sql.gz` — **OK**, on the real dump, after
**both** migrations, with the wire shape read out of the **APK's dex strings** and not out
of the Kotlin:

```
3 shipped APKs carry:  open {client_uuid, location_uuid, start_time}
                       close {client_uuid, end_time, auto_closed}   ← 3 keys, not 2
field-shape open (the WALL CARD's building uuid)  → 201, start_zone_id NULL
field-shape close (3 keys, auto_closed:false)     → 200
the BUILDING uuid still opens a shift while a live zone exists under it
a replayed open converges: 201 then 200, never 409
auto_closed monotonic THROUGH THE DATABASE: raised by the app, never cleared by a replay
```

And its negative case fires: `sh server/db/check-field-wire-mutants.sh /tmp/nfc-prod.sql.gz`
→ **8 mutants, 8 RED, 0 alive**, tree byte-identical after revert. Including *"006 keeps
DEFAULT 0"*, *"006 adds `workers_rate_positive` NOT VALID"*, *"a building tag is widened to
its first zone"* and *"a replayed open conflicts instead of converging"*.

### 2.4 An operator has no clock-in path

`check-phone-namespace.mjs` §4, on the migrated production restore:

```
operator session + empty body                                  401
operator session + full clock-in naming a REAL worker_id       401
operator session + clock-in naming the operator's own id       401
the operator token replayed in the ts_worker cookie            401
shifts written by any of the above                             0
```

**Non-vacuity, and this is the assertion that matters:** the file mutates the live route
object's `auth` from `"worker"` to `"operator"` and asserts the SAME cookie then gets past
auth (`notEqual(401)`), restores it, and re-asserts the 401. So the four refusals are
falsifiable and it is auth doing the work.

Structural, over the route table rather than a grep: **1** `auth: "operator"` route exists
in the whole tree — `/auth/operator-logout` — and it is nowhere near a shift.

⚠ **Caveat, because "1 route" is thin.** The check's non-vacuity gate is
`operatorRoutes.length > 0`, which one logout route satisfies. There is today **no
operator-facing API surface at all** beyond ending a session; `/operators/` in the web admin
is an ADMIN screen. "An operator cannot clock in" is currently true the way "an operator
cannot do anything" is true. It will need re-proving the day an operator route that writes
something is added.

### 2.5 The W1 reset — see §4.

---

## 3 · The deploy-order fact nobody has written down

One leftover test row blocks **both** bodies of work, not just the zone layer:

```
worker 6, rate 0  →  006 refuses  →  migrate.js exits  →  007 is never reached
                                     (transitively, by lexical filename order)
```

So the operator layer — `operators`, `phone_identities`, `operator_sessions`, the whole of
decision-45 — cannot reach production until a human names or removes that wage. `ops/deploy.sh`
dry-runs first, so this surfaces before any bytes move. Stated so the deploy window is not
the place it gets discovered.

---

## 4 · METHODOLOGY TRAP — a truncated restore looks exactly like a migration defect

Recorded because it cost this session twenty minutes and it will cost the next reader more.

```
psql -f nfc-prod.sql -d scratch | head -5        # ← SIGPIPE kills psql mid-restore
                                                 #   ON_ERROR_STOP never fires, $? is head's
then: migrate.js → ERROR: there is no unique constraint matching given keys
                          for referenced table "locations"
```

That reads as *"006's FK to `locations` is broken"*. It is not. The restore had been killed
before `locations_pkey` was created:

```
SELECT count(*) FROM pg_constraint WHERE conrelid='locations'::regclass AND contype='p'  →  0
```

**Never pipe a restore through `head`/`tail`.** Redirect to a file and grep it.
`check-prod-restore.mjs` and `check-field-wire.mjs` do it correctly (`input:` + captured
stderr) and were green on the same dump throughout, which is what exposed the operator
error.
