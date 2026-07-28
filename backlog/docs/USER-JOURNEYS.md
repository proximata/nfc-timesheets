# USER JOURNEYS — NFC TimeSheets 3A

Verified against the tree on disk, not against prose. Files cited are real.

Parties: **W** worker/cleaner (iPhone) · **A** admin/owner (desktop browser) ·
**C** building owner/client (no login in 3A) · **APL** Apple (SIWA + universal links) ·
**SYS** the server, incl. the 8h autoclose timer.

---

## 0. Journey status table

| # | Journey | Status today | Blocking gap |
|---|---------|--------------|--------------|
| J1 | Stand up business from zero | **IMPOSSIBLE** | no `/locations/` page; no building can be created except by curl |
| J2 | Onboard cleaner → first clock-in | **PARTIAL** | worker CRUD works; A cannot see whether W ever signed in; needs J1 first |
| J3 | Add building → working tag on wall | **IMPOSSIBLE** | no locations UI, no tag URL surfaced, no tag-write tracking |
| J4 | Normal day, in→out | **WORKS** (iOS + API) | A cannot observe it — no `/shifts/` page |
| J5a | Forgotten tap-out | **WORKS** (timer + resolve) | A blind to backlog of unresolved shifts |
| J5b | Phone dead / left at home | **IMPOSSIBLE** | no `POST /admin/shifts` — a missing shift can never be created |
| J5c | Tag unreadable / destroyed | **IMPOSSIBLE for W** | iOS has no non-NFC clock-in; recovery needs J5b |
| J5d | Two buildings, one shift | **WORKS** | `ContentView.handleTap` auto-closes + flags |
| J5e | Taps wrong building | **UNDETECTABLE** | no worker↔building assignment model at all |
| J6 | Month-end payroll | **IMPOSSIBLE** | `/admin/data` `hours` is **all-time**, no period filter; no `/payroll/` page |
| J7 | Correct/dispute the past | **PARTIAL** | `PATCH /admin/shifts/:id` exists, zero UI; no audit trail of who changed what |
| J8 | Offboard a leaver | **PARTIAL-TRAP** | deactivate works; a leaver with an open/unresolved shift is silently never paid |
| J9 | Support call "it doesn't work" | **IMPOSSIBLE** | A can see nothing: no shifts view, no sign-in status, no failed-eligibility record |
| J10 | Year end / reporting | **IMPOSSIBLE** | shift query capped at 2000 rows, no date range, no export |

---

## 1. IMPOSSIBLE TODAY — strands a real human mid-flow

1. **J1/J3 — no building can be created through any UI.** `web/app/` contains
   `page.tsx`, `login/page.tsx`, `workers/page.tsx`. That is all. `web/lib/nav.ts`
   advertises `/shifts/`, `/locations/`, `/payroll/` — all 404 in `web/out/`.
   `POST /admin/locations` exists and is unreachable. Day one of the business dies here.
2. **J5b/J5c — a shift that was never tapped can never exist.** There is no
   `POST /admin/shifts`. `patchShift` requires an existing row (`fail(404,
   "unknown_shift")`). W leaves their phone at home, works 6h, gets paid €0, forever.
   No workaround short of direct SQL on the VM.
3. **J6 — payroll cannot be run for a month.** `adminData` aggregates
   `SUM(end_time - start_time)` over the *entire table* with no `WHERE start_time
   BETWEEN`. A cannot produce "October hours". Paying from this number pays every hour
   ever worked, every month.
4. **J9 — A is blind.** Nothing in the admin panel shows a shift, an open shift, an
   unresolved shift, whether W has ever signed in, or what email Apple returned on a
   rejected sign-in. Every support call ends in "I don't know".

## 1b. Expensive gaps — need an API, not a screen

- `POST /admin/shifts` (create missing shift). J5b, J5c, J7.
- Period filter on payroll/shift aggregation (`?from=&to=`). J6, J10.
- `has_login` / `last_seen_at` exposure on the worker row. J2, J8, J9.
- Rejected-eligibility record (who authenticated with what address and bounced). J9.
- Shift pagination / CSV export. J10.
- Worker↔location assignment. J5e — **defer, see OUT-3A**.

## 1c. iOS CHANGES — 🚨 TESTFLIGHT IS SHIPPING NOW 🚨

A second binary round-trip is expensive. Everything below is **explicitly kept out of
this build**; each is survivable via the admin panel *provided* the admin gaps close.

| iOS want | Journey | Verdict |
|---|---|---|
| Manual location picker when tag unreadable | J5c | **DO NOT SHIP.** Reintroduces the client-chosen-location surface. Recover via `POST /admin/shifts` instead. |
| German UI strings | all | **DO NOT SHIP.** `ContentView.swift` is hardcoded English ("Tap to Start", "Can't log"). decision-8 wants German; decision-17 accepts English for MVP. Ship 3B. |
| Local 8h notification | J5a | already scoped separately (task-12), not in this build |
| "You are deactivated" state | J8 | today a deactivated W just gets a signed-out/ineligible screen. Acceptable. |

**No iOS change is required for any journey to become walkable.** All ten are unblocked
from the server + admin panel. Keep it that way; ship the binary.

---

## 2. Journey detail + step-level gap analysis

Legend: `WORKS` · `GAP-UI` · `GAP-API` · `GAP-OPS` · `OUT-3A`

### J1 — Stand up the business from nothing

Goal (A): empty database → one admin, N workers, N buildings, N tags, ready for day one.

| # | Step | Party | Sees | Status |
|---|------|-------|------|--------|
| 1 | Provision VM, Postgres, migrations | A/ops | shell | WORKS — `ops/deploy.sh`, `server/db/migrations/001_init.sql`, `002_worker_identity.sql` |
| 2 | Create first admin account | A | shell only | **GAP-OPS** — `server/bin/create-admin.js` is a CLI on the VM. Correct for bootstrap (decision-20, no self-signup). Must be documented in the runbook; no UI wanted. |
| 3 | Sign in to admin | A | `/login/` | WORKS — `web/app/login/page.tsx` → `POST /admin/login` |
| 4 | Land on something useful | A | `/` | **GAP-UI** — `web/app/page.tsx` renders static copy ("The shell is in place"). Zero data. |
| 5 | Add buildings | A | — | **GAP-UI** — `POST /admin/locations` live, no page |
| 6 | Add workers | A | `/workers/` | WORKS — `web/app/workers/page.tsx` |
| 7 | Write tags | A | — | **GAP-OPS** — see J3 |

Failure modes: forgets an admin exists → locked out of own product, recovery = SSH +
`create-admin.js`. Creates a location with a duplicate slug → `409 slug_taken` handled
server-side, needs a UI that renders it as a field error, not a toast.

---

### J2 — Onboard a cleaner to first clock-in

Goal (W+A): a new hire taps a tag and it counts.

| # | Step | Party | Status |
|---|------|-------|--------|
| 1 | A collects name + Apple ID email off-screen (phone call, WhatsApp) | A↔W | **GAP-OPS** — panel must state plainly *which* address is needed (it does: `workers.emailHint` in `web/messages/en.json`) |
| 2 | A creates worker with email + hourly rate | A | WORKS — `/workers/` → `POST /admin/workers` |
| 3 | W installs TestFlight build | W↔APL | **GAP-OPS** — invite is manual; A has no view of who accepted |
| 4 | W taps Sign in with Apple | W→APL→SYS | WORKS — `server/routes/auth.js` `appleAuth`, `lib/apple.js` |
| 5a | Email matches active row → session | SYS | WORKS — `resolveWorker` compare-and-set binds `apple_sub` |
| 5b | W chose **Hide My Email** → 403 | W | WORKS — `403 {not_eligible, email}`; `IneligibleView` in `ContentView.swift` spells the relay address out loud (`spelledOut`) |
| 6 | W reads relay address to A by phone; A pastes it into the worker row | W↔A | **GAP-OPS** — works, but A gets *no signal* the attempt happened. See J9. |
| 7 | A confirms W is now linked | A | **GAP-API** — `WORKER_COLS` in `routes/admin.js` deliberately omits `apple_sub` (right call), but exposes no derived `has_login` boolean either. A cannot distinguish "never tried" from "typo in email" from "signed in fine". |
| 8 | W taps a tag, sees "In progress" | W | WORKS — `POST /shifts/open` |
| 9 | A verifies the first clock-in landed | A | **GAP-UI** — no shifts screen |

Failure modes and recovery:
- **Typo in email** → W hits the ineligible dead end. Recovery: phone call + edit. Fine,
  because `apple_sub` is preferred once bound, so later email edits do not lock W out
  (documented in `upsertWorker`).
- **Apple withheld email and no sub on file** → `resolveWorker` returns null → 403 with
  no email in the body → W has nothing to read to A. **Genuine dead end**; recovery is W
  disabling Hide My Email in Apple ID settings. Needs to be in the support script.
- **W deactivated by mistake** → 403 forever, silently. A cannot see the attempt.

---

### J3 — New building under contract → tag that works

Goal (A): signed contract → NFC tag on the wall that opens the app with the right UUID.

| # | Step | Party | Status |
|---|------|-------|--------|
| 1 | C signs annual contract (off-screen) | A↔C | OUT-3A — contract management is a locked v2 stub (`FUTURE_NAV`) |
| 2 | A creates location (slug, name, address, lat/lng) | A | **GAP-UI** — `POST /admin/locations` live, no page. Slug is human-readable, id is a DB-generated UUID (decision-21). |
| 3 | A reads the tag URL for that building | A | **GAP-UI** — the panel must render `https://timesheets.exe.xyz/t?l=<uuid>` as one-click-copy text. Nothing renders it today. This is the single most error-prone manual step in the product. |
| 4 | A writes NDEF URI to NTAG213/215 with NFC Tools | A | **GAP-OPS** — task-6. **Tags stay UNLOCKED** (decision-15). |
| 5 | A sticks tag by the entrance | A | GAP-OPS |
| 6 | A tests: tap with own phone → app opens on that building | A | WORKS — `wellknown.js` serves AASA with no redirect + `/t`; `TagLink.locationId` parses `?l=` and rejects non-UUIDs |
| 7 | A marks tag as verified/deployed | A | **GAP-API** — no column, no route. Without it, "which buildings have a live tag" lives in A's head. Minimum viable: a `tag_written_at` timestamptz, or accept it as OUT-3A and rely on first successful shift as proof. |

Failure modes:
- Wrong UUID written → W taps, app says "Unknown tag — this location isn't registered"
  (`handleTap`). Recovery: rewrite tag. Cheap *because* tags are unlocked.
- Slug pasted into the tag instead of the UUID → **must be impossible by construction**:
  the locations screen must never render the slug in a copyable URL shape (decision-21).
- Tag physically fails / painted over → J5c.
- Location deactivated while a tag is still on the wall → `v.activeLocation` rejects,
  W sees a hard error. Panel must warn on deactivate that the physical tag goes dead.

---

### J4 — A normal working day

| # | Step | Party | Status |
|---|------|-------|--------|
| 1 | W walks to building, taps tag (app backgrounded) | W→APL | WORKS — universal link, `TapInbox` |
| 2 | App writes local row, POSTs open shift | W→SYS | WORKS — `Sync.swift`, `POST /shifts/open`, idempotent on `client_uuid` |
| 3 | W sees "In progress" + sync state | W | WORKS — `ShiftRow.syncStatus` shows Sending…/Sent/blocked |
| 4 | W cleans (no screen) | W | — |
| 5 | W taps tag on the way out | W | WORKS — `POST /shifts/close` |
| 6 | W sees duration | W | WORKS |
| 7 | A sees today's activity | A | **GAP-UI** — no `/shifts/`, no live "who is on site now". `/admin/data` already returns open shifts (`end_time` null). |

Failure modes:
- **No signal in a basement** → local-first write + queue (`Sync.swift`); retried on
  refresh. Blocked syncs go red, not silent. WORKS.
- **Double tap at the door** → `ON CONFLICT DO NOTHING` on `client_uuid`, 200 duplicate. WORKS.
- **Already open elsewhere** → `409 shift_already_open` with the offending shift. WORKS.
- **App reinstalled mid-shift** → `adoptServerOpenShift` re-reads `GET /shifts/open`. WORKS.

---

### J5 — The day going wrong

**J5a Forgotten tap-out.** `ops/sql/autoclose.sql` (systemd timer
`ops/systemd/nfc-autoclose.timer`) closes at `start+8h`, `auto_closed=true`,
`corrected_at` NULL. W is *blocked from tapping anything* until they resolve
(`handleTap` guards on `unresolved.isEmpty`) → `ResolveSheet` → `POST /shifts/:id/resolve`.
Payroll excludes it until resolved (`NOT (auto_closed AND corrected_at IS NULL)`). WORKS
end to end (decision-10).
*A-side gap:* **GAP-UI** — A cannot see how many unresolved shifts exist or nag anyone.
An unresolved shift is unpaid work; the person it hurts is W.
*Failure mode:* W ignores it → W is soft-locked out of clocking in entirely. A has no
override today. `PATCH /admin/shifts/:id` **does** resolve it (stamps `corrected_at` when
`auto_closed && corrected_at IS NULL && end != null`) — but there is no screen.

**J5b Phone dead / forgotten / broken.** W works a full shift with no way to record it.
**GAP-API + GAP-UI** — no `POST /admin/shifts`. Nothing in the system can represent
work that was never tapped. Highest-severity functional hole after J1.

**J5c Tag unreadable.** W's only clock-in paths are the tag (background link) and the
in-app `NFCReader` scan — both need a working tag. No fallback. Recovery is J5b plus a
tag rewrite (J3). Do **not** solve this in iOS this round (§1c).

**J5d Two buildings in one shift.** `handleTap`: closes the running shift at the moment
of arrival at building 2, sets `autoClosed=true`, tells W out loud that the walk time is
on the old building and it will not count until confirmed, then opens the new shift.
`closeShift` only ever raises `auto_closed`, never clears it. WORKS.

**J5e Taps someone else's building.** SYS accepts any active location for any active
worker. There is no roster/assignment/schedule model. Detection is **impossible** and the
shift is billed to the wrong building. **OUT-3A** — a schedule is a v2 concept
(`buildingAnalytics`/`contractManagement` stubs). 3A mitigation is a `/shifts/` screen
where a wrong building is visible to a human eye. Do not build assignments.

---

### J6 — Month end: payroll

Goal (A): pay each worker for hours worked in month M, having satisfied themselves the
hours are real.

| # | Step | Party | Status |
|---|------|-------|--------|
| 1 | A closes the month; checks no shift is still open | A | **GAP-UI** |
| 2 | A checks every auto-closed shift has been resolved | A | **GAP-UI** — the exclusion is silent today: an unresolved shift just quietly vanishes from `hours`. If A never learns it exists, W is never paid. |
| 3 | A reviews shifts for anomalies (14h shifts, weekend taps, wrong building) | A | **GAP-UI** |
| 4 | A corrects what is wrong | A | **GAP-UI** on `PATCH /admin/shifts/:id` |
| 5 | A reads hours × rate per worker **for that month** | A | **GAP-API** — `adminData.hours` has no period filter. All-time only. Unusable for payroll. |
| 6 | A exports / hands to accountant | A | **GAP-API** — no CSV, no export route |
| 7 | A pays (bank, off-screen) | A↔W | GAP-OPS |
| 8 | W disagrees with the total | W↔A | J7 |

Failure modes: paying from an all-time number (severe, silent, financial); paying a
worker whose hourly rate was edited mid-month (rate is a single mutable column — the
aggregate uses the *current* rate for *all* history; acceptable in 3A, must be a known
limitation, not a surprise); a shift open across the month boundary.

---

### J7 — Correcting the past

Goal (A): a shift is wrong, disputed, or missing; make the record true.

| # | Case | Status |
|---|------|--------|
| a | Wrong end time on an existing shift | **GAP-UI** — `PATCH /admin/shifts/:id` exists, no screen |
| b | Wrong building | **GAP-UI** — same route, `location_id` patchable |
| c | Wrong worker | **GAP-UI** — `worker_id` patchable (validated active) |
| d | Shift missing entirely | **GAP-API** — no create route. See J5b. |
| e | Shift should be deleted (duplicate, test tap) | **GAP-API** — no `DELETE /admin/shifts/:id`. A test tap from A's own phone during J3 step 6 is permanently in payroll. |
| f | W disputes the total, escalates | **GAP-UI** — A has no per-worker shift history to show W |
| g | C disputes hours billed for their building | **GAP-UI** — no per-location shift list |
| h | Who changed this, when, why | **GAP-API** — only `corrected_at`. No actor, no reason, no before-value. Sufficient for 3A trust level (single admin, owner of the business), inadequate the moment there is a second admin. Record as a known limitation. |

Note the deliberate correctness in `patchShift`: `auto_closed` is not patchable, and
`corrected_at` is stamped *only* when the edit genuinely resolves a timer-closed shift.
Any UI must not undermine that by presenting "corrected" as a checkbox.

---

### J8 — Offboarding a leaver

| # | Step | Status |
|---|------|--------|
| 1 | W gives notice (off-screen) | GAP-OPS |
| 2 | A checks W has no open shift and no unresolved shift | **GAP-UI** — the trap |
| 3 | A runs final payroll for W | J6 |
| 4 | A deactivates W | WORKS — `/workers/` toggle → `DELETE /admin/workers/:id`, soft delete + `destroyWorkerSessions` |
| 5 | W's app stops working | WORKS — `requireWorkerSession` re-checks `active`; `resolveWorker` returns null even on an `apple_sub` hit |
| 6 | History survives | WORKS — soft delete only; shifts untouched |

**The trap, spelled out:** deactivate a worker who has an open shift → the autoclose timer
still closes it at `start+8h` with `auto_closed=true` → W can no longer sign in, so W can
never resolve it → the shift is permanently excluded from `hours` → **W is never paid for
their last day.** Recovery exists (`PATCH /admin/shifts/:id` stamps `corrected_at`) but
there is no screen for it and nothing warns A at deactivation time. Fix is UI-only:
the deactivate confirmation must surface open/unresolved shifts for that worker.

---

### J9 — "It doesn't work" (multi-party; the one that gets forgotten)

W phones A. A has a browser and a person on the line. What must A be able to SEE?

| W says | A must see | Status |
|---|---|---|
| "It says I'm not allowed / not eligible" | that a worker row exists with exactly that email; whether it is active; whether an Apple sub is bound | **GAP-API** — `WORKER_COLS` has `email` + `active` (good) but no `has_login`/`last_seen_at`. And no record of the *rejected* attempt, so A cannot see the relay address unless W reads it aloud. |
| "I tapped and nothing happened" | whether an open shift exists for W right now, and where | **GAP-UI** — `/admin/data` returns it, nothing renders it |
| "It says finish your unresolved shift" | W's unresolved shifts and their start times | **GAP-UI** |
| "It says unknown tag" | the location list with active flags + the exact tag URL for that building, to compare against what the tag reads | **GAP-UI** |
| "My hours are wrong" | W's shift history with start/end/auto_closed/corrected_at | **GAP-UI** |
| "The app won't open when I tap" | that AASA is being served correctly | WORKS — `curl https://timesheets.exe.xyz/.well-known/apple-app-site-association`; **GAP-OPS**, no panel indicator. Acceptable: this is an ops check, not an admin-panel feature. |
| "It says sending failed" | nothing server-side proves it; the phone is the source of truth | **GAP-UI** — mitigated if A can see whether the shift actually arrived |
| (silence — W never calls) | shifts stuck unsynced, workers with zero shifts this week | **GAP-UI** — a dashboard job |

Minimum diagnostic surface for J9: **one worker detail view** = identity + login status +
open shift + unresolved shifts + recent shifts. That single view answers six of the eight
rows above.

---

### J10 — Year end / reporting (only: do not paint 3A into a corner)

| # | Concern | Status |
|---|---|---|
| 1 | Read a full year of shifts | **GAP-API** — `adminData` caps at `SHIFT_PAGE_MAX = 2000` rows with no offset and no date filter. 20 workers × ~2 shifts/day ≈ 800/month → the cap is reached inside 3 months. **This is a live data-loss-of-visibility bug, not a future concern.** |
| 2 | Hours per building for the year | **GAP-API** — `hours` groups by worker only |
| 3 | Cost per building | OUT-3A — decision-6 (pro-rata materials), `plDashboard` stub |
| 4 | Contract renewal / profitability for C | OUT-3A — `contractManagement`, `buildingAnalytics` stubs |
| 5 | Hand data to an accountant | **GAP-API** — no export |
| 6 | Rate history for retroactive correctness | OUT-3A — single mutable `hourly_rate_cents`. Note the limitation; a `worker_rates` history table is a v2 migration and does not need to be anticipated in schema now. |

Corner-avoidance for 3A: add `?from=&to=` + `?offset=` to the existing aggregation and
never let a screen depend on "all shifts fit in one response".

---

## 3. Atomic tasks

Each independently shippable and verifiable. Ordered by the journey it unblocks.
**No time estimates** — relative effort only.

### 🔑 DO THIS FIRST

**T1 — Locations screen (`/locations/`)**
Highest risk reduction. It is the only task that converts an *impossible* journey (J1,
J3) into a walkable one, it unblocks the physical tag work which has real-world lead time
(buy tags, visit buildings), and every other admin screen depends on locations existing.

---

| # | Title | Unblocks | Acceptance criteria | Deps | Effort |
|---|-------|----------|---------------------|------|--------|
| **T1** | Locations screen `/locations/` | J1.5, J3.2–3.3, J9 | Lists all locations from `GET /admin/data` incl. inactive, sorted as returned. Create + edit via `POST /admin/locations` (slug, name, address, lat, lng, active). Renders `409 slug_taken` as a field-level error on slug, not a generic toast. Deactivate via `DELETE /admin/locations/:id` behind a confirm that states the physical tag will stop working. **Shows the full tag URL `https://timesheets.exe.xyz/t?l=<uuid>` with a copy control; the slug is never rendered in a URL shape** (decision-21). All strings in `messages/en.json` + `de.json` (decision-8/17). Desktop-only guard inherited from the shell (decision-7). Keyboard-operable form, labelled inputs, errors associated via `aria-describedby`, copy control announces success. | none | **med** — mirrors `workers/page.tsx`, but 6 fields, coordinate validation and the copy affordance |
| **T2** | Shifts screen `/shifts/` (read + filter) | J4.7, J5a-A-side, J6.1–6.3, J7.f–g, J8.2, J9 | Table from `GET /admin/data`: worker, location, start, end, duration, state. State badges: open / auto-closed-unresolved / corrected / normal, matching the iOS vocabulary. Filter by worker, by location, by date range, and by "needs attention" (open OR `auto_closed && !corrected_at`). Explicitly labels rows that are **excluded from payroll** and why. Empty and error states rendered, never a blank page. i18n, a11y: real `<table>` with `<th scope>`, sortable headers keyboard-operable. | T4 (for >2000 rows) — shippable before it | **med** |
| **T3** | Shift edit + resolve (UI on `PATCH /admin/shifts/:id`) | J5a recovery, J7.a–c, J8 trap | From the shifts table, edit start/end/worker/location. Validation mirrors the server (`end > start`) and renders 422/404/409 distinctly. `auto_closed` is displayed, never editable. Resolving a timer-closed shift shows plainly that this stamps `corrected_at` and that the shift then enters payroll. Confirmation before write. Optimistic UI forbidden — re-read after write. | T2 | **low-med** — route exists; the work is honest error handling |
| **T4** | Period + pagination on shift/hours queries | J6.5, J10.1, T2, T5 | `GET /admin/data` accepts `from`, `to` (ISO dates, validated via `lib/validate.js`) and `offset`; both the `shifts` list and the `hours` aggregate honour them. Response includes a total count so a UI can page. Absent params keep today's behaviour exactly (no client breakage). Covered by cases in `server/check-api.js`, including a boundary shift spanning the range edge. | none | **med** — server-only, but it is the payroll correctness fix and needs tests |
| **T5** | Payroll screen `/payroll/` | J6.5–6.6 | Month/date-range selector defaulting to last complete month. Per worker: hours, current rate, gross cents, formatted via `lib/money.ts`. **Blocks or loudly warns** when the selected period contains open or unresolved shifts, naming them and linking to `/shifts/`. States on-screen that the rate applied is the worker's *current* rate. CSV download generated client-side from the same data. i18n + a11y. | T4, T2 | **med** |
| **T6** | `POST /admin/shifts` — create a missing shift | J5b, J5c, J7.d | New admin route. Body: `worker_id`, `location_id`, `start_time`, `end_time`. Reuses `v.activeWorkerById`, `v.activeLocation`, `v.shiftWindow`. Generates its own `client_uuid` server-side (never client-supplied, so it cannot collide with or hijack a phone's queued row). Must NOT set `auto_closed` (machine fact). Rejects overlapping shifts for the same worker with 409. Tests in `check-api.js`. UI: "Add shift" on `/shifts/`. | T2 | **med** — new write path into payroll data; validation and overlap rules are the work |
| **T7** | `DELETE /admin/shifts/:id` — remove a bogus shift | J7.e | Hard delete (a test tap is not history worth keeping) behind a confirm showing worker/location/times. Returns 404 for unknown. Tested. UI on `/shifts/`. | T2 | **low** |
| **T8** | Worker login status in `/admin/data` | J2.7, J8, J9 | `WORKER_COLS` gains derived `has_login` (`apple_sub IS NOT NULL`) and `last_seen_at` (max session activity or last shift start). **`apple_sub` itself stays out of the payload** — it is an opaque credential. `/workers/` renders a plain three-state badge: never signed in / signed in / deactivated. | none | **low** |
| **T9** | Record rejected sign-in attempts | J2.6, J9 | New `auth_attempts` table (timestamp, email, outcome). Written by `appleAuth` on the `not_eligible` path only. **Never logs the identity token or the Apple `sub`.** Surfaced in the admin as "recent rejected sign-ins" so A can see the relay address without W reading it down a phone line, with a one-click "use this address for worker X". Retention: rows older than 30 days deleted by the existing autoclose timer's SQL companion. | T8 | **med** — new table, migration, privacy-sensitive; highest support-value per line of code |
| **T10** | Worker detail view `/workers/<id>` | J9 (all rows), J7.f | Single page: identity, login status (T8), current open shift, unresolved shifts, recent shifts, hours this month. This is the support-call screen. Read-only; edits live in T3 and the workers form. | T2, T8 | **low-med** — composition of data already fetched |
| **T11** | Dashboard `/` with real data | J1.4, J4.7, J9 | Replaces the scaffold copy. Shows: who is clocked in right now and where, unresolved shift count (linked), locations with no shift in 14 days, workers who have never signed in. Every number links to the screen that acts on it. No new API. | T1, T2, T8 | **low** — pure composition, but only worth it after T1/T2 exist |
| **T12** | Deactivation guard for workers and locations | J8 trap, J3 | Deactivating a worker with an open or unresolved shift shows those shifts and requires an explicit second confirmation. Deactivating a location with an open shift, or one whose tag is physically deployed, warns that the wall tag stops resolving. UI-only. | T2, T3 | **low** |
| **T13** | Tag deployment tracking | J3.7 | Migration adds `locations.tag_written_at timestamptz NULL`; `POST /admin/locations` accepts it; `/locations/` offers "mark tag written" and shows buildings with no tag. *Optional for 3A* — alternative is to treat "first successful shift" as proof and skip the column. Decide before T1 ships to avoid a second migration. | T1 | **low** |
| **T14** | Runbook: bootstrap, tag writing, support script | J1.2, J3.4, J9 | `backlog/docs/` runbook covering: creating the first admin with `bin/create-admin.js`; writing NDEF URIs with NFC Tools and **not locking tags** (decision-15); the Hide My Email recovery script; the "Apple withheld email and no sub on file" dead end and its only fix. No code. | T1 | **low** |

**Not doing (OUT-3A), stated so it is not rediscovered:** worker↔location assignments
(J5e); material requests, P&L, contract management, building analytics (`FUTURE_NAV`
stubs, decision-6); rate history; per-admin audit log of shift edits; German translation
of iOS strings (decision-17); any client-selectable location in the app (decision-22
surface).

---

## 4. Which admin screens must exist for the journeys to be walkable

Five, and only five:

1. **`/locations/`** — buildings + the copyable tag URL. Without it there is no business.
   (T1)
2. **`/shifts/`** — the ledger, filterable, with inline edit/resolve/create/delete.
   Every journey that goes wrong ends here. (T2, T3, T6, T7)
3. **`/payroll/`** — period-scoped hours × rate, with a hard warning on unresolved
   shifts, plus export. Requires the period API first. (T4, T5)
4. **`/workers/<id>`** — the support-call screen: is this person linked, are they clocked
   in, what do they owe us a finish time for. (T10)
5. **`/`** — dashboard as a triage surface, not a splash page. (T11)

`/workers/` and `/login/` already exist and are sufficient.

Server work that no screen can substitute for: **T4** (period filter — payroll is wrong
without it) and **T6** (create a missing shift — otherwise a real person works a real day
for no money). Those two are the expensive ones.

---

## 5. STATE AFTER THIS ITERATION

Verified against the tree on disk on the verify pass, not against the build reports.
`pnpm verify` (check + biome + tsc + static export) is green; the export emits
`/`, `/locations/`, `/login/`, `/payroll/`, `/shifts/`, `/workers/`, so **every href in
`web/lib/nav.ts` now resolves to a real page — no 404 is left in the sidebar.**

Shipped: T1 `/locations/`, T2 `/shifts/`, T3 shift correction, T5 `/payroll/` + CSV,
T11 real dashboard. Not shipped: T4, T6, T7, T8, T9, T10, T12, T13, T14.
No server file, no iOS file and no dependency changed.

### 5.1 Journey status now

| # | Journey | Was | Now | What still blocks it |
|---|---------|-----|-----|----------------------|
| J1 | Stand up business from zero | IMPOSSIBLE | **WORKS** | first admin is still `bin/create-admin.js` over SSH (by design, decision-20) and is still undocumented — T14 |
| J2 | Onboard cleaner → first clock-in | PARTIAL | **PARTIAL** | A still cannot tell "never tried" from "typo in email" from "signed in fine" — T8. Dashboard now names active workers with **no** email at all, which is the loudest half of the problem |
| J3 | Add building → working tag on wall | IMPOSSIBLE | **WORKS** | which tags are physically on a wall still lives in A's head — T13. Dashboard flags active buildings with zero recorded shifts, which is a proxy, not a record |
| J4 | Normal day, in→out | WORKS, unobservable | **WORKS + observable** | — |
| J5a | Forgotten tap-out | WORKS, A blind | **WORKS + visible** | unresolved shifts are counted on `/`, listed and flagged on `/shifts/`, and named on `/payroll/` |
| J5b | Phone dead / left at home | IMPOSSIBLE | **STILL IMPOSSIBLE** | no `POST /admin/shifts` — T6. A shift never tapped still cannot be created. Worker paid €0 |
| J5c | Tag unreadable / destroyed | IMPOSSIBLE | **STILL IMPOSSIBLE** | same: needs T6 |
| J5d | Two buildings, one shift | WORKS | **WORKS** | — |
| J5e | Taps wrong building | UNDETECTABLE | **CORRECTABLE, still undetectable** | `/shifts/` can move a shift to another building; nothing detects that it was wrong (OUT-3A) |
| J6 | Month-end payroll | IMPOSSIBLE | **WORKS, with a stated expiry** | `/payroll/` sums shift rows itself per calendar period. It is capped by the server's 2000-row page and says so; the real fix is T4 |
| J7 | Correct/dispute the past | PARTIAL | **MOSTLY WORKS** | edit yes; create (T6) and delete (T7) no; still no audit trail of who changed what |
| J8 | Offboard a leaver | PARTIAL-TRAP | **STILL A TRAP** | T12 not built. Deactivating a worker with an open or unresolved shift still warns nobody. `/` and `/payroll/` make the orphaned shift *visible*, which is the difference between "silently never paid" and "findable if you look" |
| J9 | Support call "it doesn't work" | IMPOSSIBLE | **PARTIAL** | A can now see every shift, who is on site, and who has no email — enough to answer "did my clock-in land?". Still no login status (T8), no rejected sign-in record (T9), no `/workers/<id>` (T10). "I tapped Sign in with Apple and it said no" is still unanswerable from the panel |
| J10 | Year end / reporting | IMPOSSIBLE | **PARTIAL** | payroll CSV per worker per period exists; the 2000-row cap and the absence of a server date range still make anything older than the cap invisible — T4 |

### 5.2 The cap, in real numbers

`GET /admin/data` returns `ORDER BY start_time DESC LIMIT $1`, max 2000
(`SHIFT_PAGE_MAX`). All three data screens now ask for 2000. At 20 workers averaging two
shifts a day, 2000 rows is roughly **ten weeks of history**; at 5 workers and one shift a
day it is about eighteen months. Until T4 lands, the admin panel's memory is that long,
and `/payroll/`, `/shifts/` and `/` each say so on screen when the cap is reached.

### 5.3 iOS

Unchanged from §1c: **no iOS change is required by anything above, and none was made.**
`NFCTimeSheets/` and `project.pbxproj` are untouched in this iteration. Ship the binary.
