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

### 2.5 The W1 reset, twice, over the client's own rows

`node ops/check-reset-w1.mjs /tmp/nfc-prod.sql.gz` — **OK**, 11 assertions, AC#8 included:

```
run 0, no flag        REFUSED — worker 6 holds a LIVE enrolment code (expires 2026-08-22)
run 1, with the flag  OK      — -v allow_live_code_loss=1, a deliberate choice, never a default
run 2, no flag        OK      — clean no-op, and it no longer needs the flag
after both            workers locations shifts worker_sessions material_requests
                      location_contracts portal_grants  → all 0
                      admins sessions clients contacts inventory_items app_settings
                      → all UNCHANGED
then                  006 + 007 apply, because the row that blocked 006 was a worker
```

And it refuses with no `-v confirm_database` and with the wrong one — shown refusing.

**Two assertions AC#8 did not make, added this session** (`872f824`), because the brief
asks for login and for orphans and the file proved neither:

- **the login, through the real route, on the reset database.** A control admin with a
  known password is seated BEFORE the wipe and logs in after it: `POST /admin/login` 200,
  the minted `ts_session` opens `GET /admin/data` 200, and the wrong password on the same
  row is still 401. The owner's own row is separately proven byte-identical (md5 over
  `id|email|password_hash|created_at`).
  ⚠ **The one step nobody can run:** the owner's actual password is not in this repo and
  was not typed. What is proven is that his row did not change and that the login path
  works on a reset, migrated database — same table, same query, same verifier.
- **a whole-schema orphan sweep.** Every foreign-key column in `public` is walked and every
  non-NULL value must resolve; the sweep raises on the first orphan. `NOT convalidated`
  was the only orphan assertion before, and it cannot see an orphan seated behind a
  still-VALID key — which is what mutant 3 below does on purpose.

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

---

## 5 · The suite, re-run at d43edc1 — with the real dump, so nothing SKIPs

| check | result |
|---|---|
| `sh demo/check-guards.sh` | OK — 16 refusals, 64 files parse |
| `node server/check-api.js` | **PASS** |
| `node server/db/check-migrate.js` | OK — names 006's refusal and 007's transitive block |
| `node server/check-close-flag.mjs` | 7 pass — **and it still proves nothing on its own** (§8) |
| `node server/routes/wellknown.test.js` | OK |
| `check-prod-restore.mjs /tmp/nfc-prod.sql.gz` | **OK** — no longer SKIP |
| `check-field-wire.mjs /tmp/nfc-prod.sql.gz` | **OK** — no longer SKIP |
| `check-phone-namespace.mjs /tmp/nfc-prod.sql.gz` | **PASS** |
| `ops/check-reset-w1.mjs /tmp/nfc-prod.sql.gz` | **OK** — AC#8 no longer SKIP |
| `gitleaks detect` | 151 commits, no leaks |
| `demo/check-reach.mjs` | **not run** — §7 |

The three dump-fed checks had SKIPped on every previous run on this laptop
(`VERIFY-FINAL §3`). This is the first session in which all of them saw the client's rows.

---

## 6 · Mutation — RED, restore, GREEN. 17 mutants, 17 red

Every assertion this verdict leans on was watched failing first.

| suite | result |
|---|---|
| `sh server/db/check-field-wire-mutants.sh /tmp/nfc-prod.sql.gz` | **8 red, 0 alive**, tree byte-identical |
| `sh server/check-phone-namespace-mutants.sh /tmp/nfc-prod.sql.gz` | **6 red, 0 alive** — new file, `ceb6f2b` |
| `sh ops/check-reset-w1-mutants.sh /tmp/nfc-prod.sql.gz` | **3 red, 0 alive** — new file, `872f824` |
| `ops/check-reset-w1.mjs`'s own generated RED cases | AC#2, AC#3, AC#5 — each red before green |

**One mutant came back ALIVE and the hole is now closed.** `phone_identities_claims CHECK
(worker_id IS NOT NULL OR operator_id IS NOT NULL)` could be replaced with `CHECK (true)`
and `check-phone-namespace.mjs` still passed — the registry's own meaning, *"this number
belongs to someone"*, was unasserted in the file that exists to test the registry. Two
assertions added (`ceb6f2b`) and the mutant is red:

```
INSERT INTO phone_identities (phone_e164) VALUES ('+43…')        → 23514  (claims nobody)
DELETE FROM workers  (the row's only claimant, ON DELETE SET NULL) → 23514, statement ABORTS
```

The second is the sharp one: a CHECK is per-row-immediate, never deferred, so the FK action
and the CHECK fire inside the same statement. That is precisely the fact `ops/reset-w1.sql`
§4 detaches around, and it is now a property of the schema rather than a quirk discovered
inside one ops script.

**Ordering was changed to keep an assertion falsifiable.** AC#8's byte-identical admins
fingerprint is strictly stronger than the login round-trip — a rewritten `password_hash`
fails both — so with the fingerprint first, no mutant could ever land on the login and it
was unfalsifiable. It now runs LAST. Measured: mutant 2 fails at
*"an admin seated BEFORE two resets must still log in afterwards, got 401"*, mutant 1 at the
fingerprint. One assertion each.

Mutant 3 is not a file edit. It seats an orphan behind a foreign key that is still in place
and still `convalidated`, via `ALTER TABLE zones DISABLE TRIGGER ALL` — how a restore, a
bulk load or a hand-edit actually produces one on a real box, and invisible to any
`pg_constraint` query. The sweep raises on it.

---

## 7 · UNOBSERVED — not passes

| what | why |
|---|---|
| **nothing was deployed, and nothing ran on the box** | one `sudo -n cat` of a backup file and one `SELECT count(*)`. `ops/deploy.sh` read, never run |
| **no tap, on any device** | no Android device this session either. Every wire claim here is about dex strings and HTTP, not about a phone in Vienna |
| **`demo/check-reach.mjs`** | a browser geometry check over `web/` screens. Out of this lane by brief (*"touch no web/ file"*), and it needs a built bundle and a fixed Chrome port that a parallel run holds. **Read, not run** — so its three findings are neither confirmed nor refuted here |
| **the owner's actual password** | not in this repo, not invertible from the dump. §2.5 |
| **an operator doing anything at all** | exactly ONE `auth: "operator"` route exists (`/auth/operator-logout`). *"An operator cannot clock in"* is currently true the way *"an operator cannot do anything"* is true, and needs re-proving the day an operator route that WRITES is added |
| **`check-close-flag.mjs` on its own** | still 7 PASS over a `grep` and a JS truth table, never opening a connection — `VERIFY-FINAL` D5 #7, `TASK-205`, unchanged. The flag's real monotonicity is proven by `check-field-wire` **through the database**, and that is the one to trust |
| **`ROUND()` at rates other than 1500 c/h** | untouched this session. `TASK-204` |
| **iOS** | out of scope by brief. Not built, not run, not modified |

---

## 8 · Decisions 41–44 — stated, not resolved

Per brief: **not decided here.** Where this session's evidence sits against them:

```
decision-41  proposed  a worker's rate is REQUIRED and > 0
             → 006 REFUSES production today because of it, over ONE inactive test row (§2.1)
             → and it is what blocks POST /operator/workers, which is what leaves D1 open
decision-42  proposed  revenue is a typed, append-only monthly fact
             → location_revenue applies to the real dump and invents zero rows
decision-43  proposed  zones carry an area — SUPERSEDES the ACCEPTED decision-37
             → two accepted records cannot both stand. Untouched here.
decision-44  proposed  a tag serial is data on a zone
             → zones.tag_serial resolves the mounted EV1 through /roster (check-prod-restore)
decision-45  proposed  operator identity, the phone registry
             → 007 applies; §8's conflict with 41 is REAL and is why D1 is still open
decision-46  the W1 reset order, the backup gate, admins never named
             → rehearsed twice on the client's own rows (§2.5)
```

The concrete dependency the owner should see: **decision-41's ruling decides whether D1
closes.** `POST /operator/workers` supplies a name and a phone and no rate, by
specification; 41 as worded makes that a `23502` on every call. Until it is ruled on, no
worker row can take a registry claim, and the owner's *"may never collide"* stays half
enforced.

---

## 9 · Cleanup — every scratch database dropped, every dump wiped

The dump is a copy of the client's payroll database. So is every restore of it.

**Dropped by this session:**

```
vw1_prod vw1_upd vw1_ord            mine — the three hand-driven restores of §2
w1v_prod w1v_a w1v_b                RESIDUE of the run whose agent died. w1v_prod was a
                                    RESTORED PRODUCTION DUMP sitting on this laptop,
                                    at 5 migrations, carrying the client's admin row.
portal_smoke_69166                  the orphan VERIFY-FINAL §8 asked somebody to drop
```

Every check in this session drops its own databases in a `finally` AND on every early
exit; `ops/check-reset-w1.mjs`'s teardown was changed to `dropdb --force` (`872f824`)
because AC#8 now boots the API and `lib/db.js`'s pool cannot be closed from there — without
it the drop fails on *"other users are connected"*, the warning scrolls past, and a copy of
the payroll survives the run. That is the residue `9072a8e` removed from
`check-prod-restore.mjs`; it would have come straight back.

⚠ **`w1v_prod` refused to drop: it had been marked a TEMPLATE database.**

```
dropdb --force w1v_prod   →  ERROR: cannot drop a template database
SELECT datname, datistemplate FROM pg_database WHERE datname='w1v_prod'  →  w1v_prod | t
```

A restored copy of the client's database, flagged `datistemplate = true`, which is
**`dropdb`-proof and would have survived every routine cleanup on this laptop indefinitely**.
Cleared (`UPDATE pg_database SET datistemplate = false`) and dropped. Worth knowing that
the standard `dropdb --force --if-exists` teardown every check in this tree uses does NOT
remove a database in that state — it fails with a warning, and a warning is not a stop.

**Proof, after cleanup:**

```
SELECT datname FROM pg_database WHERE datname LIKE 'vw1%' OR 'w1v%' OR 'nfc_%'
  OR 'portal_smoke%' OR '%prodrestore%' OR '%phonens%' OR '%resetw1%' OR '%wire_%'
  →  nfc_demo        (the seeded demo database, deliberately kept — nothing else)

find /tmp -maxdepth 1 \( -name 'nfc*' -o -name 'check-reset-w1*' -o -name '*.sql*' \)
  →  (empty)
find ~ -maxdepth 4 -name 'nfc-*.sql*'
  →  (empty)
```

**Wiped:** `/tmp/nfc-prod.sql.gz`, `/tmp/nfc-prod.sql`, `/tmp/check-reset-w1-*.sql`, and
every `/tmp` log this session wrote.

**Left alone on purpose:** `nfc_demo` (the seeded demo database, not client data, and
another lane is using it) and the local role `nfc` (a documented prerequisite, no data).

---

## 10 · What did NOT happen

- **Production was never written.** No migration, no deploy, no restart, no `psql` write, no
  tag written, no APK built or installed, no iOS file modified.
- **No application code was changed.** Every commit this session touches checks, mutants and
  this document. `git status` clean against HEAD for `server/routes`, `server/lib`,
  `server/db/migrations` and `ops/reset-w1.sql`, verified after each mutant suite by the
  suite itself (`git diff --quiet`, and it exits 1 if not).
- **No `web/` file was touched**, per brief.
- **`git add -A` was never used**; every commit stages explicit paths.
- `demo/check-operators.mjs` appeared untracked in the shared worktree mid-session. It
  belongs to a parallel run and was **not staged** — `VERIFY-FINAL` D8, `TASK-210`.
