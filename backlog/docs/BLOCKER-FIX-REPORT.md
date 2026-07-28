# Blocker + Fix Report — five-change batch (B3, B4, B6, I18N, CLOCKIN)

Verification pass over what is **on disk**, not what the implementation reports claimed.
Every statement below was re-derived from the files and, where it was checkable, executed.

---

## STILL BLOCKING DEPLOY

Exactly one item, and it is not code.

### BLOCKER-1 — the app key `tsk_2667…` is burned. Rotate it before the proxy goes public.

`NFCTimeSheets/NFCTimeSheets/API.swift:25` hardcodes the same `APP_KEY` that
`legacy-backup/timesheets.env` holds in plaintext:

```
APP_KEY=tsk_…ROTATED_REDACTED
ADMIN_PIN=<REDACTED-legacy-PIN>
```

That file sat next to a root-owned Node process that authenticated admins with a 6-digit PIN.
Treat the key as public. Rotating it means a new value in `/etc/nfc/env` **and** a new
TestFlight build, so it has to happen before the proxy is opened, not after — the two cannot
be done in either order without a window where the old key still works.

Needs a human: pick the new key, and accept that every installed build stops working the
moment `/etc/nfc/env` changes. Effort: low. Coordination: not low.

Everything else below is either fixed or a non-blocking judgement call.

---

## 1. `manual_finish` / `ADMIN_PIN` / `X-Admin-Pin` — survivors

Grepped the whole tree. **Zero live uses remain.** Nine survivors were real bugs; all fixed.

| # | File | Was | Now |
|---|---|---|---|
| 1 | `README.md:53` | `ADMIN_PIN=dev-pin-xxxx` in the documented run command | removed; points at `bin/create-admin.js` |
| 2 | `README.md:60` | "refuses to boot if … `ADMIN_PIN` … is missing" — flatly false, `REQUIRED_ENV` has three entries | corrected + explicit "there is no `ADMIN_PIN`" paragraph |
| 3 | `README.md:88` | "the `?l=<slug>` they carry" — contradicts decision-21 | `?l=<uuid>`, plus a line on why the slug must never be on a tag |
| 4 | `ops/systemd/nfc-api.service:18` | "Holds DATABASE_URL, APP_KEY, ADMIN_PIN, PORT" | ADMIN_PIN removed, decision-20 cited |
| 5 | `ops/shelley-provision-prompt.txt:19` | told the provisioning agent to reserve a slot for `ADMIN_PIN` | now instructs it **not** to, and points at `create-admin.js` |
| 6 | `backlog/docs/runbook-vm-provisioning.md:72` | `psst tag ADMIN_PIN server prod` — would have pushed a dead secret to the VM | removed; replaced with the on-VM `create-admin.js` step |
| 7 | `server/routes/wellknown.js:50` | comment `/t?l=<slug>` | `/t?l=<location uuid>` |
| 8 | `server/routes/wellknown.test.js:44` | probed `/t?l=hauptstrasse-12` | probes a UUID |
| 9 | `server/wellknown/verify.sh:55` | probed `/t?l=verify-probe` | probes a UUID |

Items 1–2 mattered most: a developer following the root README verbatim would have set an
`ADMIN_PIN` that does nothing and concluded admin auth was configured.

**Remaining hits are all negative assertions or guards, and are correct as-is:**
`server/check-api.js:110,163` (asserts `ADMIN_PIN` is *not* required), `db/check-migrate.js:126`
(asserts the columns are *gone*), `web/scripts/check.mjs:165` (the regex that fails the build if
`x-admin-pin` ever comes back), and explanatory comments in `001_init.sql`, `lib/auth.js`,
`routes/admin.js`, `API.swift`, `server/README.md`, `db/README.md`.

Historical records under `backlog/tasks/`, `backlog/docs/AUTOPILOT-RUN-REPORT.md`, `Backlog.md`
and `research/` were deliberately **not** edited. They describe what was true when written.

### Secret hygiene (found during the same grep)

- **`legacy-backup/` was not gitignored** and contains the plaintext `APP_KEY` and
  `ADMIN_PIN=<REDACTED-legacy-PIN>`. Untracked, so nothing leaked, but one `git add -A` away from being in
  history forever. Added to `.gitignore` next to the already-ignored `.vm-legacy-backup/`.
- **`state.md:12` published the PIN in cleartext** (`ADMIN_PIN <REDACTED-legacy-PIN>`) in a tracked file.
  Redacted, and the file now says the legacy key is burned. Also corrected three other stale
  claims there: "No implementation started", "PM2 + systemd" (decision-18 killed PM2), and the
  `manualFinish` flag description (decision-10).

---

## 2. Location identifier — UUID everywhere? **PASS**

| Surface | File | Verdict |
|---|---|---|
| Migration | `001_init.sql:71` | `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `slug TEXT UNIQUE NOT NULL` |
| FK | `001_init.sql:101` | `location_id UUID NOT NULL REFERENCES locations(id)` |
| Seed | `db/seed.sql` | never hardcodes an id; `ON CONFLICT (slug)` is admin-side only |
| API validation | `lib/validate.js:105` | `activeLocation()` looks up `WHERE id = $1` after `uuid()` shape-check |
| API write path | `routes/app.js:62` | `v.activeLocation(body.location_uuid)` |
| autoclose.sql | `ops/sql/autoclose.sql` | touches no location column at all |
| Tag parse | `TagLink.swift`, `checks/tag-link-check.swift:29` | a slug in `?l=` is **rejected** by an explicit negative case |
| iOS wire | `API.swift:221` | `locationUuid = "location_uuid"` |
| Landing/AASA | `wellknown.js`, `verify.sh` | comments + probes now UUID-shaped |

The slug survives only where it should: `routes/admin.js:154-178` (admin CRUD) and as a
read-only `location_slug` on the joined `/shifts/*` responses for display. Proven live:

```
POST /shifts/open  location_uuid="e2e-haus"  ->  400 {"error":"invalid_uuid","field":"location_uuid"}
```

No physical-rewrite bug. Tags can be written.

---

## 3. iOS JSON vs. server expectations — field by field

Diffed `NFCTimeSheets/NFCTimeSheets/API.swift` against `server/routes/app.js`, then confirmed
each against a live server with the exact bytes from `checks/tag-link-check.swift`.

| Endpoint | iOS sends | Server reads | Live result | |
|---|---|---|---|---|
| `POST /shifts/open` | `client_uuid, location_uuid, start_time, worker_id` | `body.client_uuid, body.worker_id, body.location_uuid, body.start_time` | `201` + `duplicate:false` | **PASS** |
| `POST /shifts/open` (retry) | identical bytes | `ON CONFLICT DO NOTHING` → lookup | `200` + `duplicate:true` | **PASS** |
| `POST /shifts/close` | `client_uuid, end_time` | `body.client_uuid, body.end_time` | `200` | **PASS** |
| `GET /shifts/open?worker=` | `worker` query | `v.id(query.get("worker"))` | `{shift:…\|null}` | **PASS** |
| `GET /shifts/unresolved?worker=` | `worker` query | same | `{shifts:[…]}` | **PASS** |
| `POST /shifts/:id/resolve` | `end_time` | `body.end_time` | `200`, `corrected_at` stamped | **PASS** |
| `GET /roster` | — | `{workers, locations}` | decodes | **PASS** |

Response decoding, also **PASS**:

- `WireShift` `CodingKeys` (`worker_id`, `location_id`, `start_time`, `end_time`, `auto_closed`,
  `corrected_at`, `client_uuid`, `location_slug`, `location_name`) match `SHIFT_FIELDS` in
  `routes/app.js:24-33` exactly, name for name.
- `endTime`/`correctedAt` are `Date?` and the server does return `null` for both. Confirmed.
- `locationId` is `String`; `pg` hands UUID back as a string. Confirmed on the wire:
  `"location_id":"e6bb93b7-f53c-405d-80a7-b3e76ac1eeac"`.
- The server emits `"2026-07-28T15:35:23.000Z"` **and** `…23.247Z`. `Wire.date(from:)` tries
  fractional then whole seconds, so both parse. This is the failure mode that would otherwise
  have thrown on roughly one response in a thousand.
- Header is `X-App-Key` on every call. No `X-Admin-Pin` anywhere in the target.

`WireLocation` decodes only `id, slug, name` while `/roster` also returns `address, lat, lng`.
Not a mismatch — `Codable` ignores unknown keys.

---

## 4. The 8h chain — reachable end to end? **YES. Every link is real.**

Not traced by reading. Executed against a live server + Postgres, with a shift backdated 9h.

| Link | Evidence | Real? |
|---|---|---|
| App posts an OPEN shift at clock-in | `ContentView.swift:146` — `handleTap` inserts locally then `Task { await syncPending }`; `Sync.swift:87` → `ShiftAPI.open`. Not deferred to clock-out. | **REAL** |
| `end_time IS NULL` exists in the table | `select count(*) … where end_time is null` → `1` | **REAL** |
| `autoclose.sql` matches it | `psql -f ops/sql/autoclose.sql` → `UPDATE 1` | **REAL** |
| … sets `auto_closed`, leaves `corrected_at` | `auto_closed=true corrected_at_null=true` | **REAL** |
| `GET /shifts/unresolved` returns it | returned the row with `auto_closed:true, corrected_at:null` | **REAL** |
| `POST /shifts/:id/resolve` clears it | `200`, `corrected_at:"2026-07-28T16:35:23.247Z"`; `/unresolved` → `{"shifts":[]}` | **REAL** |
| Idempotent on a second timer run | `check-autoclose.sh`: run1=1 row, run2=0 rows | **REAL** |
| The case the net exists for | 30h-old shift: `open30 -> 201`, `close30 -> 200`. The old `422 shift_too_long` is gone from `lib/validate.js`. | **REAL** |
| Closing a timer-closed shift does not silently resolve it | `POST /shifts/close` returns `"auto_closed":true,"corrected_at":null` — the app routes to the resolution sheet instead | **REAL** |
| Double-punch cannot open two shifts | `shifts_one_open_per_worker_idx`, partial UNIQUE. `check-autoclose.sh` asserts rejection **and** a positive control that a worker with no open shift can still clock in. | **REAL** |

This was the dead-machinery finding, and it is dead no longer. Before this batch the app only
posted completed shifts, so `end_time` was never NULL and the entire net — `autoclose.sql`,
both systemd units, `shifts_open_idx`, `/shifts/unresolved`, `/shifts/:id/resolve` — could
never fire. It now fires.

**One judgement call worth knowing:** the timer is `ops/systemd/nfc-autoclose.timer`. The SQL
and the units are verified; the units being *installed and enabled on the VM* is not, because
nothing is deployed yet. Until `systemctl is-enabled nfc-autoclose.timer` returns `enabled` on
the box, the net is correct but not armed. Put it in the deploy checklist.

---

## 5. Check scripts — ran / skipped / failed

All six run. **Zero failures.** All skip cleanly with exit 0 when no Postgres is reachable —
verified by pointing `DATABASE_URL` at a dead port and stripping `psql` from `PATH`.

| Check | With DB | Without DB |
|---|---|---|
| `node server/db/check-migrate.js` | `OK` | `SKIP … (pg_isready failed)` exit 0 |
| `node server/check-api.js` | `PASS` (46 assertions) | `SKIP (no database reachable)` exit 0 |
| `node server/routes/wellknown.test.js` | `OK` | n/a, needs no DB |
| `./ops/check-autoclose.sh` | `PASSED: run1=1, run2=0, double-punch rejected` | `SKIP: psql/createdb not on PATH` exit 0 |
| `cd web && pnpm verify` | check + biome + tsc + `next build`, 3 static routes | n/a |
| `swift /tmp/c.swift` (tag-link) | `tag-link-check: OK` | n/a, no DB, no Xcode |

Two environment problems, not repo problems, cleaned up during the run: three orphaned Node
servers from earlier agents were still listening on :8792–:8794 (started with the old
`ADMIN_PIN=p` env), plus a leaked `nfc_e2e_58452` scratch database. Killed and dropped. Worth a
glance at your own `ps` before trusting a local port.

---

## 6. Secrets — hardcoded or logged?

| Question | Finding |
|---|---|
| Secret in a log line? | **No.** The only server output is the boot banner and `[500] METHOD URL: message` (`server.js:207,219`). No body, no headers, no cookie, no token. Confirmed against a live login. |
| Password / hash / token logged? | **No.** `bin/create-admin.js` prints only the email and id. `lib/auth.js:12` carries an explicit "`console.log(session)` would defeat all of it" warning. |
| Password readable from argv / env / history? | **No.** `create-admin.js` is tty-only with echo off and refuses a non-tty. |
| Secret in the web bundle? | **No.** `web/scripts/check.mjs:165` fails the build on `x-admin-pin`, `adminPin`, `sessionStorage` or `document.cookie` anywhere in `app/`, `components/`, `lib/`. Zero `console.*` in the web source. |
| Secret in the iOS binary? | **Yes, by design.** `API.swift:25` bakes in the app key, flagged `ponytail:` with its ceiling. Inherent to a keyless client. See BLOCKER-1 — the *current value* is the problem, not the pattern. |
| Password storage | scrypt N=16384 r=8 p=1, 16-byte salt, `timingSafeEqual`, PHC-style `scrypt$N$r$p$salt$key`. Verified live: hash prefix `scrypt$16384`. |
| Cookie | `ts_session=…; Path=/; Max-Age=604799; HttpOnly; Secure; SameSite=Strict`. Verified on the wire. |
| Account enumeration | Unknown email, wrong password and malformed input all return `401 {"error":"invalid_credentials"}` and all pay the same scrypt cost (decoy hash). Verified: unknown email → `invalid_credentials`, not `not_found`. |
| Secrets in the repo | `legacy-backup/timesheets.env` — now gitignored, never tracked. `state.md` — redacted. |

---

## Fixed in this pass

1. Nine stale `ADMIN_PIN` / `X-Admin-Pin` / `?l=<slug>` references (table in §1).
2. `.gitignore` — added `legacy-backup/` (held the plaintext prod `APP_KEY` and `ADMIN_PIN`).
3. `state.md` — redacted the PIN; corrected the status line, the PM2 claim, the `manualFinish`
   description, and the tag-URI format.
4. `README.md` — the local-dev block documented a login flow that cannot work. The server sends
   **no CORS headers** and the cookie is `Secure; SameSite=Strict`, so `pnpm dev` on :3000
   cannot authenticate against the API on :8080. Replaced with the same-origin
   `PUBLIC_DIR=../web/out` recipe, which is also how production runs.
5. `web/lib/api.ts` — the same false claim ("Required cross-origin in `pnpm dev`") corrected in
   the doc comment. Behaviour unchanged.
6. `README.md` — "18 API behaviours" → the file now runs 46.

No behaviour was changed. Every fix is a comment, a doc, or `.gitignore`.

---

## Needs a human decision — NOT fixed, deliberately

1. **BLOCKER-1, the app-key rotation.** Above.
2. **`sessions.token` is stored raw.** A leaked `pg_dump` yields live sessions for up to 7 days.
   Storing `sha256(token)` as the PK closes it for one line at no cost. The API agent flagged
   this and declined to change a peer's schema mid-flight. Correct call; still open. Effort: low.
3. **`needs_correction` was dropped** beyond the literal instruction. It encoded exactly
   `auto_closed AND corrected_at IS NULL` — a third flag free to drift, which is the class of
   bug B4 existed to kill. Consequence: "unresolved" is derived everywhere and cannot disagree
   with itself. Reviewed and endorsed, but it is a schema change nobody asked for.
4. **Auto-closing the old shift when a worker taps a different building**
   (`ContentView.swift:132-144`). The server permits one open shift per worker and the worker
   cannot walk back to the previous tag, so the alternative deadlocks. The app says so out loud
   in an alert. Owner should confirm this is the desired payroll behaviour.
5. **Offsite backup target.** `ops/backup/pg-backup.sh:67` still has `TODO(offsite)` with three
   commented options (rclone / rsync / restic) and no provider chosen. Parked low-prio by
   agreement — but until it is picked, a `pg_dump` next to the database on the same disk is not
   a backup. One disk failure is total data loss.
6. **No CORS on the API.** Same-origin in production, so not a bug — but it does mean `pnpm dev`
   cannot exercise a real login. Documented rather than "fixed", because choosing an allowed
   origin list is a design decision, not a typo.

---

## Owner actions at a laptop

**Before deploy**

1. **Rotate `APP_KEY`** (BLOCKER-1). New value → `/etc/nfc/env` **and** `API.swift:25`. These
   must land together; the old key stops working the instant the env file changes.
2. **Xcode build + verify.** No agent compiled the app — source edits only. Then:
   - App ID needs **Associated Domains** and **NFC Tag Reading** capabilities. The entitlements
     file now requests `NDEF`, not `TAG`.
   - `INFOPLIST_KEY_NFCReaderUsageDescription` in `project.pbxproj` still reads
     *"Reads NFC tags to say hello"*. That string ships to users in a system prompt.
   - Ship a TestFlight build carrying the rotated key.

**At deploy**

3. `./ops/deploy.sh timesheets.exe.xyz` — order is load-bearing (migrate before restart).
4. **Create the first admin, on the VM:**
   ```bash
   ssh timesheets.exe.xyz
   sudo -u app bash -c 'set -a; . /etc/nfc/env; set +a; node /srv/nfc/bin/create-admin.js'
   ```
   Interactive only, echo off, 12-character floor. There is no seeded admin and no default
   password — **without this the web admin cannot be logged into at all.**
5. **Enable the timer**, or the 8h net is correct but not armed:
   ```bash
   sudo systemctl enable --now nfc-autoclose.timer nfc-backup.timer
   systemctl list-timers 'nfc-*'
   ```
6. `server/wellknown/verify.sh timesheets.exe.xyz` — `deploy.sh` runs it, but read the output.
   A wrong `Content-Type` or a single redirect on the AASA path means **every tag in every
   building has to be physically rewritten** (decision-4).

**Make the exe.dev proxy public**

7. Apple's CDN must be able to fetch `/.well-known/apple-app-site-association` from the open
   internet. Universal links do not work until it can, and the NFC background tap is the whole
   product.

   **This also exposes `/admin/*` to the internet — which is precisely why the PIN had to go.**
   A 6-digit shared secret with no rate limit and no length floor was defensible only while the
   host was obscure. What replaces it, and what you are relying on: password auth
   (decision-20), scrypt hashing, server-side revocable sessions, `HttpOnly; Secure;
   SameSite=Strict` cookies, a uniform `401` with constant-time cost so the login is not an
   account oracle, and per-IP rate limiting (5 failures → doubling lockout, 15-min cap).
   Choose a real password when you run `create-admin.js`. It is now the only thing between the
   internet and your payroll data.

**After deploy**

8. Write the tags: `https://timesheets.exe.xyz/t?l=<location uuid>`. Read the UUIDs with
   `psql "$DATABASE_URL" -c 'select slug, id from locations order by slug'`. A tag holding a
   slug, or read by hardware UID, resolves to nothing.
9. Pick the offsite backup target (§ *Needs a human decision*, item 5).
