# NFC TimeSheets server

Node 22 + Postgres 16, one process on the exe.dev VM (decision-16). Serves the REST API, the
AASA / assetlinks / `/t` files and the static Next.js admin export. Only dependency: `pg`.

## Layout

```
server.js          http server, route table, static serving, boot + env fail-fast
routes/app.js      worker-session routes (iOS) /roster /shifts/open /shifts/close
                                              /shifts/unresolved /shifts/:id/resolve
routes/auth.js     Sign in with Apple (iOS)   /auth/apple /auth/session /auth/logout
lib/apple.js       Apple identity token verification (RS256 + JWKS, stdlib only)
routes/admin.js    session-cookie routes (web) /admin/*  (+ /admin/login, unauthenticated)
routes/wellknown.js AASA / assetlinks / /t, mounted before auth (decision-4)
lib/db.js          pg pool
lib/auth.js        app-key compare, scrypt passwords, sessions, login rate limit
lib/validate.js    input validation (tag values are untrusted - decision-15)
lib/http.js        JSON responses, machine-readable errors, bounded body reader
bin/create-admin.js  interactive CLI to create/re-password an admin
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

`POST /admin/shifts` enforces the same invariants as the tap path (active worker, active
building, end after start, nothing in the future) plus `409 shift_overlap` against any existing
shift of that worker, including an open one. `end_time` is required. It sets **no** flag: the
shift is marked by `client_uuid IS NULL`, which already means "no phone ever keyed this".

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

Boot aborts with a named list if any required var is missing. No secret is ever logged. There is
deliberately no admin credential in the environment any more — it lives in the `admins` table.

## Run

```bash
pnpm install
node server.js
```

## Check

```bash
node check-api.js   # uses DATABASE_URL, exits 0 with SKIP when no database is reachable
```

Creates a throwaway schema (`check_api_<pid>`), runs the API against it, drops it. Covers login
success/uniform failure/rate limit, session cookie hardening + expiry + revocation, open/close
idempotency, the 409 on a second open shift, UUID location resolution, timestamp bounds, 413,
the decision-10 resolution flow, `corrected_at` stamping rules, and admin CRUD.

Sign in with Apple is covered with **locally generated RSA keys and an injected JWKS** — the
check never calls `appleid.apple.com`: forged signature, `alg:"none"`, wrong audience, wrong
issuer, expired, unknown `kid`, unknown email → `403` with the address echoed, inactive worker
rejected (with and without a bound sub), a valid worker getting a session whose token is stored
hashed, cross-worker isolation on `/shifts/*`, and deactivation killing a live session.

## Errors

`4xx` bodies are `{ "error": "<code>" }` (plus `"field"` for validation failures). Never a stack
trace. Codes: `unauthorized`, `invalid_credentials`, `too_many_attempts`, `not_found`,
`method_not_allowed`, `bad_json`, `body_too_large`, `invalid_field`, `invalid_slug`,
`invalid_uuid`, `invalid_id`, `invalid_timestamp`, `timestamp_out_of_range`,
`timestamp_in_future`, `end_before_start`, `unknown_worker`, `unknown_location`,
`unknown_shift`, `shift_already_open`, `already_resolved`, `slug_taken`, `conflict`,
`invalid_email`, `email_taken`, `invalid_token`, `not_eligible`, `internal_error`.

`shift_too_long` is gone on purpose: it rejected exactly the runaway shift the 8h timer exists
to handle, leaving that worker unable to clock out at all.

## ponytail: known ceilings

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
