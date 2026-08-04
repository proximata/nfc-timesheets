# NFC TimeSheets

**Tap a tag. The shift is logged.** Timekeeping for a Vienna cleaning company: workers hold their
phone to an NFC tag by a building entrance to clock in and out, and the office reviews hours,
buildings and payroll in a German web panel.

No app to open, no button to press, no login at the door. The phone can be locked and the app
closed — iOS wakes it from the tag itself.

## Demo

Everything below runs against a **local** database of invented workers, invented Vienna
buildings and invented prices. No live data, no real person. `backlog/docs/DEMO.md` has the
exact commands to reproduce any of it.

### Both phones, one shift

▶ [`docs/media/both-devices.mp4`](docs/media/both-devices.mp4) — **144 s.** The same worker
journey on an iPhone simulator and an Android emulator, side by side: sign in, tap in, the
in-shift takeover, the signal each OS gives outside the app, tap out, everything cleared. It
opens on a **before / after** card built from four real screenshots of four real builds.

| Before | After |
|:--:|:--:|
| ![Before, iOS](docs/media/before-ios-shift.png) ![Before, Android](docs/media/before-android-shift.png) | ![After, iOS](docs/media/ios-shift.png) ![After, Android](docs/media/android-shift.png) |
| A running shift was one small pill, or the word *„Läuft“*, on one row of a list. Pocket the phone and nothing mentioned it again. | The shift takes the app over: building named, state in words, a clock that runs, and *Verlauf* gone from the bar until it ends. |

The two clips are stage-aligned, never sped up: where one device finished a step sooner its
**last frame is held**, which is visible as a still picture. The iPhone still on the left is a
real capture from 30 July 2026 recovered from this repo's own history, with the client name
painted out and the paint verified pixel by pixel before it is used.

The two panes do not look alike, and that is the product: `ui/Theme.kt` takes
`dynamicLightColorScheme` from the wallpaper on Android 12+, so the takeover screen is whatever
colour that worker's phone is.

### The worker's phone — Android

▶ [`docs/media/android-journey.mp4`](docs/media/android-journey.mp4) — **136 s.** First launch,
enrolment-code sign-in, a tag URL opening a shift, the takeover, the ongoing lock-screen
notification, the same URL ending it, history.

> **The NFC tap in that clip is mocked, and the clip says so on screen.** No emulator has NFC
> hardware, so the tag URL is delivered as the same `VIEW` intent the OS sends after the radio
> reads a tag. Everything downstream of that is the real code path; the radio is not exercised.
> The app's own screen also says *„Dieses Telefon hat kein NFC“*.

| Sign in | Shift running | Outside the app |
|:--:|:--:|:--:|
| ![Enrolment code](docs/media/android-signin.png) | ![Shift open](docs/media/android-shift.png) | ![Ongoing notification](docs/media/android-notification.png) |
| One code, one worker, one hour, single use (decision-26) | Opened by the tag URL. The worker's identity came from the session, never the request (decision-22) | An ongoing notification with a clock Android draws itself, so it has no 8-hour ceiling |

That APK is the shipping debug build with **no edits** — `branding.properties` untouched, so the
URL in the recording is the real tag URL. It reaches the demo server through `adb reverse` and a
hosts file inside the emulator.

### The worker's phone — iOS

▶ [`docs/media/ios-journey.mp4`](docs/media/ios-journey.mp4) — **120 s.** Sign in with Apple, a
tap that opens a shift, the takeover with its running clock and its shortened tab bar, the
app-icon badge, and the tap that closes it again.

> **Two things are mocked on a simulator, and the clip says so on every frame.** There is no NFC
> radio, and there are no entitlements — `-sdk iphonesimulator` sets `ENTITLEMENTS_ALLOWED = NO`,
> so `simctl openurl` hands the tag URL to Safari rather than to the app. The demo injects the
> location id where the URL parse would have produced it, through the same `TagLink` validation
> into the same `TapInbox`, so every line after the parse is the shipping code. The hook is
> `#if DEBUG` and `demo/ios-setup.sh --prove-release` greps every file of a Release build for it.
>
> There is **no Apple ID** in a simulator either, so `demo/demo-server.mjs` mints a real RS256
> identity token and tells itself the key is Apple's. Signature, issuer, audience, expiry and
> nonce are all still verified by `server/lib/apple.js`; the live server rejects that token.

| Sign in | Shift running | Outside the app |
|:--:|:--:|:--:|
| ![Sign in with Apple](docs/media/ios-signin.png) | ![Shift open](docs/media/ios-shift.png) | ![App icon badge](docs/media/ios-badge.png) |
| Sign in with Apple and nothing else (decision-22). The red line is a real bug, not a demo artefact — a fresh install has no session to end | The takeover, and *Verlauf* gone from the tab bar until the shift is closed | The app-icon badge, which survives a restart. **No Live Activity** — the widget extension target does not exist yet, so that code ships inert |

▶ [`docs/media/demo-write-tag.mp4`](docs/media/demo-write-tag.mp4) — provisioning a blank tag with
NFC Tools on a real phone (30 s). Real hardware, no app of ours in it.

### The admin panel

Desktop-first, German by default, built for one non-technical director.

▶ [`docs/media/admin-walkthrough.mp4`](docs/media/admin-walkthrough.mp4) — **161 s.** **Every
screen in the sidebar, with none left out**: the day's exceptions, the shift log, workers,
buildings and the tag URL, clients, the product catalogue, the material queue walked one real
click at a time from *eingereicht* to *geliefert*, **payroll**, the P&L before and after a target
margin is typed in, contract history, building analytics — and the read-only client portal,
opened with a link minted on camera three minutes earlier. Real speed, nothing cut or annotated.

That completeness is asserted, not remembered: the recorder reads `PRIMARY_NAV` out of
`web/lib/nav.ts` and **fails the run** if the walkthrough never opened one of the screens. The
previous cut silently skipped `/payroll/`, `/clients/` and `/inventory/`.

| ![Payroll](docs/media/admin-payroll.png) | ![Clients](docs/media/admin-clients.png) |
|:--:|:--:|
| **Lohnabrechnung.** Hours and pay per worker for one pay period, and the two 8-hour auto-closed shifts that are excluded from it — counted, named and linked rather than quietly dropped (decision-10). | **Kunden.** The companies under contract and the people reported to, each of whom can be given a read-only link to their own buildings and nothing else. |
| ![Inventory](docs/media/admin-inventory.png) | ![Client portal](docs/media/admin-material-requests.png) |
| **Produkte & Geräte.** The catalogue with a unit cost per line. Nothing a worker asks for is auto-matched to a row here — a guess would put a wrong price into the P&L. | **Materialanforderungen, the far end.** *Geliefert* by the admin and *gesehen* by the worker are two different events, and the panel names both: there is no push, the app polls. |

| ![Dashboard](docs/media/admin-dashboard.png) | ![Profit and loss](docs/media/admin-pl.png) |
|:--:|:--:|
| **Übersicht.** Who is clocked in now, what is holding payroll up, which building has no shifts. | **Gewinn & Verlust.** Revenue − labour − materials per building. One building is losing money; one has no contract and is refused a number rather than given a zero. |
| ![Material requests](docs/media/admin-material-requests.png) | ![Contract history](docs/media/admin-contracts.png) |
| **Materialanforderungen.** The worker's own words, and a lifecycle that cannot skip a step. Nothing is auto-matched to a product — a guess would put a wrong price into the P&L. | **Vertragsverwaltung.** A price has a start date and an end date. Raising it today does not rewrite last March. The replaced period is closed, not deleted. |
| ![Shift log](docs/media/admin-shifts.png) | ![Workers](docs/media/admin-workers.png) |
| **Schichten.** Every row says whether it counts towards pay and why: *Läuft*, *Abgeschlossen*, *Nicht bestätigt*. The 8-hour one is the auto-close safety net waiting on a human. | **Mitarbeiter.** Where an enrolment code is issued for a non-iPhone (decision-26). It is shown once and never again — not by you, not from the database, which stores only a hash. |
| ![Building analytics](docs/media/admin-analytics.png) | ![Buildings](docs/media/admin-locations.png) |
| **Objektauswertung.** Hours worked against hours agreed, month by month. The map is missing because **this build carries no Google Maps key — and so does the deployed one**; the screen says so and the table below it still carries every building. | **Objekte.** Each row shows the exact URL written onto that building's NFC tag, with one-click copy. That URL *is* the building's identity. |

Two details in those screenshots are the product being careful rather than the demo being tidy:
*„1 Schicht nicht gezählt – Endzeit nicht bestätigt“* under a building name is decision-10 keeping
unconfirmed hours out of both pay and cost, said out loud so a building cannot look cheap by
accident; and *„Nicht beurteilbar“* is what every row reads until a human types a target margin,
because the software has no opinion about the business.

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
| `android/` | Kotlin + Jetpack Compose client | builds and runs; no signing key, no Play listing |
| `server/` | Node 22 REST API. Also serves AASA, `/t` and the admin panel | VM, `/srv/nfc` |
| `server/db/` | Postgres 16 schema + migration runner | VM |
| `web/` | Next.js admin panel, **static export** (`output: 'export'`) | built to `web/out/`, served by `server/` |
| `ops/` | systemd units, 8 h auto-close, backups, `deploy.sh` | VM, `/srv/nfc/ops` |
| `backlog/decisions/` | architecture decision records — **binding** | — |
| `backlog/docs/` | runbooks, journey map, audit reports | — |
| `demo/` | seed data and the scripts that produce `docs/media/` | local only, loopback-guarded |

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

For a database with something in it — four months of shifts, contracts, material requests — use
the demo seed instead of `seed.sql`, and read `backlog/docs/DEMO.md` first: it truncates, and it
refuses to run on any database not named `nfc_demo`.

```sh
createdb nfc_demo
DATABASE_URL=postgres:///nfc_demo node server/db/migrate.js
psql -d nfc_demo -v ON_ERROR_STOP=1 -f demo/seed.sql
DATABASE_URL=postgres:///nfc_demo node demo/make-admin.mjs     # demo@example.test
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
sh demo/check-guards.sh               # the demo scripts still refuse the live db and host
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

The Android client compiles, installs, signs in with an enrolment code (decision-26) and records
a shift end to end — demonstrated in the clip above, against a local server. What it still does
not have is a **signing key** and a **Play listing**, both of which are the owner's to create,
and until the key exists `assetlinks.json` has no fingerprints, so on a real handset a tag opens
Chrome instead of the app. A real NFC tap has never happened on Android: no emulator has the
radio.

Also not done: the four newest admin screens are built and checked but **not deployed** — the
live server is still on the previous version. Backups still land on the same disk as the
database; an offsite target is unresolved. `backlog/docs/V2-FEATURES.md` leads with the full
blocker list in severity order.

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
