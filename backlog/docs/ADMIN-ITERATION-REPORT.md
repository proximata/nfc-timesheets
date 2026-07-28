# ADMIN PANEL — ITERATION REPORT (3A)

Verify pass. Everything below was read off the tree on disk, not off the three build
reports. Where a report and the code disagreed, the code won.

---

## 0. BLOCKERS FIRST

### 0.1 iOS — 🚨 nothing blocks TestFlight 🚨

**No iOS change is required and none was made.** `NFCTimeSheets/` is untouched;
`project.pbxproj` is untouched (`git status` on that path is empty). Every gap found in
this pass is fixable from the server or the admin panel. **Ship the binary.**

### 0.2 Still impossible after this iteration

1. **A shift that was never tapped still cannot be created.** There is no
   `POST /admin/shifts` in `server/routes/admin.js`; `patchShift` needs an existing row.
   Worker leaves the phone at home, works six hours, is paid €0, and the only recovery is
   SQL on the VM. This is the single most expensive remaining hole. (T6)
2. **Payroll has a shelf life.** `/admin/data` still has no `from`/`to`, so `/payroll/`
   sums the client-side payload and is bounded by the server's 2000-row cap. At 20 workers
   × 2 shifts/day that is about **ten weeks of history**. The screen detects the cap and
   prints "INCOMPLETE and too low", so it will not silently underpay — but after that it
   cannot answer for an older month at all. (T4)
3. **Sign-in failures are still invisible.** No `has_login`, no `last_seen_at`, no record
   of a rejected Sign in with Apple attempt. A worker who hits the ineligible dead end
   still has to read a relay address down a phone line, and the admin has no way to
   confirm anyone ever linked. (T8, T9, T10)
4. **The leaver trap is open.** Deactivating a worker with an open or unresolved shift
   still warns nobody. Now at least visible on `/` and `/payroll/` rather than silent. (T12)

### 0.3 Defects found and fixed in this pass

| # | Defect | Where | Fix |
|---|---|---|---|
| 1 | `/shifts/` fetched the server's **500-row default** while `/` and `/payroll/` asked for 2000. Payroll would count unresolved shifts and link "Confirm them now" to a screen that does not contain them. | `web/lib/api.ts` `fetchShiftSnapshot` | now requests `?limit=${ADMIN_SHIFT_LIMIT}`, same page as `fetchAdminSnapshot` |
| 2 | `updateShift` was typed as returning a full `Shift`. `PATCH /admin/shifts/:id` RETURNs the `shifts` row only — no `worker_name`, `location_slug`, `location_name`. A type lie that renders as `undefined` in the first cell that trusts it. | `web/lib/api.ts` | new `ShiftRow = Omit<Shift, …>` return type, documented |
| 3 | Two identical cents→euro formatters (`centsToEuroInput`, `centsToPlainEuros`) written by two agents. Same rounding rule in two places is how the worker form and the payroll CSV eventually disagree by a cent. | `web/lib/money.ts`, `web/lib/payroll.ts`, `web/app/workers/page.tsx`, `web/app/payroll/page.tsx` | one sign-safe `centsToPlainEuros` in `lib/money.ts`; the copy in `lib/payroll.ts` deleted |
| 4 | Saving the correction form on a timer-closed shift stamps `corrected_at` **even when nothing was changed** — the server can only see the merged row. That silently turns an 8-hour guess into payable hours, with no statement anywhere on screen. | `web/app/shifts/page.tsx` + `shifts.correctUnresolvedNotice` (en/de) | the form now says so, in words, whenever the shift being corrected is unresolved. Behaviour unchanged — accepting the timer's end time is a legitimate resolution; being surprised by it is not |
| 5 | CSV download revoked its object URL in the same turn as the click and used a detached anchor. Fails silently in Safari and Firefox — after the success message has already rendered. | `web/app/payroll/page.tsx` | anchor appended to the document, removed and revoked on the next tick; revoke on the failure path too |
| 6 | `.toolbar-field select` restated `.field select` byte for byte (payroll agent could not see the shifts agent's rule), on an element that already carries both classes. | `web/app/globals.css` | duplicate block removed, comment explains the composition |
| 7 | Comment in `lib/payroll.ts` claimed the shift log's "this month" means "the last 30-ish days". It does not — `periodStart('month')` is calendar first-of-month. A wrong comment about a money boundary. | `web/lib/payroll.ts` | corrected to the real distinction (browsing filter vs. closed pay period) |

No other change was made. No abstraction layer was introduced to tidy the three screens
into one shape; they are three tables with three jobs and they read the same way already.

---

## 1. Does it build?

```
$ pnpm verify        # check && lint && typecheck && build
  ok   package.json: all dependency versions are exact (no ^ or ~ or ranges)
  ok   .npmrc: save-exact=true
  ok   messages/en.json: non-empty, every leaf is a string
  ok   messages/de.json: key set identical to en.json
  ok   messages/de.json: all values are non-empty strings
  ok   messages/de.json: {placeholders} preserved
  ok   no admin PIN and no client-stored credential survives anywhere in the app
  ok   lib/api.ts sends the session cookie
All checks passed.

biome check .        Checked 29 files in 68ms. No fixes applied.
tsc --noEmit         clean
next build           ✓ Compiled successfully

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /locations
├ ○ /login
├ ○ /payroll
├ ○ /shifts
└ ○ /workers
```

`trailingSlash: true`, so the export writes `out/locations/index.html`,
`out/shifts/index.html`, `out/payroll/index.html`, `out/index.html`,
`out/workers/index.html`, `out/login/index.html`.

**Every `PRIMARY_NAV` href in `web/lib/nav.ts` resolves to a real page. No 404 remains in
the sidebar.** `FUTURE_NAV` stays locked and non-navigable; no v2 stub was built.

---

## 2. Did the three agents collide?

Fixed: defects 1, 3, 6 above (page size, duplicate money formatter, duplicate CSS rule).

Left alone, deliberately:

- **Two period models.** `lib/shifts.ts` `PERIODS` (week/month/quarter/year/all, open upper
  bound, a browsing filter) and `lib/payroll.ts` `PAYROLL_PERIODS` (this/last month,
  quarter, year, closed `[start, end)`). They are not the same thing — payroll needs
  `lastMonth` and a closed range; the log does not. Merging them would produce one
  parameterised period type that neither screen wants.
- **Two duration formats.** `formatDuration` → `8:30` on the log and the dashboard, because
  that is what a paper timesheet says; `8.50` on payroll, because that is what gets
  multiplied. Both are correct for their reader.
- **One payable rule, one implementation.** `shiftState` / `blocksPayroll` in
  `lib/shifts.ts` is used by `/shifts/`, `/payroll/` and `/`. Nobody re-derived it. This is
  the one that mattered and the agents got it right without coordinating.
- **Status presentation.** `/locations/` uses plain text ("Active" / "Inactive — tapping the
  tag does not start a shift"); `/shifts/` uses a badge plus an explanatory sentence. Both
  are text-first; the shift badge earns the extra weight because four states scan worse
  than two.

Terminology is the one real inconsistency left: `/locations/` calls a building **Objekt**
and a shift **Einsatz** in German, while `/shifts/` and `/` say **Gebäude** and
**Schicht**. Nav is `Locations`. Cosmetic, not a defect, but it should be settled before
German becomes the default locale (decision-8).

---

## 3. i18n

- **Key parity: exact.** 248 leaves in each file, zero one-sided keys, `{placeholders}`
  preserved. Enforced by `scripts/check.mjs` and by `Messages: typeof en` in `global.d.ts`.
- **No bare JSX text** in `app/locations/page.tsx`, `app/shifts/page.tsx`,
  `app/payroll/page.tsx`, `app/page.tsx`. Every visible string, including the visually
  hidden per-row button suffixes and the CSV column headers, comes from `t()`.
- The German for the four new namespaces (`locations`, `shifts`, `payroll`, `home`) is real
  Austrian-business German with correct ICU plurals, not machine output.
- **`nav`, `error`, `login`, `desktopOnly`, `footer`, `a11y`, `meta` are still English in
  `de.json`** — pre-existing, and explicitly sanctioned by decision-17 (English messages for
  MVP) and decision-8 (translation in 3B). Consequence worth naming: the new screens now
  render real German next to English error text, because `error.*` is the shared failure
  namespace. Not fixed here — flipping `NEXT_PUBLIC_DEFAULT_LOCALE=de` is a 3B decision, and
  translating half of it now would hide how much is left.

---

## 4. Accessibility

Checked concretely; no failure found worth blocking on.

- Every input and select has a `<label for>` bound to a `useId()` — `app/locations/page.tsx`
  (name, slug, address, active), `app/shifts/page.tsx` (start, end, worker, location, three
  filters), `app/payroll/page.tsx` (period).
- Errors are reachable: `aria-describedby` + `aria-invalid` on every field that can fail
  (`app/locations/page.tsx` name/slug, `app/shifts/page.tsx` start/end), pointing at a `<p
  role="alert">` that is **always in the DOM** and changes text — the pattern that actually
  announces, rather than a node that appears.
- `th scope="col"` on every header and `th scope="row"` on the first cell of every row, in
  all five tables. Every table has a `<caption class="visually-hidden">`.
- State is never colour alone: `/shifts/` prints the state word *and* "Does not count
  towards pay" *and* a striped row; `/locations/` prints "Inactive — tapping the tag does not
  start a shift"; `/` prints "over 8 hours, the timer will close this shift" as text. The
  stripes are `repeating-linear-gradient` patterns, so they survive greyscale and print.
- Keyboard: no `div` is made clickable anywhere; every action is a `<button>` or a
  `<select>`. `/shifts/` moves focus to the correction heading (`tabIndex={-1}`) on open,
  save and cancel; `/locations/` returns focus to the name field after save.
- Per-row buttons carry a visually hidden suffix ("Edit **for Stephansplatz 4**"), so the
  accessible names are unique in the accessibility tree.
- `.cell-actions` deliberately avoids `display:flex` on a `<td>` — that would drop the cell
  from the table's accessibility tree. Comment in `globals.css` says so.

Two minor points, not fixed, not blocking:

- `app/locations/page.tsx` announces a **failed** copy through `role="status"` (polite)
  rather than `role="alert"`. The message is a recoverable instruction ("select the URL and
  copy it manually"), so polite is defensible, but it is the one place where a failure is
  announced as a status.
- `app/page.tsx` disables the Refresh button while loading; a keyboard user focused on it
  loses focus for the duration. Sub-second, and the alternative (an aria-busy button that
  stays focusable) is a bigger change than the problem.

---

## 5. MONEY AND HOURS — **PASS**

Traced end to end, and re-run against the compiled `lib/payroll.ts` with a synthetic
ledger under `TZ=Europe/Vienna`.

**Integer cents throughout: PASS.**
`payrollFor` (`lib/payroll.ts`) accumulates `payableMs` as integer milliseconds
(`Date.getTime()` differences), then prices once per worker:
`Math.round((payableMs * hourly_rate_cents) / 3_600_000)`. Integer × integer, one division,
one rounding — the same shape as the server's `ROUND(SUM(hours) * hourly_rate_cents)`.
Hours only become a float in `msToHours`, which is display-only and documented as such.
`centsToPlainEuros` is string slicing. `parseEuroToCents` pads the fraction before parsing
rather than multiplying, so `1.005` is rejected instead of silently mis-rounded.

**Float multiplication in a money path: NONE.** The only `/ 100` is inside
`Intl.NumberFormat` display calls, downstream of every total.

**Verified numerically** (scratch run, deleted afterwards; there is no test runner in the
repo and none was added):

```
15.5 payable hours @ €14.50           -> 22475 cents exactly
unresolved auto-closed shift          -> excluded, counted as unresolvedShifts = 1
open shift                            -> excluded, counted as openShifts = 1
resolved auto-close 22:00→02:00       -> included, attributed to October (period of START)
shift outside the period              -> ignored
shift whose worker is absent          -> orphanShifts = 1, not folded into any total
total = sum of per-worker rounded pay -> 27275 cents
reconcile(all-time) server vs visible -> equal to the cent on a complete payload
CSV escaping of ; " and newline       -> RFC-4180 correct
```

**Exclusion of unresolved auto-closed shifts: PASS, and visible in three places.**
The predicate is `blocksPayroll(shiftState(shift))` in `lib/shifts.ts`, which mirrors the
server's `WHERE s.end_time IS NOT NULL AND NOT (s.auto_closed AND s.corrected_at IS NULL)`
exactly, and is the only implementation. It is surfaced as:
- `/payroll/` — a "Before you pay" callout naming the count, plus a per-worker "Not counted"
  column, plus a link to `/shifts/`;
- `/shifts/` — a state badge, the sentence "Does not count towards pay", a striped row, and
  a live-region count of how many of the filtered rows are blocked;
- `/` — a triage line with the count and a link.

**Can the displayed total and the visible rows disagree silently? NO.**
`/payroll/` computes both its own all-time total and the server's own `hours` aggregate and
prints the comparison **on every render** — either "the shifts loaded here add up to exactly
the server's all-time total" or the exact gap in euros with the reason (rows the `limit` cut
off). Separately, `periodExceedsCoverage` warns in capitals when the selected period reaches
back past the oldest loaded row. `orphanShifts` exists solely so a broken join surfaces as a
number rather than as money quietly vanishing.

Two known, stated-on-screen limitations, both real:
1. **No rate history.** `workers.hourly_rate_cents` is one mutable column, so past hours are
   priced at today's rate and editing a rate rewrites what last month appears to have cost.
   Printed in the caveat list.
2. **The 2000-row cap** (blocker 0.2.2). Detected and announced, but only T4 fixes it.

---

## 6. Contract match against `server/routes/admin.js`

Field by field, one mismatch found (defect 2, fixed). The rest:

| Client | Route | Verdict |
|---|---|---|
| `fetchAdminSnapshot` / `fetchShiftSnapshot` `?limit=2000` | `adminData`, `v.id(rawLimit)`, clamped to `SHIFT_PAGE_MAX` | OK — 2000 is the max, not rejected |
| `Worker` | `WORKER_COLS = id, name, email, hourly_rate_cents, active, created_at` | exact. `apple_sub` is absent from the payload **and from the type** |
| `Location` | `id, slug, name, address, lat, lng, active, created_at` | exact; `address`/`lat`/`lng` correctly typed nullable |
| `Shift` | the `adminData` join (`worker_name`, `location_slug`, `location_name` + the `shifts` columns) | exact |
| `HoursRow` | `worker_id`, `hours numeric(12,3)`, `pay_cents` | OK — `pg.types.setTypeParser(1700, Number)` in `server/lib/db.js` means numerics arrive as JS numbers, so `reduce((s, r) => s + r.pay_cents)` sums rather than concatenates |
| `shift_limit` | echoed by `adminData` | used for the truncation notices on all three screens |
| `saveLocation` 409 | `fail(409, "slug_taken")` — the only conflict this route raises | mapped to the slug field, not a generic toast |
| `saveWorker` 409 | `23505` on `workers.email` — the only conflict | mapped to the email field |
| `saveLocation` update | route writes **every** column, incl. `lat`/`lng` | the form carries the row's current coordinates back, so an edit does not null them |
| `updateShift` 404 / 422 | `unknown_shift` / `end_before_start`, `unknown_worker`, `unknown_location`, `timestamp_in_future` | 404 → "this shift no longer exists"; any other 4xx → "the server rejected this correction"; 401/403 → `/login/`; 5xx and network → the shared `error.*` message |
| `worker_id` / `location_id` on PATCH | re-validated against **active** rows | client sends them only when genuinely changed, so an unrelated edit is not broken by a since-deactivated reference |
| `auto_closed`, `corrected_at` | not patchable / stamped by the route | absent from `ShiftPatch`; the route owns both |
| every request | `credentials: 'include'`, httpOnly session cookie (decision-20) | no token, no PIN, nothing in web storage; enforced by `scripts/check.mjs` |

Error bodies from `fail()` are deliberately discarded client-side — only an HTTP status is
mapped to an i18n key, so no server text, path or constraint name can reach the DOM.

---

## 7. Blast radius

```
$ git status --porcelain -- server NFCTimeSheets
(empty)
$ git diff --stat web/package.json web/pnpm-lock.yaml
(empty)
```

- **No new dependency.** `package.json` and `pnpm-lock.yaml` are byte-identical. No date
  library, no CSV library, no table library, no form library, no state library. Dates are
  `Intl` via `next-intl`'s `useFormatter`; the CSV is 4 lines; the download is an anchor.
- **No file under `server/` changed.** All five screens run against the API exactly as
  deployed.
- **Nothing under `NFCTimeSheets/` touched.** `project.pbxproj` untouched.
- Changed: `web/app/{page,workers/page,globals.css}`, `web/lib/{api,money,payroll,shifts,tag}.ts`,
  `web/messages/{en,de}.json`, `web/.env.example`. Added: `web/app/{locations,shifts,payroll}/page.tsx`.

`web/.env.example` documents the one new build-time variable,
`NEXT_PUBLIC_TAG_BASE_URL`, defaulting to `https://timesheets.exe.xyz`. It is deliberately
**not** `window.location.origin`: a tag written from a page open on localhost is dead on the
wall and can only be fixed by going back to the building (decision-4, decision-21).

---

## 8. What each journey can now do, end to end

- **J1 — day one.** Sign in → `/` shows real triage → `/workers/` add the crew → `/locations/`
  add each building → copy each tag URL → write tags. The only step still outside the panel
  is creating the first admin (`server/bin/create-admin.js` over SSH, correct per
  decision-20) — **and it is still undocumented (T14)**.
- **J3 — a building to a working tag.** `/locations/` renders
  `https://timesheets.exe.xyz/t?l=<uuid>` verbatim in a block `<code>` (`user-select: all`,
  never truncated), with a one-click copy, the UUID printed below it, and a clipboard failure
  reported honestly instead of a false success. Deactivation goes through the upsert with
  `active: false`, so a building can be brought back; nothing is destroyed and shift history
  survives.
- **J4 / J5a — the day, and the day that went wrong.** `/` lists who is on site oldest-first
  and flags anyone past eight hours in words. `/shifts/` filters by worker, building and
  calendar period, states each shift's state in words, and stripes the rows that will not be
  paid.
- **J6 — payroll.** `/payroll/` per calendar period (default: last month), per worker hours ×
  current rate, exclusions named and linked, a reconciliation line against the server's own
  aggregate on every render, and a semicolon-separated UTF-8-BOM CSV that carries both cents
  and euros so an Austrian Excel opens it in columns and an accountant can total it without
  inheriting a float.
- **J7 — corrections.** `/shifts/` → Correct → start, end, worker, building. Only changed
  fields go on the wire. Clearing the end time puts a shift back to running.
- **J9 — support.** Half of it. "Did my clock-in land?" and "who is on site?" are now
  answerable in seconds. "Why does Sign in with Apple say no?" is not.

## 9. What is still missing, in the order it will hurt

1. **T6 `POST /admin/shifts`** — a real day worked that can never be paid. Highest cost per
   line of code left.
2. **T4 `from`/`to`/`offset` on `/admin/data`** — payroll's ten-week horizon.
3. **T8 + T9** login status and rejected sign-in attempts — turns the support call from a
   guess into a lookup.
4. **T12** deactivation guard — the leaver trap.
5. **T10** `/workers/<id>` — the support screen; cheap once T8 exists.
6. **T14** runbook (first admin, tag writing, Hide My Email recovery) — no code, and it is
   the difference between day one working and day one being a phone call.
7. **T7** delete a bogus shift, **T13** `tag_written_at` — both genuinely optional for 3A.

Out of scope and staying out: material requests, P&L, contracts, building analytics
(`FUTURE_NAV`, rendered locked), worker↔location assignment, rate history, per-admin audit
log of shift edits.
