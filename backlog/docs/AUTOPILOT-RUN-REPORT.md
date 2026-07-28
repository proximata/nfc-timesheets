# Autopilot Run Report

Read top-down. Section 2 blocks deploy. Section 3 needs you specifically.

Nothing was deployed. Nothing touched the VM. No tags written. No Xcode build.
All backlog task statuses still `To Do` — agents wrote code, did not close tasks. Close them
yourself after you verify, or they will be re-picked.

---

## 1. WHAT WAS BUILT

| Area | Files | State |
|---|---|---|
| Schema | `server/db/` — 5 (`migrations/001_init.sql`, `migrate.js`, `check-migrate.js`, `seed.sql`, README) | complete, canonical |
| API | `server/` — 11 (`server.js`, `lib/*` 4, `routes/*` 3, `check-api.js`, pkg+lock) | complete for app+admin endpoints |
| Well-known | `server/wellknown/` — 4 (AASA, assetlinks, `t.html`, `verify.sh`) + `routes/wellknown.js` + test | complete, `verify.sh` → `VERIFY OK` against local boot |
| Ops | `ops/` — 11 (5 systemd units, `deploy.sh`, 2 backup scripts, `autoclose.sql`, `check-autoclose.sh`, README) | complete except offsite backup target |
| Web | `web/` — 22 (App Router shell, 4 components, 4 lib, i18n messages en/de, check script, configs) | **shell only** — one page (`app/page.tsx`) |

Checks that exist and pass locally: `server/check-api.js` (18/18), `server/db/check-migrate.js`,
`server/routes/wellknown.test.js`, `ops/check-autoclose.sh`, `web` `pnpm check` (6/6) + `pnpm verify`.
All DB-dependent checks skip with exit 0 when no Postgres.

Half-finished, explicitly: **web is a shell with no screens**, and **`web/lib/api.ts` (140 lines) has
zero importers** — a typed client written before any consumer.

---

## 2. BLOCKING ISSUES

Six. Three are code bugs, three are decision violations. All must be settled before deploy.

**B1 — Backup script discards every real backup.** `ops/backup/pg-backup.sh:50`
```bash
if ! gzip -dc "$tmp" | grep -qm1 'PostgreSQL database dump'; then
```
`grep -qm1` exits early → `gzip` gets EPIPE → 141 → `set -o pipefail` propagates → `!` inverts →
`FATAL` → `exit 1` → trap deletes the dump. Only triggers once the dump exceeds the pipe buffer.
**Passes on an empty schema. Starts failing the day there is payroll data in it.** Worst possible
ordering. Fix: consume full input via `$(gzip -dc "$tmp" | head -n 20)`, then grep that. Effort: low.

**B2 — iOS ↔ server wire contract does not match on any field.**
`ContentView.swift:78-84` sends `{id, worker, tagUID, start, end, manualFinish}`.
`routes/app.js:25-30` reads `{client_uuid, worker_id, location_slug, start_time, end_time, manual_finish}`.
Result: `400 invalid_field`. The app catches only `422`; `400` falls into a bare `catch {}`, so
`syncError` stays nil and the shift **retries forever with no UI signal**. Every shift ever worked
stays on the phone. `/roster` breaks the same way (`[String]` vs `[{id,name}]`, swallowed by `try?`).
Effort: medium (Xcode + a check that posts the iOS payload verbatim).

**B3 — Admin PIN has no rate limit, no lockout, no length floor.** `server/server.js:21` asserts
`ADMIN_PIN` is *present*, not that it is strong. `ADMIN_PIN=1234` boots. `/admin/data` returns every
worker, rate, shift and payroll figure. Unlimited attempts at line rate. Fix: length floor in
`assertEnv` + a ~10-line `Map<ip,{fails,until}>` returning 429. No dep. Effort: low.

**B4 — decision-10 flag semantics inverted.** `ops/sql/autoclose.sql:17` sets `manual_finish = true`
for a shift no human touched; `routes/app.js:74` sets the *same* flag on genuine manual resolution.
There is no `auto_finished` column. `web/lib/api.ts:44` documents `manual_finish` as "True when the
8h timer closed it" — the field name means its own opposite, and it is about to enter payroll UI and
the iOS contract. Effort: low now, high after data exists.

**B5 — decision-16 §6 offsite backup is a stub.** `ops/backup/pg-backup.sh:60` is a bare
`TODO(offsite)` with three unchosen options. Dumps land on `/var/backups/nfc` — same disk as the DB,
which the script's own header calls "NOT a backup". decision-16 names this the one item that must not
be deferred. `restore-test.sh` has never been run. Payroll data. Effort: low, but needs *your*
credentials (§3).

**B6 — decision-5: tag URI carries a guessable slug, not a UUID.** `001_init.sql:37` `slug TEXT UNIQUE`;
`validate.js:26` `/^[a-z0-9][a-z0-9_-]*$/`. decision-5 specifies `?l=<LOCATION_UUID>`. Does not block
the server deploy. **Blocks TASK-6.** Once tags are on walls, changing this is a physical rewrite round.
decision-15 (tags unlocked) keeps it reversible — at cost. Effort: low if decided now.

Also worth fixing before real data, not strictly blocking:
- Double-punch creates two overlapping shifts (`ON CONFLICT (client_uuid)` only dedupes retries of the
  *same* record). Both are summed by payroll. Fix is one `EXCLUDE USING gist` constraint in a new
  migration + map `23P01` → 409.
- `routes/admin.js:157` stamps `corrected_at = now()` on **every** admin edit, including shifts never
  flagged. Audit trail claims corrections that never happened.
- `routes/admin.js:37-41` payroll aggregate is unbounded and unfiltered by period while the row list is
  `LIMIT`ed — the totals will not reconcile with the visible rows, and history is priced at current rates.
- `ops/deploy.sh:47` rsyncs `db/seed.sql` ("DEV ONLY. DO NOT RUN AGAINST PRODUCTION") and `check-api.js`
  (which will `CREATE SCHEMA` against whatever `DATABASE_URL` it finds) to prod. Add two `--exclude`s.

---

## 3. NEEDS A HUMAN

An agent cannot do these, or should not.

| What | Task | Why you |
|---|---|---|
| Provision the live VM | TASK-1 | No VM access from here. Nothing in `ops/` has ever run on the box. |
| Choose offsite backup destination | (B5) | Provider choice + credentials. Then run `restore-test.sh` once. |
| Write physical NFC tags | TASK-6 | Physical. **Gated on `server/wellknown/verify.sh` passing against the live host** — and on B6 being decided. |
| All Xcode / iOS | TASK-7, 9, 10, 12, 13 | Xcode, signing, simulator. Includes the B2 wire-contract fix. |
| TestFlight upload | TASK-10 | Apple ID + App Store Connect. |
| Google Maps browser key | TASK-29 / TASK-16,17 | Referrer restriction still points at `*.vercel.app`. decision-16 killed Vercel. **Retarget onto the VM host** or the map view 403s on first load. |

---

## 4. DEPLOY ORDER

Reference: `backlog/docs/runbook-vm-provisioning.md` (§0 conventions, §1 hardening, §3–§5 units).
Its header still says the VM is "not on the critical path" — stale, decision-16 reversed that. Ignore
the header, the body is correct.

```
0.  Fix B1, B3, B4 locally. Decide B5 target and B6 slug-vs-UUID.        ← do not skip
1.  runbook §1  provision + harden        ssh timesheets.exe.xyz
2.  runbook §2  Postgres 16, DB name `nfc`, localhost/socket only
3.  /etc/nfc/env  0600 root  → DATABASE_URL APP_KEY ADMIN_PIN PORT
4.  runbook §3-§5  install ops/systemd/*.service + *.timer, daemon-reload
5.  ops/deploy.sh                        ← migrates BEFORE restart. Order is load-bearing.
6.  systemctl status nfc-api nfc-autoclose.timer nfc-backup.timer
7.  server/wellknown/verify.sh  against the LIVE host   → must print VERIFY OK
8.  ops/backup/pg-backup.sh once, then restore-test.sh against the pulled-back copy
9.  TASK-6 physical tags        ← ONLY after step 7 passes. Not before.
10. TASK-5 DNS cutover, TASK-7/9/10 iOS + TestFlight
```

Step 7 before step 9 is not a preference. If AASA is wrong, every tag on a wall opens Safari instead
of the app, and the fix is walking the buildings again.

`ops/deploy.sh` step 6 (`systemctl restart nfc-api`) fails until step 4 is done. Expected on a fresh box.

---

## 5. DECISIONS THE AGENTS MADE — reversible, your call

**i18n: decision-8 names `next-intl`. The agent wrote a 30-line local `t()` instead.**
`web/lib/i18n.ts:9-18`. Reasoning: static export, no server runtime, no need for the framework's
routing/server-component half. `en.json`/`de.json` are 36/36 keys, identical, same order, and
`web/scripts/check.mjs` enforces parity in CI-able form. The migration shape to `next-intl` is
preserved. This is the judgement call most worth your review — it is a real deviation from an accepted
decision, made silently, and it needs either a superseding ADR or a swap.

**PM2 dropped for plain systemd.** decision-1 mandates `pm2 startup`. `ops/systemd/nfc-api.service`
is a plain unit; `ops/README.md:3` says "no PM2". Rationale is written in the unit file. Technically the
better call — one less process supervisor on a box that already has one — but per AGENTS.md a decision
changes only via a new record. Needs an ADR.

**API dependency budget: exactly one runtime dep — `pg@8.21.0`.** No express, no framework, no dotenv,
no rate-limit lib. Router, body reader, MIME table and auth are hand-rolled in `server/lib/*` (~4 small
files). Upside: nothing to audit, nothing to patch, whole server readable in one sitting. Downside: the
hand-rolled parts are where B3 (no rate limit) and the `URIError`→500 path live — things a framework
would have given for free. Reversible cheaply if you want express; expensive later if you want it after
the routes grow.

**`server/wellknown/t.html` hardcodes user-visible English** (lines 53-77), outside the message files.
Deliberate — it is the no-JS landing page — and marked `STRINGS`, but it is an unrecorded exception to
decision-8's "no hardcoded strings from day one".

**Slug over UUID for locations** — see B6. Human-readable tags, guessable URLs.

**`GET /shifts` routing.** `POST /shifts` (API) and `/shifts/` (admin page) collide on one path. GET/HEAD
now falls through to the static export before the 405. Verified: `GET /shifts`→200, `PUT /roster`→405,
`GET /nope`→404, `POST /shifts` unauth→401. If you ever want an API `GET /shifts`, this is where it bites.

**DB name canonicalized to `nfc`** (was `nfc` in `ops/*`, `timesheets` in `server/db/README.md`). Anyone
following the old README would have created a database the autoclose timer and both backup scripts
cannot find.

---

## 6. WHAT WAS DELIBERATELY NOT BUILT

- **Every admin screen: TASK-15..22.** Auth/PIN login, map view, Street View, shifts table, shift edit,
  workers CRUD, locations CRUD, payroll summary. `web/` is layout shell + desktop blocker + i18n + nav
  only. `web/lib/nav.ts` lists the five routes; four of them 404.
- **All iOS work: TASK-7, 9, 10, 12, 13.** No Swift file was modified. The app still speaks the old
  protocol (B2).
- **v2 stubs beyond disabled nav entries (TASK-24).** `FUTURE_NAV` renders four locked labels
  (material requests, P&L, contracts, building analytics). No pages, no routes, no data model. Intentional.
- **decision-6 materials model.** 3B. `shifts.location_id` + timestamps support the pro-rata query when
  it lands; no materials tables exist.
- **`GET /shifts/unresolved` + `POST /shifts/:id/resolve` have no server-side input.** No write path
  creates `end_time IS NULL` — the app holds open shifts locally and posts only completed ones. So the
  entire 8h auto-close chain (`autoclose.sql`, both units, the index, both endpoints) is dead machinery
  until either the app posts open shifts or you delete it. It passes its check because the check inserts
  the open row itself. Worse: a worker who forgets to tap out for 30h produces a local shift that
  `422 shift_too_long`s forever — the exact case the 8h net was for. Pick one half. Do not ship both
  half-wired; dead safety machinery reads as protection.
