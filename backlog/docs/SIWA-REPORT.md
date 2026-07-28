# Sign in with Apple — verification report (decision-22)

Verified against files on disk, not against the implementation reports. All checks re-run.

---

## BLOCKERS (lead)

1. **Xcode capability not enabled yet (owner action, cannot be done from a shell).**
   `NFCTimeSheets.entitlements` already carries `com.apple.developer.applesignin = ["Default"]`,
   but the App ID `io.github.qwadratic.NFCTimeSheets` (Team `6Y842FE8Q4`) must have the
   **Sign in with Apple** capability enabled in the Developer portal / Xcode → Signing &
   Capabilities, or the build fails to provision. See "What the owner must do" below.

2. **Migration 002 is NOT applied on the live box.** Confirmed read-only over SSH:
   `schema_migrations` holds only `001_init.sql`; `workers` has no `apple_sub` / `email`.
   Until `node server/db/migrate.js` runs there, `/auth/apple` 500s on every call.
   Applying it on top of production shape was simulated locally and is clean (below).

3. **No workers screen in the web admin.** `web/` has `login` + shell + nav only; there is
   no worker form at all, so the admin cannot type a worker's email in a browser today.
   First enrolment must be done with `curl` against `POST /admin/workers` (recipe below).
   Needs a human decision: ship the worker CRUD screen, or run enrolment by curl for now.

4. **Cannot prove `project.pbxproj` was untouched — the repo has no commits** (`git rev-parse
   HEAD` fails; everything is staged-but-uncommitted). What *is* verifiable: the target uses
   `fileSystemSynchronizedGroups`, so `Auth.swift` needed no pbxproj edit; `CODE_SIGN_ENTITLEMENTS`
   already pointed at the entitlements file; `IPHONEOS_DEPLOYMENT_TARGET = 18.6` for the app
   target. No pbxproj change is required for this work to build.

Nothing else blocks. Everything below passed.

---

## Findings against the brief

### 1. Can the client still name the acting worker? — **NO. PASS.**

Every hit for `worker_id` in a request body/query was traced:

| Location | Verdict |
|---|---|
| `routes/app.js` | `worker_id` appears only as a **column name** in SQL and in comments. Every handler takes identity from `session.workerId`. `?worker=` is gone from both GETs. |
| `routes/auth.js` | identity comes from the verified Apple token only. |
| `routes/admin.js:245` `body.worker_id` | **admin** route (`PATCH /admin/shifts/:id`), behind `ts_session`, validated via `v.activeWorkerById`. Correct: reassigning a shift is an admin power, not a worker one. |
| `server.js` | `auth: "worker"` on all `/roster` + `/shifts/*`; app-key alone gets a 401. |

`check-api.js` sends `worker_id: <otherWorkerId>` on `POST /shifts/open` on purpose and asserts
the row lands on the session's worker. No app-key-only shift route survives.

### 2. Apple token verification — **REAL. PASS.**

`server/lib/apple.js`, stdlib only (`createPublicKey({format:"jwk"})` + `crypto.verify`), deps
still exactly `pg`.

- Order is shape → header (`alg === "RS256"` **checked, never obeyed**; `kid` required) →
  **RSA-SHA256 signature** → only then `iss` / `aud` / `exp` / `iat` / `nonce` / `sub`.
  The payload is not even `JSON.parse`d until the signature passes.
- `aud` pinned to `io.github.qwadratic.NFCTimeSheets`; `iss` pinned to `https://appleid.apple.com`;
  `exp` with 60 s skew; `iat` rejected if in the future.
- **Fails closed**: every JWKS failure (fetch throw, non-200, malformed, zero usable RSA keys,
  unknown `kid`) throws; `routes/auth.js` turns every throw into one opaque `401 invalid_token`.
  There is no branch that returns a payload on an outage.
- JWKS cached 6 h, re-fetched on unknown `kid`, floor 60 s, 5 s timeout.
- Covered by checks: attacker-key forgery, `alg:"none"`, wrong `aud`, wrong `iss`, expired,
  unknown `kid` — all 401, all mint zero session rows.

**Fixed (was mechanically broken):** the nonce halves disagreed. iOS puts `SHA-256(raw)` in
`ASAuthorizationAppleIDRequest.nonce` (so the token claim holds the hash) and posts the **raw**
value; the server compared the claim against the raw value. Every real sign-in would have 401'd.
`lib/apple.js` now hashes before comparing (`hashNonce`, lowercase hex, byte-identical to iOS
`AppleNonce.hashed`), and `check-api.js` gained a case pinning the pair — matching hash passes,
raw-in-claim and stripped-nonce both 401.

### 3. Worker session tokens hashed, admin helper reused — **PASS.**

`createWorkerSession` / `destroyWorkerSession` / `destroyWorkerSessions` / `requireWorkerSession`
all go through the same module-level `hashToken` (`SHA-256`) that the admin path uses in
`lib/auth.js`. One implementation, one file, no copy. Checked: the raw token appears nowhere in
`worker_sessions`, only its hash; the response body never contains it.

### 4. Worker A reading/resolving worker B's shifts — **PASS (cannot).**

`close`, `GET /shifts/open`, `/shifts/unresolved` and `/shifts/:id/resolve` all carry
`AND worker_id = session.workerId`; someone else's `client_uuid` or sequential shift id answers
`404`, same as a nonexistent one (no existence oracle). Deactivation is enforced by the
`AND w.active` join inside `requireWorkerSession`, i.e. on **every** request, sub match or not.
`check-api.js` covers it directly ("a worker cannot read or resolve another worker's shifts",
"deactivation locks them out").

### 5. Ineligible screen is a dead end — **PASS.**

`ContentView.swift` switches on `session.state`; the `.ineligible` branch **does not construct a
`TabView` at all**, so there is nothing to navigate to — no tab bar, no `NavigationStack`, no
`Link`, no sheet. Sole control is `Sign out`. The echoed email is rendered (monospaced,
`textSelection(.enabled)`), the card is one accessibility element labelled
`"Your sign-in address: j 7 k 2 p at privaterelay.appleid.com"` (spelled out for dictation over the
phone), the icon is `accessibilityHidden`, the title has `.isHeader`, the whole message is posted
as an `AccessibilityNotification.Announcement`, and the screen scrolls for large Dynamic Type.

### 6. Migration on top of the applied 001 — **PASS.**

`002_worker_identity.sql` is additive only (two NULLable columns + one new table + two indexes);
`001_init.sql` is untouched. Simulated production shape locally — fresh DB, apply 001, record
`001_init.sql` in `schema_migrations`, insert one admin row and one worker row, then run
`db/migrate.js`: `applied 002_worker_identity.sql`, existing worker row intact
(`Anna||‌|t`), second run `up to date`. Live `schema_migrations` already contains exactly
`001_init.sql`, so the runner will not re-run 001.

### 7. Checks — all ran, none skipped, none failed.

| Check | Result |
|---|---|
| `cd server && node check-api.js` | **PASS** — 64 cases, ran against a real Postgres (throwaway schema) |
| `cd server && node db/check-migrate.js` | **OK** |
| `node server/check-close-flag.mjs` | 7 pass, 0 fail (must run from repo root — it opens `server/routes/app.js` relatively) |
| `cd server && node --test routes/wellknown.test.js` | 1 pass, 0 fail |
| `swift /tmp/tag-link-check.swift` (concat of TagLink + API + check) | **OK** |
| `xcrun --sdk iphoneos swiftc -typecheck -target arm64-apple-ios18.0 NFCTimeSheets/*.swift` | **clean** |

### 8. Token / sub / email logging — **PASS (none).**

Only `console.*` in the server: `apple.js` logs a JWKS transport failure (URL + `err.message`,
token not in scope), `server.js` logs `[500] METHOD URL: err.message` (Postgres puts offending
values in `err.detail`, which is not logged) and one boot line. No token, `sub`, email, cookie or
password is logged anywhere; `requireWorkerSession` deliberately returns neither email nor
`apple_sub`, and `WORKER_COLS` never exposes `apple_sub`.

### 9. iOS API level — **PASS.**

`xcrun swiftc -typecheck -target arm64-apple-ios18.0` over all app sources is clean, which is the
availability check: anything newer than 18.0 would error. No `@available` shims needed, nothing
from iOS 26 (no `glassEffect`, no `scrollEdgeEffect`, no `tabBarMinimize`). App target is
`IPHONEOS_DEPLOYMENT_TARGET = 18.6`.

---

## What I fixed (mechanical only, no redesign)

1. `server/lib/apple.js` — nonce claim is now compared against `SHA-256(posted raw nonce)`.
   Without this **every** sign-in that used a nonce would have returned 401, and the app always
   sends one.
2. `server/check-api.js` — new case `the nonce claim is the SHA-256 of the posted raw nonce`
   (matching pair passes verification, raw-in-claim and stripped nonce both 401).
3. `NFCTimeSheets/NFCTimeSheets/API.swift` — the app called **`GET /auth/me`**, the server serves
   **`GET /auth/session`**. Every launch would have 404'd. Path corrected; comment in `Auth.swift`
   updated to match.
4. `NFCTimeSheets/NFCTimeSheets/API.swift` — `WireSession.expiresAt` is now `Date?`.
   `GET /auth/session` answers `{worker:{id,name}}` with no `expires_at`, so the non-optional
   field made `restore()` fail to decode on every launch.
5. `server/README.md` — nonce spelling documented (claim holds the hash, body carries the raw).

## Wire contract (as it now stands on disk)

```
POST /auth/apple      X-App-Key            {identity_token, nonce?, name?}
  200 {worker:{id,name}, expires_at}
      Set-Cookie: ts_worker=<64 hex>; Path=/; Max-Age=7776000; HttpOnly; Secure; SameSite=Strict
  403 {error:"not_eligible", email}   email = exactly what Apple returned, lower-cased, may be null
                                      (does NOT count toward the lockout)
  401 {error:"invalid_token"}         any verification failure, incl. a JWKS outage
  429 {error:"too_many_attempts"}     Retry-After: <s>   (limiter shared with /admin/login)
  nonce: the app sends the RAW value; the token's `nonce` claim holds lowercase-hex SHA-256(raw).
  name:  first authorization only, hint only — the server ignores it.

GET  /auth/session    X-App-Key + ts_worker -> 200 {worker:{id,name}}          401 unauthorized
POST /auth/logout     X-App-Key + ts_worker -> 200 {ok:true} + cleared cookie, row deleted

All /roster and /shifts/*: X-App-Key AND ts_worker, else 401 {error:"unauthorized"}
GET  /roster                                   -> {worker:{id,name}, locations:[…]}   (no workers array)
POST /shifts/open   {client_uuid, location_uuid, start_time}   -> 201 {shift,duplicate:false}
                                                                  200 duplicate / 409 shift_already_open
POST /shifts/close  {client_uuid, end_time, auto_closed?}      -> 200 {shift,duplicate} / 404 unknown_shift
GET  /shifts/open                                              -> {shift|null}
GET  /shifts/unresolved                                        -> {shifts:[…]}
POST /shifts/:id/resolve {end_time}                            -> 200 {shift} / 404 / 409 already_resolved
NO request body or query anywhere on these routes names a worker.

POST /admin/workers   ts_session   {id?, name, email?, hourly_rate_cents, active}
  -> {worker:{id,name,email,hourly_rate_cents,active,created_at}}   400 invalid_email / 409 email_taken
DELETE /admin/workers/:id  -> soft delete (active=false) + all worker_sessions revoked
```

## What the owner must do in Xcode

1. developer.apple.com → Certificates, IDs & Profiles → Identifiers →
   `io.github.qwadratic.NFCTimeSheets` → enable **Sign in with Apple** (Enable as primary App ID)
   → Save. Let the provisioning profile regenerate.
2. Xcode → target `NFCTimeSheets` → Signing & Capabilities → **+ Capability → Sign in with Apple**.
   The entitlement key is already in `NFCTimeSheets/NFCTimeSheets.entitlements`
   (`com.apple.developer.applesignin = ["Default"]`) alongside the NFC + associated-domains keys —
   Xcode should show it already ticked; if it rewrites the file, keep all three keys.
3. Build and run. New files (`Auth.swift`, `API.swift`, `Sync.swift`, `TagLink.swift`) are picked up
   automatically — the target uses file-system-synchronized groups, no pbxproj surgery.
4. Archive → TestFlight (internal). Sign in with Apple works on a real device; the Simulator needs
   an Apple ID signed in under Settings.

## Deploying the server side

```bash
rsync -a server/ timesheets.exe.xyz:/srv/timesheets/server/       # or the usual deploy path
ssh timesheets.exe.xyz
  cd /srv/timesheets/server
  DATABASE_URL=postgres:///nfc node db/migrate.js   # -> "applied 002_worker_identity.sql"
  sudo systemctl restart timesheets-api
  curl -s localhost:PORT/health
```

## Registering the first worker

1. Admin creates (or updates) the worker row **with the email** the worker uses for their Apple ID:

   ```bash
   # log in once to get the admin cookie
   curl -s -c /tmp/c -X POST https://timesheets.exe.xyz/admin/login \
     -H 'content-type: application/json' \
     -d '{"email":"admin@example.at","password":"…"}'

   curl -s -b /tmp/c -X POST https://timesheets.exe.xyz/admin/workers \
     -H 'content-type: application/json' \
     -d '{"name":"Anna","email":"anna@example.at","hourly_rate_cents":1500,"active":true}'
   ```

   Note: `POST /admin/workers` with an `id` is a **full replace** — omitting `email` sets it to
   NULL. Always send every field when editing.

2. Worker opens the app → **Sign in with Apple**. If Apple returns the real address and it matches
   an active row, they are in; the server binds `apple_sub` to that row and every later login
   matches on the sub (so the admin may edit the email afterwards without locking them out).

3. **Hide My Email caveat — expect this on the first try.** If the worker chose "Hide My Email",
   Apple hands over `x@privaterelay.appleid.com`, which nobody could have registered in advance,
   so they land on the dead-end screen. That screen shows the exact address (selectable,
   VoiceOver spells it out). The worker reads it to the manager, the manager pastes it into the
   worker record (step 1 with the `id`), the worker taps Sign out → Sign in again. Done. There is
   no approval queue and none is needed.

4. Deactivating: `DELETE /admin/workers/:id` sets `active=false` and deletes their session rows;
   `active` is re-checked on every request, so lockout is immediate — and re-signing-in with the
   same Apple ID is refused too.

## Still open / needs a human decision

- Worker CRUD screen in the web admin (blocker 3). Effort: medium. Until then, enrolment is curl.
- Nothing pins the iOS→server nonce spelling across the two languages in one check; the Swift
  check pins `AppleNonce.hashed("abc")` to the SHA-256 vector and `check-api.js` pins the server
  side to the same construction. Two checks, one convention. Acceptable; a cross-language check
  would need a build step neither side has.
- `ponytail:` login rate limiter is an in-process `Map` (ceiling: resets on restart, single
  process, no per-IP-rotation defence). Unchanged by this work, fine for 5–20 workers.
