# server/db — Postgres schema & migrations

Postgres 16, local to the exe.dev VM (unix socket / `127.0.0.1` only, never publicly
bound — decision-16, runbook §1). `pg` is the API's client; this directory only needs
`psql`.

```
migrations/001_init.sql   canonical schema — workers, admins, sessions, locations, shifts
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
- Money is `INTEGER` cents (`workers.hourly_rate_cents`). No floats in payroll.
- 3B (building owners, annual contracts, materials, P&L) is not built. It hangs off
  `locations.id` / `shifts.id`; no change to `001_init.sql` is needed for it.

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
