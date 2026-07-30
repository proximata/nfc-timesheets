# NFC TimeSheets

Shift tracking for a Vienna cleaning company. Workers tap an NFC tag at a building entrance to
clock in and out; the office reviews hours and payroll in a web admin panel.

Everything server-side runs as **one Node process on one exe.dev VM** (decision-16). No Docker
(decision-1), no Supabase, no Cloudflare, no Vercel, no PM2.

## What is where

| Dir | What | Runs where |
|---|---|---|
| `NFCTimeSheets/` | SwiftUI + CoreNFC iOS app | TestFlight |
| `server/` | Node 22 REST API. Also serves AASA, `/t` and the admin export | VM, `/srv/nfc` |
| `server/db/` | Postgres 16 schema + migration runner | VM |
| `web/` | Next.js admin panel, **static export** (`output: 'export'`) | built into `web/out/`, served by `server/` |
| `ops/` | systemd units, 8h auto-close, backups, `deploy.sh` | VM, `/srv/nfc/ops` |
| `backlog/` | tasks, ADRs (`backlog/decisions/`), runbook | — |
| `pages/`, `video/`, `research/` | deprecated / reference | — |

One process serves all of it, in this order: association files → REST routes → static export.

## Build + deploy order

Order is load-bearing: **migrate before restart**, or the new code queries columns that do not
exist yet.

```bash
./ops/deploy.sh timesheets.exe.xyz
```

That single command does, in order:

1. `web`: `pnpm install --frozen-lockfile && pnpm verify` → `web/out/`
2. `server`: `pnpm install --prod --frozen-lockfile` (only dep is `pg`, pure JS)
3. rsync `server/` → `/srv/nfc/` (excluding `public/`, `ops/`)
4. rsync `web/out/` → `/srv/nfc/public/` and `ops/` → `/srv/nfc/ops/`
5. ssh: `node /srv/nfc/db/migrate.js`
6. ssh: `systemctl restart nfc-api`, then `server/wellknown/verify.sh` against the live host

First-time VM provisioning (user, Postgres, `/etc/nfc/env`, unit install) is **not** in that
script — see `ops/README.md` and `backlog/docs/runbook-vm-provisioning.md`. Run those once,
then `deploy.sh` forever after.

## Local development

```bash
createdb nfc                                        # db + role are both named `nfc`
DATABASE_URL=postgres:///nfc node server/db/migrate.js
DATABASE_URL=postgres:///nfc psql postgres:///nfc -f server/db/seed.sql   # dev data only

cd server && pnpm install
DATABASE_URL=postgres:///nfc APP_KEY=dev-app-key-xxxx \
  PORT=8080 PUBLIC_DIR=../web/out node server.js

DATABASE_URL=postgres:///nfc node server/bin/create-admin.js   # first web-admin login

cd web && pnpm install && pnpm dev                  # :3000, layout work only — see below
```

**Log in locally against the same origin.** `pnpm dev` on :3000 cannot authenticate against
the API on :8080: the server sends no CORS headers and the session cookie is
`Secure; SameSite=Strict`. Build the export and let the API serve it instead — which is also
exactly how it runs in production:

```bash
cd web && pnpm build                                # -> web/out
cd ../server && DATABASE_URL=postgres:///nfc APP_KEY=dev-app-key-xxxx \
  PORT=8080 PUBLIC_DIR=../web/out node server.js    # admin at http://127.0.0.1:8080/login
```

Secrets come from the environment only. The server refuses to boot if `DATABASE_URL`,
`APP_KEY` or `PORT` is missing; nothing is hardcoded and the app key is never logged.
On the VM they live in `/etc/nfc/env` (`0640 root:app`).

`SENTRY_DSN` is **optional** (decision-23). Unset — which is how it runs locally and how it
ships — the SDK disables itself and the API behaves identically. With one set, start the
server as production does, or the instrumentation loads too late to see anything:

```bash
SENTRY_DSN=https://...  DATABASE_URL=postgres:///nfc APP_KEY=dev-app-key-xxxx \
  PORT=8080 PUBLIC_DIR=../web/out node --import ./instrument.mjs server.js
```

The per-request access log (`[req] POST /shifts/open 201 34ms w=7`) does **not** depend on
Sentry; it is stdout, captured by journald on the VM.

There is **no `ADMIN_PIN`** (decision-20). Admin credentials are an email + a scrypt hash in
the `admins` table, created interactively with `server/bin/create-admin.js`. Nothing about the
admin login lives in the environment, a unit file, or a shell history.

## Checks

No test framework anywhere — plain `node:assert` and shell. Each skips cleanly (exit 0) when no
Postgres is reachable, so they are safe to run on a fresh laptop.

```bash
node server/db/check-migrate.js       # migrations apply once, re-run is a no-op
node server/check-api.js              # API behaviours against a throwaway schema
node server/routes/wellknown.test.js  # AASA / assetlinks / /t handler
./ops/check-autoclose.sh              # 8h auto-close SQL is correct and idempotent
cd web && pnpm check                  # exact versions, en/de key parity
```

Against a running server (local or live):

```bash
SCHEME=http server/wellknown/verify.sh 127.0.0.1:8080
server/wellknown/verify.sh timesheets.exe.xyz
```

## Things that will bite you

- **`verify.sh` is the gate for writing physical NFC tags.** A wrong `Content-Type` or a single
  redirect on `/.well-known/apple-app-site-association` means every tag in every building has
  to be physically rewritten (decision-4).
- **Tags carry the location UUID, never the slug** (decision-21): `?l=<uuid>`. A slug is
  guessable, so it would let anyone enumerate every building off one tag. The slug exists for
  the admin UI and log lines only and must never be written to a tag.
- **Tags are deliberately left unlocked** (decision-15), so the `?l=<uuid>` they carry is
  attacker-controllable. Unguessable is not authenticated: the API always resolves the UUID to
  an *active* row in `locations` server-side. Never trust it.
- **The DB, role, app dir and unit prefix are all `nfc`.** Renaming one breaks
  `ops/systemd/nfc-autoclose.service` and `ops/backup/*.sh`, which hard-code it.
- **A `pg_dump` on the same disk as the database is not a backup.** `ops/backup/pg-backup.sh`
  has an unresolved `TODO(offsite)`. Until someone picks a target, there is no backup.
- **Decisions in `backlog/decisions/` are binding** and can only be changed by a new record
  that supersedes the old one. decision-16 **supersedes** decision-11 (Vercel), **defers**
  decision-12 (Supabase) and decision-14 (Cloudflare Pages), and **moots** decision-13. Read
  decision-16 before proposing any infrastructure change.
