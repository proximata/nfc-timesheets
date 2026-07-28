# Workers screen — what it is, how to run it, how to test Sign in with Apple end to end

Verified against disk on the date of writing. `pnpm verify` passes, `out/workers/index.html`
is emitted.

---

## 0. Blocking / needs a human

Nothing blocks the screen itself. Four things need a person before a real worker can sign in:

1. **The screen is not deployed yet.** It exists in `web/out/` only after a local build.
   `https://timesheets.exe.xyz/workers/` serves whatever the last `ops/deploy.sh` run pushed.
   Run `ops/deploy.sh` (it rsyncs `web/out/` → `/srv/nfc/public/`) before anyone tries to use it.
2. **You need an admin account.** There is no self-signup. On the VM:
   `cd /srv/nfc && DATABASE_URL=... node bin/create-admin.js` (interactive; see
   `server/README.md` §"Create the first admin").
3. **Hide My Email is a two-pass enrolment by design** (server/routes/admin.js, decision-22).
   The first sign-in of a relay-address user is *supposed* to be refused. See §4 step 6.
4. **Unrelated working-tree drift** was present during verification and is not part of this
   screen: `ops/deploy.sh` (rsync excludes for `check-*.js` / `seed.sql`) and
   `NFCTimeSheets/.../UserInterfaceState.xcuserstate` (Xcode UI state, binary). Commit or
   discard deliberately.

---

## 1. What was built

| File | What |
| --- | --- |
| `web/app/workers/page.tsx` | new screen: one create/edit form + a table with Edit and Deactivate/Reactivate |
| `web/lib/money.ts` | new: `parseEuroToCents` / `centsToEuroInput`, string+integer only |
| `web/lib/api.ts` | added `Worker`, `WorkerInput`, `fetchWorkers`, `saveWorker` |
| `web/messages/{en,de}.json` | `workers` namespace, key sets identical, German is real German |
| `web/app/globals.css` | `.worker-form`, `.field-hint/.field-error/.form-status`, `.data-table`, `.row-inactive`, `.cell-actions` |

No new dependency (`web/package.json` and `pnpm-lock.yaml` unchanged). No file under `server/`
or `NFCTimeSheets/` was changed by this work.

Server contract used, exactly as deployed:

- `GET /admin/data` → `{ workers: [...] }`, sorted `active DESC, name`. Only `workers` is read.
- `POST /admin/workers` → no `id` = create (201), `id` = update (200). Body
  `{name, email, hourly_rate_cents, active}` — field names match `upsertWorker` one for one.
- `409 email_taken` is the only conflict the route can raise (the `workers.email` UNIQUE
  index), so the screen maps 409 onto the email field: "A worker with this email address
  already exists."
- `400 invalid_field/invalid_email` and `404 unknown_worker` → generic "the server rejected
  these details". `401/403` → redirect to `/login/`. `0` or `5xx` → the shared `error.*` message.
- Empty email is sent as `""`; the server's `optionalEmail` turns that into `NULL`. That is a
  legitimate state and the table renders it as "No email — cannot sign in".
- The server lower-cases the email on write. Typing `Anna@Example.at` is safe.

Deactivating uses `POST /admin/workers {active:false}`, not `DELETE /admin/workers/:id`. The
difference: `DELETE` also deletes the worker's session rows. It does not matter for lockout —
`requireWorkerSession` re-reads `workers.active` on every request (`server/lib/auth.js:224`,
`AND w.active`) — but a deactivated worker's session row survives until it expires.

### Money

`14.50` → `1450`. `14,50` (German keyboard) → `1450`. `14.5` → `1450`. `12,3` → `1230`.
No float is ever multiplied: the regex splits euros and fraction, the fraction is
`padEnd(2,'0')` and parsed as an integer, then `euros * 100 + cents`. `1.005` is **rejected**,
not silently rounded to 100 or 101. Empty and malformed input return `null`, which surfaces as
a field error — never a silent `0`. Round-trip `centsToEuroInput → parseEuroToCents` is exact
for 0, 5, 50, 1450, 99999999. Ceiling is 999999.99 €/h, under the server's 100_000_000 cap.

---

## 2. Run the admin locally

The session cookie is `Secure; SameSite=Strict` and the API sends no CORS headers, so
**`pnpm dev` cannot log in**. It is for layout work only. To exercise a real login, build the
export and let a server serve it same-origin.

Against a **local** API + Postgres (safest):

```bash
cd web && pnpm install && pnpm build          # emits web/out/
cd ../server && DATABASE_URL=postgres:///nfc PUBLIC_DIR=../web/out node server.js
# open http://localhost:8080/workers/
```

Against the **live** API: do not proxy it, just deploy. `ops/deploy.sh` builds nothing —
build first, then deploy:

```bash
cd web && pnpm verify                          # check + lint + typecheck + build
cd .. && ops/deploy.sh                         # rsyncs server/, web/out/ -> /srv/nfc/public/
# open https://timesheets.exe.xyz/workers/
```

`pnpm verify` must pass before deploying. It enforces exact npm pins, en/de key parity,
non-empty German values, placeholder parity, and that `lib/api.ts` still sends the cookie.

---

## 3. Using the screen

1. `https://timesheets.exe.xyz/login/` → admin email + password → lands on `/`.
2. "Workers" in the sidebar.
3. Fill Name, Email address (app sign-in), Hourly rate (`14,50` or `14.50`), leave **Active** ticked.
4. "Add worker". The row appears in the table; the form clears and focus returns to Name.
5. "Edit" on a row loads it into the same form; "Save changes" updates it; "Cancel" clears it.
6. "Deactivate" is the lockout. The row stays (shift history must survive) and reads
   "Inactive — cannot sign in". "Reactivate" undoes it.

---

## 4. End-to-end: enrol a tester and sign in with Apple, for real

You need: an admin login, the tester's Apple ID, a physical iPhone, Xcode with the team
`6Y842FE8Q4` (or a TestFlight build).

1. **Ask the tester which email their Apple ID uses.** Not their work address — the address
   Apple has. If they will tap "Share My Email" at the prompt, this is the address you need.
2. **Log in to the admin panel** at `https://timesheets.exe.xyz/login/`.
3. **Add the worker.** Name, that Apple ID email, their hourly rate, Active ticked. Save.
   Confirm the row shows the email exactly, all lower case. A typo here is invisible to the
   worker — they only ever see "not eligible" — so read it back character by character.
4. **Put the app on the device.** Either:
   - Xcode: open `NFCTimeSheets/NFCTimeSheets.xcodeproj`, select the physical device, Run.
     Sign in with Apple needs a real device and a signed build; the Simulator is not a valid
     test of this flow.
   - Or push a TestFlight build (internal track) and have the tester install it.
5. **Tester taps "Sign in with Apple"** and chooses **"Share My Email"**. The app sends the
   Apple identity token to `POST /auth/apple`; the server verifies it and matches
   `workers.email`. Expected: signed in, straight to the clock-in screen.
6. **If the tester chose "Hide My Email"** (or the app shows the ineligible screen), this is
   the expected, designed path — not a bug:
   - Apple gave the server `something@privaterelay.appleid.com` instead of the real address.
     Nobody could have registered that in advance: Apple generates it per app, per user.
   - The server answers `403 not_eligible` **and echoes the address back**. The app renders it
     on the ineligible screen (`Auth.swift`, `state = .ineligible(email:)`).
   - The tester reads that `…@privaterelay.appleid.com` address off their screen to you.
   - You open Workers, click **Edit** on their row, replace the email with the relay address,
     **Save changes**.
   - The tester taps Sign in with Apple again. This time it matches and they are in.
   - There is no approval queue and no second mechanism. This copy-the-address step *is* the
     enrolment for Hide My Email users, and the hint under the email field says so.
7. **If they still cannot get in**, in order:
   - The email in the Workers row does not match, character for character, what the ineligible
     screen showed. Most likely cause by a wide margin.
   - The row is Inactive. The status column says so in words.
   - The tester stopped "Hide My Email" for the app in Settings → Apple ID → Sign in with
     Apple, which changes which address Apple sends. Re-read the ineligible screen and re-enter.
   - After changing the email of a worker who has **already** signed in once: they are not
     locked out and nobody else is let in — matching prefers the stored `apple_sub`, which
     stays bound to the row (`server/routes/admin.js`, `upsertWorker` doc comment).

---

## 5. Verification notes worth keeping

- One a11y defect was found and fixed during verification: `.cell-actions` was
  `display: flex` on a `<td>`, which drops the cell's table-cell role in the accessibility
  tree and detaches the action buttons from their row and column. Replaced with
  `white-space: nowrap` plus a sibling margin; the `<td>` keeps its default display.
- Errors are permanent `role="alert"` paragraphs wired to each input via `aria-describedby`,
  rather than nodes that appear and disappear — text changes inside a live region that already
  exists are announced far more reliably.
- Active/inactive is conveyed as **text** ("Inactive — cannot sign in"). The hatch pattern on
  the row is a second signal only, and the screen survives greyscale.
- `scripts/check.mjs` has **no** bare-JSX-literal rule despite being described as having one.
  `web/app/workers/page.tsx` was grepped manually and contains no bare JSX text; every visible
  string goes through `t()`. If that rule matters, it needs to be written.
