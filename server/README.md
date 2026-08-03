# NFC TimeSheets server

Node 22 + Postgres 16, one process on the exe.dev VM (decision-16). Serves the REST API, the
AASA / assetlinks / `/t` files and the static Next.js admin export. Two dependencies: `pg`
and `@sentry/node` (decision-23 — no framework, no ORM, no router, no logging library).

## Layout

```
server.js          http server, route table, static serving, boot + env fail-fast, access log
instrument.mjs     Sentry init. Loaded via `node --import`, BEFORE server.js
lib/scrub.js       redaction at the telemetry boundary (pure, the PII trust boundary)
routes/app.js      worker-session routes (iOS + Android) /roster /shifts/* /material-requests/*
routes/auth.js     Sign in with Apple (iOS)   /auth/apple /auth/session /auth/logout
lib/apple.js       Apple identity token verification (RS256 + JWKS, stdlib only)
routes/admin.js    session-cookie routes (web) /admin/*  (+ /admin/login, unauthenticated)
routes/wellknown.js AASA / assetlinks / /t, mounted before auth (decision-4)
lib/db.js          pg pool
lib/auth.js        app-key compare, scrypt passwords, sessions, login rate limit
lib/validate.js    input validation (tag values are untrusted - decision-15)
lib/http.js        JSON responses, machine-readable errors, bounded body reader
lib/materials.js   material-request shape + the status transition table (one copy)
lib/reporting.js   P&L and building analytics SQL (Vienna calendar, integer cents)
lib/prorata.js     largest-remainder split of a cent pot by weight (decision-6)
lib/geocode.js     address -> lat/lng via Google, FAILS SOFT, key never leaves the file
bin/create-admin.js  interactive CLI to create/re-password an admin
bin/geocode-backfill.js  pin buildings entered before geocoding existed; safe to re-run
check-api.js       runnable self-check (assert, no framework)
public/            static root for the Next.js admin export, override with PUBLIC_DIR
```

## Auth

Three layers, no overlap between the two session mechanisms.

**`X-App-Key`** — one shared secret baked into the iOS build, required on every app route
including sign-in. A **coarse** gate: it says "this is our app", never "this is Anna". Kept as
defence in depth.

**Worker routes** — Sign in with Apple, server-side session (decision-22). The app used to hold
a Settings picker bound to `@AppStorage("workerId")` and `POST /shifts/open` trusted
`body.worker_id`, so anyone holding the app key could file hours as anyone. **The server now
decides who the caller is, and no route reads a worker id from a request.**

- `POST /auth/apple {identity_token, nonce?}`
  - `200 {worker: {id, name}, expires_at}` + `Set-Cookie: ts_worker` (HttpOnly, Secure,
    SameSite=Strict, 90 days)
  - `403 {error: "not_eligible", email}` — a genuine Apple user who is not an active worker
    here. The email is echoed **on purpose**: with Hide My Email the address is
    `x@privaterelay.appleid.com` and the admin cannot guess it, so the worker reads it off the
    dead-end screen to their manager, who pastes it into the worker record. No approval queue.
  - `401 {error: "invalid_token"}` — one opaque code for every verification failure, including
    "Apple's JWKS is unreachable". Verification fails **closed**.
- Verification (`lib/apple.js`, stdlib only — no `jose`, no `jsonwebtoken`): RS256 signature
  against the JWKS key for the token's `kid`, then `iss`, `aud` (= the bundle id), `exp`, `iat`
  and the `nonce` when one was sent (the claim holds SHA-256(raw); the app posts the raw value). Signature first, claims second: a token that merely parses
  is not verified. The JWKS is cached in memory (6 h TTL) and re-fetched on an unknown `kid`,
  rate-limited to one attempt a minute.
- Eligibility: `apple_sub` match → returning worker; else `email` match on an **active**,
  unclaimed worker row → first login, bind the sub; else `403`. An **inactive** worker is never
  eligible, sub match or not — deactivating in the admin panel is a lockout, checked on every
  request.
- Sessions live in their own `worker_sessions` table under their own cookie name. The admin
  `sessions` table is untouched, so a worker cookie can never satisfy an admin route.
- Tokens are stored as **SHA-256(token)**, never raw — same helper as the admin path. A leaked
  `pg_dump` yields nothing replayable.
- `/auth/apple` shares the `/admin/login` rate limiter (one lockout policy). A `403` does *not*
  count as a failure: the manager registering the address must not be racing a lockout.
- Never logged: the token, the `sub`, the email.

**Admin routes** — email + password, server-side session (decision-20). `X-Admin-Pin` is
**gone**: a short shared secret with no rate limit and no length floor is not defensible on a
host that must be publicly reachable so Apple can fetch AASA.

- Passwords are hashed with `node:crypto` **scrypt** (N=16384, r=8, p=1), 16-byte random
  per-user salt, stored as `scrypt$N$r$p$<salt_hex>$<key_hex>`. No bcrypt/argon2 dependency.
- `POST /admin/login {email, password}` sets `ts_session` — **HttpOnly, Secure,
  SameSite=Strict**, 7 days. Not localStorage, not a bearer token: JavaScript must not be able
  to read it.
- `POST /admin/logout` deletes the session row. Logout revokes server-side, not just locally.
- Login is rate limited per caller IP: 5 failures, then a doubling lockout capped at 15 min.
- Every rejection returns the same `401 {"error":"invalid_credentials"}` and costs the same
  scrypt work, so the route cannot be used to enumerate accounts.
- Nothing here is ever logged: no passwords, no hashes, no tokens, no cookies.

Create the first admin (interactive; the password is never an argv or an env var, because
both leak into shell history, `ps` and the journal):

```bash
DATABASE_URL=postgres:///nfc node bin/create-admin.js
```

## Shifts (decision-19)

The app posts at clock-**in**, not on completion, so `end_time IS NULL` is a real state and the
8h auto-close timer has something to act on.

Every route below needs `X-App-Key` **and** a `ts_worker` session. The worker is taken from the
session; `body.worker_id` and `?worker=` are gone (decision-22) and are ignored if sent.

| route                      | body                                     | notes                                    |
| -------------------------- | ---------------------------------------- | ---------------------------------------- |
| `GET /roster`              | —                                        | `{worker, locations}`; no staff list      |
| `POST /shifts/open`        | `client_uuid, location_uuid, start_time`  | 201 new / 200 retry / 409 already open   |
| `POST /shifts/close`       | `client_uuid, end_time, auto_closed?`     | 200; retry is a no-op, no duration limit |
| `GET /shifts/open`         | —                                        | my running shift; server is authoritative |
| `GET /shifts/unresolved`   | —                                        | mine only: `auto_closed AND corrected_at IS NULL` |
| `POST /shifts/:id/resolve` | `end_time`                                | mine only; stamps `corrected_at`. 404 otherwise |
| `POST /material-requests`  | `body, location_uuid?`                    | 201; free text, `worker_id` from the session |
| `GET /material-requests/mine` | —                                      | mine only; the arrival banner polls this |
| `POST /material-requests/:id/seen` | —                                | mine only, `arrived` only; idempotent |

Every lookup is scoped to the session's worker, so another worker's `id` or `client_uuid`
answers `404` exactly like a nonexistent one — no existence oracle, no cross-worker writes.

Both halves are idempotent on `client_uuid`. A `UNIQUE` partial index allows at most one open
shift per worker, so a double tap gets a `409 shift_already_open` rather than two invoices.

`location_uuid` is the location's UUID (decision-21). The slug is a human-readable handle for
the admin UI and logs and is **never** accepted as a tag identifier.

Two flags, two facts (decision-10) — the old single `manual_finish` column was set both by the
timer and by a human and could not tell them apart:

- `auto_closed` — the 8h timer closed this shift. Machine-set; not patchable by an admin.
- `corrected_at` — a human supplied the real end time. Stamped **only** when a flagged shift is
  actually resolved, never on an ordinary admin edit.

There is no `needs_correction` column. "Unresolved" is derived, so it cannot drift.

## Admin write routes (003)

All of them need the `ts_session` cookie; the app key does **not** substitute for it. One
upsert route per thing, matching `POST /admin/workers`: **no `id` in the body means create
(201), an `id` means update (200)**. `DELETE` is always a *soft* deactivate — history has to
keep naming the worker, the building, the client that was paying and the person we reported to.

| route | body | notes |
| ----- | ---- | ----- |
| `POST /admin/clients` | `id?, name, active?` | `{client}` |
| `DELETE /admin/clients/:id` | — | soft; buildings keep pointing at it on purpose |
| `POST /admin/contacts` | `id?, client_id, name, email?, phone?, active?` | `{contact}`; email lower-cased, **not a credential** |
| `DELETE /admin/contacts/:id` | — | soft **and revokes their portal links** |
| `POST /admin/inventory` | `id?, name, kind, unit_cost_cents?, active?` | `{item}`; `kind` ∈ `product`\|`equipment`, one table |
| `DELETE /admin/inventory/:id` | — | soft |
| `POST /admin/locations` | + `client_id?, contact_id?, monthly_contract_cents?, target_minutes_per_month?` | contact alone implies the client; both must agree |
| `DELETE /admin/locations/:id` | — | soft **and revokes that building's portal links** |
| `POST /admin/shifts` | `worker_id, location_id, start_time, end_time` | 201; the phone-died recovery |
| `POST /admin/portal-grants` | `contact_id, location_id` | 201 `{grant, token, path}` — **raw token returned once** |
| `DELETE /admin/portal-grants/:token_hash` | — | revoke, idempotent |
| `PATCH /admin/material-requests/:id` | `status?, admin_note?, inventory_item_id?, quantity?, cost_cents?, location_id?` | `status` is a *transition*, checked against `lib/materials.js`; `409 invalid_transition` otherwise |
| `GET /admin/locations/:id/contracts` | — | price history, newest first |
| `POST /admin/locations/:id/contracts` | `monthly_contract_cents, target_minutes_per_month?, valid_from, note?, client_id?` | 201; closes the current period at `valid_from`. `409 contract_overlap` |
| `DELETE /admin/contracts/:id` | — | **current period only**; reopens its predecessor |
| `POST /admin/locations/:id/geocode` | — | "erneut geokodieren". 200 whether or not a pin came back |
| `POST /admin/settings` | `key, value` | allowlisted keys only; today just `pl_margin_baseline_bp` |
| `DELETE /admin/settings/:key` | — | back to "nobody has told me"; nothing is flagged again |

`POST /admin/shifts` enforces the same invariants as the tap path (active worker, active
building, end after start, nothing in the future) plus `409 shift_overlap` against any existing
shift of that worker, including an open one. `end_time` is required. It sets **no** flag: the
shift is marked by `client_uuid IS NULL`, which already means "no phone ever keyed this".

## Reports (005)

Both need the `ts_session` cookie and both **require** `from` and `to` (UTC instants, half-open
`[from, to)`). Unbounded is meaningful for a shift list and meaningless for a P&L, so a missing
end is `400 missing_field` rather than a silently substituted default month.

| route | notes |
| ----- | ----- |
| `GET /admin/pl?from=&to=` | revenue − labour − materials per building |
| `GET /admin/analytics?from=&to=&months=` | actual vs target minutes, trend, map state. `months` ≤ 24, clamped |

**Every calendar question is answered in `Europe/Vienna` by Postgres**, from the tz database,
never from a fixed `+01:00`/`+02:00`. A day belongs to the period its own Vienna midnight falls
in — the same "belongs to where it starts" rule as a shift. Vienna October is 31 days *and one
hour* long; Vienna March is 31 days *minus* one hour, so any day count derived by dividing by
86 400 000 is a day short every spring.

**Money is integer cents end to end.** Pro-ration uses `numeric` (exact decimal), never a float,
and rounds once at the end of a `SUM`.

What these routes refuse to guess — each is a `null` **plus a reason**, never a confident zero:

| situation | answer |
| --------- | ------ |
| no contract in the period | `revenue_cents: null`, `revenue_unknown_reason: "no_contract"` |
| revenue of exactly 0 | `margin_bp: null`, `margin_unknown_reason: "zero_revenue"` |
| no baseline configured | `baseline_set: false`, every `below_baseline: null` — **nothing is flagged** |
| materials but no payable hours | `unallocated_cents`, `unallocated_reason: "no_payable_labour_in_period"` |
| a request the admin has not priced | excluded from the pool **and** counted in `unpriced_requests` |
| no `target_minutes_per_month` | `target_minutes: null`, `variance_minutes: null` |
| fewer than two months with shifts | `trend_direction: null`, `trend_reason: "insufficient_data"` |

**Materials are split pro-rata by labour hours (decision-6)**, using largest remainder
(`lib/prorata.js`), so the per-building column sums back to the pot **exactly** — `round(total ×
share)` loses a cent on almost every three-way split. `material_requests.location_id` records
the building the worker *named* and is **not** a cost attribution: decision-6 considered and
rejected per-request attribution.

**decision-10 is honoured and made visible.** Labour uses exactly
`end_time IS NOT NULL AND NOT (auto_closed AND corrected_at IS NULL)` — copied, never
reformulated. The excluded shifts are reported per building as
`excluded_unresolved_shifts` / `excluded_unresolved_seconds`: a building that looks cheap
because three shifts are stuck awaiting resolution is not a cheap building.

**The known dishonesty, stated on the wire.** `labour.rate_basis` is `"current"`.
`workers.hourly_rate_cents` is one mutable column with no history, so every figure values *all*
history at *today's* rate. The screen must carry that as a permanent visible notice, not a
tooltip. Fixing it needs a `worker_rates` table that payroll reads — a decision record, not a
commit.

### Contract history

`location_contracts` is period-scoped (`valid_from`, `valid_to`, Vienna calendar `DATE`s,
half-open). `locations.monthly_contract_cents` / `target_minutes_per_month` remain as a **mirror
of the current row** so `/locations/`, `/reinigung/` and the shipped iOS build keep working with
no change. `syncContractFromLocation` + `mirrorLocationFromContract` are the only writers, and
`check-api.js` asserts the two never disagree.

The buildings **form** edits the current period *in place* (a typo was always wrong); recording
an actual price change is the explicit, dated `POST /admin/locations/:id/contracts`.

### Geocoding

`GOOGLE_GEOCODING_KEY` is optional and lives only in `/etc/nfc/env` — **not** in
`ops/branding.json` (decision-24 §9: identity is committed, a credential is not). `fetch` is
stdlib, so this adds no dependency.

**It can never block saving a building.** The row is written first; geocoding runs after and
every outcome — no key, quota, timeout, DNS failure — ends with `lat/lng` NULL and the building
created. Same rule decision-23 gives telemetry.

Three columns, none derivable from the others: `geocoded_at` (when we asked),
`geocode_status` (what happened), `street_view_status` (whether a photo exists).

- A **fuzzy match is not a pin.** Measured against the live key, `Nirgendwogasse 99999, 1010
  Wien` answers HTTP 200 / `status: OK` with `partial_match: true` and the centre of the 1st
  district; `Quatsch Quatsch Quatsch` answers with the centre of Austria. Both are rejected
  (`PARTIAL_MATCH` / `APPROXIMATE_ONLY`). A wrong pin is worse than no pin.
- **Render a Street View photo only when `street_view_status === 'OK'`.** The static image
  endpoint serves a grey "no imagery" JPEG with HTTP 200, so an `onError` handler alone ships a
  grey box and calls it a photograph.

## Client portal (public trust boundary)

`GET /portal/:token` → `{building:{name}, cleanings:[{date, first_name, minutes}]}` for the
**one** granted building. No session, no cookie, no login: the token in the URL *is* the
credential. 32 CSPRNG bytes, base64url; only `SHA-256(token)` is stored (same `hashToken` as
the session tables). Rate limited by the login limiter in its own bucket. Revoked and unknown
tokens both answer `404 {"error":"not_found"}`, identically. The token is redacted from the
500 log line, which is the only place a path is written out.

It discloses nothing else — no surname, email, phone, rate, `apple_sub`, other building,
client, contract figure, inventory item or id of any kind. First name plus a duration is the
GDPR minimum that answers the client's question; **do not enrich the payload.**

Why a link and not accounts: the director cannot administer passwords for other companies'
staff, and email delivery would mean running SMTP on the VM. Ceiling: anyone holding the link
sees that building's cleaning history. Upgrade path: contact accounts + magic-link email.

## Config (env only, systemd EnvironmentFile)

| var            | required | notes                                                |
| -------------- | -------- | ---------------------------------------------------- |
| `DATABASE_URL` | yes      | local socket / 127.0.0.1 only                        |
| `APP_KEY`      | yes      | `X-App-Key`, baked into the iOS build                |
| `PORT`         | yes      | exe.dev proxy terminates TLS in front of it          |
| `PUBLIC_DIR`   | no       | static root, defaults to `server/public`             |
| `PG_POOL_MAX`  | no       | pool size, default 10                                |
| `SENTRY_DSN`   | no       | **absent = the SDK is disabled**, see below          |
| `SENTRY_ENVIRONMENT` | no | defaults to `production`                            |
| `SENTRY_RELEASE` | no     | untagged if unset                                    |
| `GOOGLE_GEOCODING_KEY` | no | absent = buildings are saved with no pin, which is a supported state. **Never logged, never returned to a client** |

Boot aborts with a named list if any required var is missing. No secret is ever logged. There is
deliberately no admin credential in the environment any more — it lives in the `admins` table.

## Observability (decision-23)

A real tag tap failed in production and this process had **nothing to say about it**: the only
log line in the server was the 500 branch, so `journalctl` was empty and the diagnosis had to
come from reading iOS source. Two things fix that, and they are deliberately independent.

**Access log — journald, no dependencies, always on.** One line per request from `console.log`:

```
[req] POST /shifts/open 201 34ms w=7
[req] POST /shifts/open 422 11ms w=7 err=unknown_location
[req] GET /nope 404 1ms
```

Emitted iff the request **failed**, matched a **route**, or was answered by `wellknown()`. A
static asset answering 200 is silent — the admin panel is a Next.js export and `/_next/*` alone
would bury every API line. A 404 for a missing asset still logs; that is a real signal.
The path is redacted and the **query string is dropped entirely** (`lib/scrub.js`): a
`/portal/<token>` path is a live credential. `w=<worker id>` is the only identity that appears.

**Sentry — optional, fail-soft, and the half that correlates.** `instrument.mjs` continues the
`sentry-trace` / `baggage` headers the iOS app sends, so one tap is ONE trace across the phone
and this process. With `SENTRY_DSN` unset the SDK installs nothing, opens no socket and costs
nothing; the API boots and serves identically. Nothing in a request handler awaits Sentry, so an
unreachable ingest cannot slow or fail a clock-in.

PII is scrubbed in **`lib/scrub.js`**, at the SDK boundary, not by remembering: `sendDefaultPii`
is off, `includeLocalVariables` is off, `dataCollection` is **omitted** (passing it — even `{}` —
flips cookies and request bodies back **on**), and `beforeSend` / `beforeSendTransaction` /
`beforeSendLog` / `beforeBreadcrumb` all run the denylist. Never leaves the process: Apple
identity tokens and nonces, `apple_sub`, `ts_worker` / `ts_session` cookies, `X-App-Key`,
passwords and hashes, worker emails, `hourly_rate_cents`, portal tokens. `Sentry.setUser` carries
**the worker id and nothing else**.

## Run

```bash
pnpm install
node server.js                                # Sentry inert, everything else identical
node --import ./instrument.mjs server.js      # as production runs it (pnpm start)
```

The `--import` flag is required, not cosmetic: this package is `"type": "module"`, so importing
`instrument.mjs` from inside `server.js` would run after `pg` and `node:http` are loaded and
nothing would be instrumented.

## Check

```bash
node check-api.js   # uses DATABASE_URL, exits 0 with SKIP when no database is reachable
```

The telemetry cases run **first and without a database**, because their whole point is that
they hold when nothing else does.

Creates a throwaway schema (`check_api_<pid>`), runs the API against it, drops it. Covers login
success/uniform failure/rate limit, session cookie hardening + expiry + revocation, open/close
idempotency, the 409 on a second open shift, UUID location resolution, timestamp bounds, 413,
the decision-10 resolution flow, `corrected_at` stamping rules, and admin CRUD.

Observability (decision-23) is covered by: the scrubber stripping an Apple identity token, a
session cookie, an app key, an email, a rate and a portal token out of a synthetic event
(asserted on the serialised JSON, so a value surviving in a nested span attribute fails);
`instrument.mjs` being import-safe with no DSN; `assertEnv` not requiring `SENTRY_DSN`; the
API serving with no DSN set; the access log recording a 404 and a 422 with its error code;
and a sweep asserting that a request battery carrying every one of those secrets writes
**none of them** to stdout or stderr.

Sign in with Apple is covered with **locally generated RSA keys and an injected JWKS** — the
check never calls `appleid.apple.com`: forged signature, `alg:"none"`, wrong audience, wrong
issuer, expired, unknown `kid`, unknown email → `403` with the address echoed, inactive worker
rejected (with and without a bound sub), a valid worker getting a session whose token is stored
hashed, cross-worker isolation on `/shifts/*`, and deactivation killing a live session.

005 adds, in the same file:

- **The pro-rata split** (`lib/prorata.js`, no database needed, so it runs anywhere): exhaustive
  over awkward pots × lopsided weights, asserting the parts sum back **exactly**; zero weight
  → zero cents; no weight at all → `null`, not a pile of zeroes; deterministic across re-runs.
- **The Vienna calendar on `/admin/pl`**: October 2025 (31 days *and an hour*) and March 2026
  (31 days *minus* an hour) both priced at exactly one monthly fee, with the naive
  `Δms / 86 400 000` shown to produce 30 for March; a 23:30 shift on 31 October (CET) counted in
  October, with the fixed-`+02:00` end bound shown to lose it.
- **A price change is period-correct**: 15 days at the old price + 16 at the new, never 31 at
  today's; overlapping periods refused; the `locations.*` mirror asserted to agree with the
  current contract row after *every* write path.
- **decision-10 is not regressed**: an unresolved auto-closed shift stays out of `labour_cents`,
  is reported in `excluded_unresolved_shifts`, and counts once `corrected_at` is stamped — with
  the material split still summing to the pot as the weights move.
- **Geocoding fails soft**: no key, a thrown geocoder and an exhausted quota all still create
  the building; the retry route pins it; a hand-placed `lat`/`lng` is never overwritten. A
  separate case drives the **real parser** with Google's real response shapes (captured from the
  live key) and asserts a `partial_match` / `APPROXIMATE` answer never becomes a pin.
- **Material requests**: `worker_id` taken from the session with a hostile `worker_id` in the
  body ignored; worker B cannot list or acknowledge worker A's request (`404`, nothing written);
  the lifecycle refuses every illegal jump; a late invoice edits the cost without moving
  `ordered_at`.

```bash
node db/check-migrate.js   # 005 applies over live rows; the contract backfill is idempotent
```

## Errors

`4xx` bodies are `{ "error": "<code>" }` (plus `"field"` for validation failures). Never a stack
trace. Codes: `unauthorized`, `invalid_credentials`, `too_many_attempts`, `not_found`,
`method_not_allowed`, `bad_json`, `body_too_large`, `invalid_field`, `invalid_slug`,
`invalid_uuid`, `invalid_id`, `invalid_timestamp`, `timestamp_out_of_range`,
`timestamp_in_future`, `end_before_start`, `unknown_worker`, `unknown_location`,
`unknown_shift`, `shift_already_open`, `already_resolved`, `slug_taken`, `conflict`,
`invalid_email`, `email_taken`, `invalid_token`, `not_eligible`, `internal_error`,
`missing_field`, `invalid_date`, `invalid_range`, `invalid_transition`, `unknown_request`,
`request_rejected`, `unknown_item`, `unknown_contract`, `contract_overlap`,
`contract_not_current`, `location_has_no_address`.

`shift_too_long` is gone on purpose: it rejected exactly the runaway shift the 8h timer exists
to handle, leaving that worker unable to clock out at all.

## ponytail: known ceilings

- **The access log fires on `res.on("finish")`.** Ceiling: a client that hangs up mid-response
  leaves no line. Upgrade path: also listen for `close` and de-duplicate on a flag.
- **Sentry is a dependency in the request path** (decision-23): ~33 transitive packages,
  30–60 MB RSS, µs-scale span + AsyncLocalStorage cost per request and per `pg` query.
  Ceiling: `@sentry/profiling-node` must never be added — it is a native addon and
  `ops/deploy.sh` rsyncs macOS-built `node_modules` to Linux (the deploy gates on this).
- **No framework, hand-rolled route table.** Deliberate: keeps a move to Hono/Supabase cheap.
  Ceiling: no middleware chain, no OpenAPI. Upgrade path: handlers are `(ctx) -> {status, body}`,
  re-wiring them is a day of work.
- **Single shared app key** for all workers. Since decision-22 it is only a coarse "this is our
  build" gate in front of a real per-worker session, not identity. Ceiling: a leaked key lets
  someone reach `/auth/apple` and `/admin/login`, nothing more. Upgrade path: App Attest.
- **Login rate limit is an in-memory `Map`, per process.** Ceiling: it resets on restart, does
  not span processes, and does nothing against an attacker rotating source IPs. Upgrade path:
  a `login_attempts` table keyed on `(ip, email)` behind the same three functions.
- **One trusted proxy hop** assumed when reading `X-Forwarded-For` (rightmost entry). Ceiling:
  add a CDN in front and every caller buckets under one address. Upgrade path: a
  `TRUSTED_PROXY_HOPS` env var.
- **`/admin/data` is one unpaginated blob** (capped at `?limit=`, default 500, max 2000).
  Upgrade path: real pagination + CSV export.
- **int8 ids parsed as JS numbers** (`lib/db.js`). Ceiling 2^53 rows.
- **Material arrival is POLLED, not pushed.** There is no APNs certificate, no FCM project and
  no device-token table, and server deps stay `pg` + `@sentry/node` (decision-23). The clients
  ask `GET /material-requests/mine` on launch and on refresh. Ceiling: a worker who never opens
  the app is never told. Upgrade path: APNs + FCM — a decision record and two vendor keys, not
  a commit.
- **Contract non-overlap is checked in the route**, not by an `EXCLUDE` constraint: that needs
  `btree_gist`, and installing an extension on a live payroll box is not worth one guarded
  `INSERT`. Ceiling: two admins posting concurrently could interleave. There is one admin.
- **Geocoding runs inside the request** (~8 s + ~4 s worst case on the buildings form). It never
  blocks the save. Upgrade path: a queue, which needs a retry policy and a way to tell the panel
  the row changed underneath it.
- **`app_settings` is a key/value table**, not a settings framework: no types (the route
  validates), no per-building override, no history. Upgrade path: a typed column per setting
  once there are three.
- **The trend is actual minutes only**, with no per-month target beside it. Ceiling: a building
  whose contracted target changed mid-trend shows the time moving without showing why.
- **`GET /admin/data` now also carries every open material request** plus the 500 most recent.
  Same unpaginated-blob ceiling as the rest of it.
