# server/db — Postgres schema & migrations

Postgres 16, local to the exe.dev VM (unix socket / `127.0.0.1` only, never publicly
bound — decision-16, runbook §1). `pg` is the API's client; this directory only needs
`psql`.

```
migrations/001_init.sql   canonical schema — workers, admins, sessions, locations, shifts
migrations/002_worker_identity.sql   apple_sub/email + worker_sessions (decision-22)
migrations/003_clients_contracts_inventory.sql   clients, contacts, inventory_items,
                          portal_grants, workers.phone, locations contract columns
migrations/004_worker_enrolment_codes.sql   workers.enrolment_code_* (decision-26)
migrations/005_v2_features.sql   material_requests, location_contracts, app_settings,
                          locations.geocoded_at / geocode_status / street_view_status
migrations/006_zones_revenue_rates.sql   zones (+ area, tag_serial), location_revenue,
                          shifts.start_zone_id / end_zone_id, a worker rate that cannot be
                          zero (decisions 41, 42, 43, 44)
migrate.js                runner: applies migrations/*.sql once each, in lexical order
seed.sql                  DEV ONLY sample data
check-migrate.js          runnable check (see bottom)
```

## Connection

Everything reads `DATABASE_URL`. On the VM it comes from the systemd unit's
`EnvironmentFile` (runbook §5); locally, export it yourself.

The database and role are both named `nfc` — the same name the systemd units
(`ops/systemd/nfc-autoclose.service`) and the backup scripts (`ops/backup/*.sh`) hard-code.
Do not rename one without the others.

```sh
export DATABASE_URL="postgres:///nfc"                    # local unix socket
export DATABASE_URL="postgres://nfc:PW@127.0.0.1/nfc"     # VM
```

`postgres:///name` (three slashes, no host) means "default local socket, current OS
user". That's the peer-auth path the VM uses for `sudo -u postgres`.

## 1. Create the database

Local dev (Homebrew Postgres, peer auth, you are the superuser):

```sh
createdb nfc
```

VM (runbook §2 — role owns the database, API connects as that role, never as
`postgres`):

```sh
sudo -u postgres createuser --pwprompt nfc
sudo -u postgres createdb -O nfc nfc
```

Store the resulting URL with `psst tag DATABASE_URL server prod` (runbook §3). Never
commit it.

## 2. Run migrations

```sh
DATABASE_URL="postgres:///nfc" node server/db/migrate.js
```

Output is one line per newly applied file, then `N migration(s) applied` or
`up to date`. Safe to run on every deploy — already-applied files are skipped.

Applied files are tracked in `schema_migrations (filename, applied_at)`. Each file is
applied together with its bookkeeping row inside a single transaction (`psql -1`), so
a failed migration leaves nothing behind.

## 3. Seed (dev only)

```sh
DATABASE_URL="postgres:///nfc" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/db/seed.sql
```

3 workers, 3 real Vienna addresses (1010 / 1070 / 1020) with lat/lng. Idempotent.
`seed.sql` lives outside `migrations/` on purpose — `migrate.js` will never apply it,
so it can never reach production by accident.

## Adding a migration

1. New file `migrations/00N_short_description.sql`. Number is zero-padded and
   monotonic; lexical sort *is* the apply order.
2. **No `BEGIN` / `COMMIT` inside the file** — the runner already wraps it.
3. Never edit a migration that has shipped. There are no checksums; an edited file
   is silently ignored on machines that already applied it. Write a new one.
   (`001_init.sql` was rewritten in place for decision-19/20/21 — legal exactly once,
   because nothing had shipped and no database held data.)
4. Run `node server/db/check-migrate.js` before committing.

## Schema notes

- `locations.id` is a **UUID** and is what the NFC tag's NDEF URI carries
  (`https://timesheets.exe.xyz/t?l=<id>`, decision-5 + decision-21). Random, so tag
  identifiers are not guessable. `locations.slug` is human-readable and exists for the
  admin UI and log lines **only — a slug must never appear in a tag URI.**
  Tags are left **unlocked** (decision-15), so the value off the tag is still untrusted
  input: resolve it server-side and reject unknown or inactive locations. Unguessable
  is not authenticated.
- `shifts.client_uuid` is UNIQUE. It's the iOS app's idempotency key for **both**
  `POST /shifts/open` and `POST /shifts/close` (decision-19), so a retry over a flaky
  network can't double-bill.
- `shifts.end_time IS NULL` means the shift is still open. Under decision-19 the app
  posts the shift at clock-**in**, so open shifts genuinely exist server-side and the
  8h safety net is reachable. `shifts_open_idx` is a partial index over exactly that
  set; the auto-close systemd timer (decision-10, decision-16) and
  `GET /shifts/unresolved` both ride it.
- `shifts_one_open_per_worker_idx` is a partial **UNIQUE** index on `(worker_id)
  WHERE end_time IS NULL`: at most one open shift per worker. A double-punch at the
  door raises `unique_violation` (SQLSTATE `23505`) instead of creating two concurrent
  open shifts; the API turns that into "already clocked in". Partial, so completed
  shifts are unconstrained (several per day is normal).
- Two independent flags, never one (decision-10):
  `auto_closed` = the 8h timer closed it, no human involved;
  `corrected_at` = a human resolved it (NULL = unresolved). Unresolved is exactly
  `auto_closed AND corrected_at IS NULL`. The old `manual_finish` / `needs_correction`
  columns are gone — `manual_finish` was written by both the timer and by worker
  resolution and so could not tell them apart.
- `admins` + `sessions` back the web-admin password login (decision-20). The
  `X-Admin-Pin` header is gone. `password_hash` holds a full PHC string; `sessions.token`
  is API-generated random and is the primary key, so logout can actually revoke.
  Sweep with `DELETE FROM sessions WHERE expires_at < now()` (`sessions_expires_at_idx`).
- Money is `INTEGER` cents (`workers.hourly_rate_cents`, `locations.monthly_contract_cents`,
  `inventory_items.unit_cost_cents`) and time is `INTEGER` minutes
  (`locations.target_minutes_per_month`). No floats, no `NUMERIC` for money: actual hours vs
  target and contract revenue vs labour cost have to be exact subtractions.
- **003 is additive only** — 001 and 002 are applied on the live box with real shifts in
  them. Every column it adds is NULLable or has a DEFAULT, because rows that predate a
  column cannot supply a value. `check-migrate.js` proves this on a second throwaway
  database: 001 + 002 + live rows, then 003.
- `clients` = the company holding the contract; `contacts` = a human at that client.
  **`contacts.email` is NOT a login credential** — there is no password, no session and no
  auth path that reads it. Client access is a shareable link (`portal_grants`).
- `inventory_items` holds products AND equipment in one table, separated by `kind`. Two
  tables would mean two admin screens to model a one-word distinction.
- `portal_grants.token_hash` is the primary key and stores **SHA-256(token) only**, via the
  same `hashToken` helper as `sessions`/`worker_sessions`. `portal_grants_one_live_idx` keeps
  at most one live link per (contact, building); revoking is an `UPDATE revoked_at`, never a
  delete. `GET /portal/:token` answers 404 identically for revoked and unknown tokens and
  discloses only building name, date, worker FIRST NAME and minutes (GDPR minimum).
- **A shift with `client_uuid IS NULL` was typed into the admin panel** (`POST /admin/shifts`,
  for the worker whose phone died). Every phone-originated shift carries an idempotency key,
  so no separate "added by hand" flag exists to drift out of agreement with that.
- **005 is additive only**, like 003 and 004: 001-004 are applied on the live box with real
  shifts in them. `check-migrate.js` proves 005 lands on a database that already holds a
  worker, a building with a contract figure, a building without one, a closed shift and an
  open one.
- `material_requests` is the worker's own words plus an explicit lifecycle
  (`submitted -> approved -> ordered -> arrived`, with `rejected` reachable from the first
  two; `arrived` and `rejected` are terminal). `ordered_at` **pins the period a cost belongs
  to**, so a late invoice correction changes the amount without moving the spend to another
  month. `cost_cents IS NULL` means *unpriced*, which is not *free*: the P&L leaves it out of
  the pool and reports how many it left out.
- **`material_requests.location_id` is context, not a cost attribution.** It records the
  building the worker named, which is the one thing they actually know. decision-6 splits
  material cost pro-rata by labour hours and explicitly rejected "worker assigns to building"
  ("nobody will do it"). Anything that starts charging `cost_cents` to `location_id` is
  overturning decision-6 and needs a new decision record first.
- `location_contracts` gives a building a **period-scoped price**, so a March P&L uses the
  March price. `valid_from`/`valid_to` are Vienna calendar `DATE`s, half-open, `valid_to NULL`
  = current, at most one current per building (partial UNIQUE index). `valid_to >= valid_from`,
  not `>`: a zero-length row is the honest record of a price entered and cleared the same day.
  `client_id` is stored, not derived — `locations.client_id` is current-only, and "who was
  paying in March" is exactly what history has to answer.
- `locations.monthly_contract_cents` / `target_minutes_per_month` survive as a **mirror of the
  current contract row**, so `/locations/`, `/reinigung/` and the shipped iOS build need no
  change. `routes/admin.js` is the only writer and `check-api.js` asserts they never disagree.
  Two sources of truth are only safe when one is derived and something fails loudly when it
  drifts.
- `app_settings` **ships empty on purpose**. `pl_margin_baseline_bp` (margin floor, basis
  points) has no default row: nobody has said what "ineffective" means for a Viennese cleaning
  contract, so with the key absent the P&L flags nothing and says so. `check-migrate.js`
  asserts the table is empty, so a future migration that seeds a number has to justify it.
- Three geocoding columns on `locations`, none derivable from the others: `geocoded_at` (when
  we asked), `geocode_status` (what happened — the difference between "fix the address" and
  "try again later") and `street_view_status` (whether a photo exists; the static image
  endpoint answers 200 with a grey "no imagery" tile, so this is the only honest signal).
  All NULLable, because geocoding **fails soft** and must never block saving a building.

### 006 — and the one thing to do on the box BEFORE applying it

**006 REFUSES to apply while any worker has `hourly_rate_cents <= 0`.** It raises with a
count and a hint, `psql -1` aborts the whole file, `migrate.js` records nothing, and the
database is left exactly as it was. Re-running after the rates are set applies it.

A restored production dump (2026-08-19) carries exactly one such row:

```
id 6 · 'TTL Test' · hourly_rate_cents 0 · active false · 0 shifts · 0 requests · 0 sessions
```

So the deploy order is: **deal with that row first, then migrate.** The migration will not
do it for you, on purpose — a migration does not get to choose somebody's wage, and it does
not get to deactivate people to avoid the question (decision-41 §3). Either name a real
figure, or remove the row if it is the leftover test record it looks like:

```sh
psql "$DATABASE_URL" -c "SELECT id, name, hourly_rate_cents, active FROM workers WHERE hourly_rate_cents <= 0"
# then ONE of:
psql "$DATABASE_URL" -c "UPDATE workers SET hourly_rate_cents = 1500 WHERE id = 6"  # a figure a HUMAN chose
psql "$DATABASE_URL" -c "DELETE FROM workers WHERE id = 6"                           # only while it has no history
```

`DELETE` is only safe while that worker has **no** shifts, material requests or sessions —
check first, because the FKs are not `ON DELETE CASCADE` and a row with history will
(correctly) refuse. Note that it also destroys any **live enrolment code** on the row: the
`TTL Test` record above carries an unredeemed one. That is fine for a leftover test worker
and would not be fine for a real one.

#### The two pre-deploy checks, and what each one is for

Both take a dump and both refuse to touch production. Neither is in the always-on suite,
because each needs an artefact nobody can commit. Run **both** before a 006 window:

```sh
ssh schimmer-glanz.exe.xyz 'sudo -n cat /var/backups/nfc/nfc-<newest>.sql.gz' > /tmp/nfc.sql.gz
node server/db/check-prod-restore.mjs /tmp/nfc.sql.gz   # the SCHEMA: 006 on the client's own rows
node server/db/check-field-wire.mjs   /tmp/nfc.sql.gz   # the WIRE: what the phone in Vienna sends
sh   server/db/check-field-wire-mutants.sh /tmp/nfc.sql.gz   # and the negative case, 8 mutants
rm -f /tmp/nfc.sql.gz                                   # it is a copy of the payroll database
```

`check-prod-restore` proves 006 applies, refuses first, invents no rows, keeps every pin,
and that the API boots on the result. `check-field-wire` proves the five things that leaves
open — the close body the APK really sends (three keys, `auto_closed` among them, read out
of the **dex** and not out of the Kotlin), `auto_closed` monotonicity against the row rather
than against a regex, the wall card tapped while its building already has a zone, a replayed
open, and what HEAD's server does on the 005 schema (`/health` 200 while every clock-in
500s). Findings behind both: `backlog/docs/PROBE-DATA.md`.

**They need a local role called `nfc`**, because a production `pg_dump` carries
`ALTER TABLE … OWNER TO nfc` 22 times. Both now say so and exit 1 with the fix
(`createuser nfc`) instead of printing a stack trace.

The rest of 006, one line each:

- **`workers.hourly_rate_cents` loses its `DEFAULT 0` and gains `CHECK (> 0)`.** Dropping the
  default is the load-bearing half: `NOT NULL DEFAULT 0` still lands a zero on every `INSERT`
  that omits the column, which was the shape of `seed.sql` and of eight `check-api.js`
  fixtures. `> 0` and not `>= 0`: unlike a client contract a wage has no "free of charge"
  reading, so **a rate of 0 stops being expressible** and the named `Kein Stundensatz`
  exclusion goes with it (decision-41).
- **`location_revenue` is what the client PAID**, one row per (building, Vienna month),
  `month` always the 1st. **Append-only**: a correction inserts a new row and stamps
  `superseded_at` on the old one; a retraction stamps `superseded_at` and inserts nothing, so
  the month reverts to **UNKNOWN, not to 0**. `amount_cents` is `NOT NULL` and 0 is
  expressible and *means something* — "they paid nothing this month". **The absence of a row
  is the unknown.** No backfill from `location_contracts`: a contract is what was AGREED, and
  copying it in would assert a payment that may never have arrived (decision-42).
- **`zones` is a child of `locations` and carries an area.** `area_sqm` is `NUMERIC(8,2)` and
  **NULLable on purpose** — a zone nobody has measured is real, and a required area would be
  an invented one poisoning the €/m² benchmark that is the only reason the column exists. The
  **building stores no area**: it is `SUM(zones.area_sqm)` at read time, reported as "at least
  X m², N zones unmeasured" whenever any active zone is NULL (decision-43).
- **`zones.tag_serial` is for ADOPTED third-party hardware only** (decision-44). A tag we
  wrote carries the zone's id in its URL and has no row here. A serial is **not a credential**
  (decision-15) and never reaches the server on a tap: the phone matches it against the cached
  roster and sends the resolved place UUID.
- **`shifts.start_zone_id` / `end_zone_id` are nullable TAP FACTS, never an input to money.**
  `NULL` means "a building-level tag was tapped, or this predates zones" — not a missing value
  to be backfilled. The **composite** FKs against `zones (id, location_id)` make it impossible
  for a shift to name another building's zone. Consequence: `PATCH /admin/shifts/:id` must
  **clear both zone columns when `location_id` changes**, or the update raises `23503`.
- **006 creates ZERO rows.** No default zone, no revenue backfill. A building with no zones
  behaves exactly as it does today and **its own UUID keeps resolving for ever** — the card
  physically on the wall at HOIV carries one, and "unzoned" is a presentation state that must
  never be wired to tap resolution (decision-43 §3).

## Backups

Not optional for payroll data (decision-16). Daily `pg_dump` + offsite copy + one
tested restore — runbook §6. Nothing in this directory does that for you.

## Check

```sh
node server/db/check-migrate.js
```

Creates a throwaway database, migrates it twice, asserts the second run is a no-op,
spot-checks tables/indexes/UNIQUE constraints and seed idempotency, drops the
database. Skips with a message and **exit 0** if no Postgres is reachable.
