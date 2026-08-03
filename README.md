# NFC TimeSheets

**Tap a tag. The shift is logged.** Timekeeping for a Vienna cleaning company: workers hold their
phone to an NFC tag by a building entrance to clock in and out, and the office reviews hours,
buildings and payroll in a German web panel.

No app to open, no button to press, no login at the door. The phone can be locked and the app
closed — iOS wakes it from the tag itself.

|  |  |  |
|:--:|:--:|:--:|
| ![Tap the tag](docs/media/app-tap-banner.png) | ![Shift in progress](docs/media/app-shift.png) | ![History](docs/media/app-history.png) |
| **1.** Phone locked, app closed. Tap. | **2.** Shift open, already synced. | **3.** History, per building. |

▶ [`docs/media/demo-tap.mp4`](docs/media/demo-tap.mp4) — tap to clock in (6 s)
▶ [`docs/media/demo-write-tag.mp4`](docs/media/demo-write-tag.mp4) — provisioning a blank tag (30 s)

> The phone's home screen is blurred in the clip and the admin screenshots are redacted — they
> were recorded against the live system with a real worker, a real building and a real client.

## The admin panel

Desktop-first, German by default, built for one non-technical director.

| Workers | Buildings |
|:--:|:--:|
| ![Workers](docs/media/admin-workers.png) | ![Buildings](docs/media/admin-locations.png) |

Each building row shows the exact URL that gets written onto its NFC tag, with one-click copy.
That URL *is* the building's identity, so the screen treats it as the point of the page.

## How a tap actually works

```
NFC tag  ──►  https://timesheets.exe.xyz/t?l=<location-uuid>
                        │
                        │  iOS matches the host against the app's associated domains,
                        │  fetches /.well-known/apple-app-site-association, and opens
                        │  the app — from a locked screen, app not running
                        ▼
              POST /shifts/open   { location_id, client_uuid }   ← clock IN, end_time NULL
              POST /shifts/close  { client_uuid }                ← clock OUT, later
```

Four things about that chain are load-bearing, and each one is a decision record:

- **The tag carries a UUID, never a readable slug** (decision-21). A slug would be guessable, so
  one tag would let anyone enumerate every building the company cleans.
- **Tags are deliberately left unlocked** (decision-15), which means the value on them is
  attacker-controllable. Unguessable is not the same as authenticated: the server always resolves
  the UUID to an *active* row and never trusts the client.
- **The shift is posted at clock-in with `end_time NULL`** and closed later (decision-19). The
  obvious design — hold the shift on the phone and post it complete — silently made the entire
  8-hour auto-close safety net dead code, because no open shift ever reached the server.
- **The worker's identity comes from the session, never the request body** (decision-22). It used
  to come from a picker in the app, which meant anyone could file hours as anyone.

## What is where

| Dir | What | Runs where |
|---|---|---|
| `NFCTimeSheets/` | SwiftUI + CoreNFC iOS app | TestFlight |
| `android/` | Kotlin + Jetpack Compose client | not yet built — see below |
| `server/` | Node 22 REST API. Also serves AASA, `/t` and the admin panel | VM, `/srv/nfc` |
| `server/db/` | Postgres 16 schema + migration runner | VM |
| `web/` | Next.js admin panel, **static export** (`output: 'export'`) | built to `web/out/`, served by `server/` |
| `ops/` | systemd units, 8 h auto-close, backups, `deploy.sh` | VM, `/srv/nfc/ops` |
| `backlog/decisions/` | architecture decision records — **binding** | — |
| `backlog/docs/` | runbooks, journey map, audit reports | — |

Everything server-side is **one Node process on one VM** (decision-16): no Docker (decision-1), no
Supabase, no Cloudflare, no Vercel, no PM2. One process serves association files, then REST
routes, then the static export, in that order.

The server's entire dependency list is **`pg`** and **`@sentry/node`**. The router is hand-rolled.
That is a deliberate ceiling, not an accident — it keeps a later port to a managed platform cheap.

## Engineering notes

A few problems here were more interesting than the CRUD around them:

**Universal links are host-exact and cached by Apple's CDN.** Once a tag is glued to a wall, the
hostname on it cannot change without physically revisiting every building. So the well-known files
are generated from one config file and committed, and `verify.sh` byte-compares the *live* bytes
against the reviewed ones. It is the gate that must pass before any tag is written.

**Two parsers will always drift.** The iOS and Android tag parsers were written independently and
looked equivalent. Running both over one corpus found that Java's `URLDecoder` implements *form*
encoding, where `+` means space — so Android accepted a tag iOS rejected. Leniency at a trust
boundary, on tags anyone can rewrite.

**Payroll totals must never disagree with the rows above them.** The hours aggregate originally
had no date bound while the list beside it was period-filtered, so the screen could show one
month's money over another month's empty table. Money is integer cents end to end, and period
boundaries are computed in `Europe/Vienna` rather than with a fixed offset — October has 745
hours, and month-end is payroll time.

**A shift with no end time is a payroll hole.** A forgotten tap-out is auto-closed at 8 hours by a
systemd timer, flagged, and excluded from pay until a human resolves it — the worker gets a
mandatory prompt and sets the real time (decision-10).

**Everything fails soft.** No `SENTRY_DSN` and telemetry disables itself. No network and the tap
still records locally and syncs later. The local row is a queue; the server is the truth.

## Build and deploy

Order is load-bearing: **migrate before restart**, or the new code queries columns that do not
exist yet.

```bash
./ops/deploy.sh timesheets.exe.xyz
```

That builds the web export, installs production server deps, rsyncs both plus `ops/`, runs
migrations, restarts the unit, and finally runs `verify.sh` against the live host.

First-time VM provisioning (user, Postgres, `/etc/nfc/env`, unit install) is **not** in that
script — see `ops/README.md` and `backlog/docs/runbook-vm-provisioning.md`. Run those once, then
`deploy.sh` forever after.

### Local development

```bash
createdb nfc                                        # db and role are both named `nfc`
DATABASE_URL=postgres:///nfc node server/db/migrate.js
DATABASE_URL=postgres:///nfc psql postgres:///nfc -f server/db/seed.sql   # dev data only

cd web && pnpm install && pnpm build                # -> web/out
cd ../server && pnpm install
DATABASE_URL=postgres:///nfc APP_KEY=dev-app-key-xxxx \
  PORT=8080 PUBLIC_DIR=../web/out node server.js    # admin at http://127.0.0.1:8080/login

DATABASE_URL=postgres:///nfc node server/bin/create-admin.js   # first web-admin login
```

**Log in against the same origin.** `pnpm dev` on :3000 cannot authenticate against the API on
:8080 — the server sends no CORS headers and the session cookie is `Secure; SameSite=Strict`.
Build the export and let the API serve it, which is also exactly how it runs in production. Use
`pnpm dev` for layout work only.

Secrets come from the environment only. The server refuses to boot without `DATABASE_URL`,
`APP_KEY` or `PORT`; nothing is hardcoded and the app key is never logged. On the VM they live in
`/etc/nfc/env` (`0640 root:app`). There is **no `ADMIN_PIN`** (decision-20) — admin credentials
are an email plus a scrypt hash, created interactively.

`SENTRY_DSN` is optional (decision-23). Unset, the SDK disables itself and the API behaves
identically. With one set, start as production does or the instrumentation loads too late:

```bash
SENTRY_DSN=https://... DATABASE_URL=postgres:///nfc APP_KEY=dev-app-key-xxxx \
  PORT=8080 PUBLIC_DIR=../web/out node --import ./instrument.mjs server.js
```

The per-request access log (`[req] POST /shifts/open 201 34ms w=7`) does not depend on Sentry.

## Checks

No test framework anywhere — plain `node:assert` and shell. Each skips cleanly (exit 0) when no
Postgres is reachable, so they are safe on a fresh laptop.

```bash
node server/db/check-migrate.js       # migrations apply once, re-run is a no-op
node server/check-api.js              # API behaviour against a throwaway schema
node server/routes/wellknown.test.js  # AASA / assetlinks / /t handler
./ops/check-autoclose.sh              # 8h auto-close SQL is correct and idempotent
cd web && pnpm check                  # exact versions, en/de key parity, ICU plurals
```

Against a running server:

```bash
SCHEME=http server/wellknown/verify.sh 127.0.0.1:8080
server/wellknown/verify.sh                    # host from ops/branding.json
node ops/gen-wellknown.mjs                    # well-known files in sync with config?
node ops/check-branding.mjs                   # every other copy of the identity agrees?
```

## Running it under your own identity

The operator's identity — team, bundle id, package name, signing fingerprints, hostname — is
configuration, not source (decision-24). One file, `ops/branding.json`, is the single source, and
the well-known files are generated from it. Full walkthrough: **`ops/REBRAND.md`**.

The hostname is the one irreversible choice. Fix it *before* writing a single tag.

## Status

Live and in daily use on iOS. Working today: background NFC clock-in/out, Sign in with Apple,
offline queue, 8 h auto-close with mandatory resolution, workers / buildings / clients / shifts /
payroll / inventory admin, a read-only client portal, nightly backups with a tested restore, and
German throughout.

Not done: the Android client has never been compiled — it has no signing key and no Play listing,
and NFC cannot be tested on an emulator. Worker identity on Android is an admin-issued enrolment
code (decision-26), not a third-party provider. Backups still land on the same disk as the
database; an offsite target is unresolved.

## Things that will bite you

- **`verify.sh` is the gate for writing physical tags.** A wrong `Content-Type` or a single
  redirect on `/.well-known/apple-app-site-association` means every tag in every building has to
  be physically rewritten (decision-4).
- **The DB, role, app dir and unit prefix are all `nfc`.** Renaming one breaks
  `ops/systemd/nfc-autoclose.service` and `ops/backup/*.sh`, which hard-code it.
- **A `pg_dump` on the same disk as the database is not a backup.** `ops/backup/pg-backup.sh`
  still has an unresolved `TODO(offsite)`.
- **Decisions in `backlog/decisions/` are binding** and change only via a new record that
  supersedes the old one. decision-16 supersedes decision-11, defers decision-12 and decision-14,
  and moots decision-13. Read it before proposing any infrastructure change.

## Licence

No licence granted. All rights reserved — published for reading, not for reuse.
