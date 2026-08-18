# JOURNEYS — every party, end to end

Status: reference. The map the new information architecture is cut from.
Written 2026-08-18, after the redesign landed and measured **0 screens added, 0 removed,
12 → 12 nav entries, 2 → 2 cross-links**. Lighter, same filing cabinet.

Method: every claim is read out of the file named. Where a journey is broken, the break is
named with the file and the line that breaks it. Nothing is invented; the invented parts are
marked `INVENTED`. Supersedes `USER-JOURNEYS.md` (iteration 3A, iOS-era, before Android,
enrolment codes, clients, contracts, materials, P&L, analytics or the portal existed).

Two owner decisions are taken as settled and are *not* re-argued here:

- **the map replaces the home screen** — today's exceptions dashboard stops being the landing
  surface; a building pin is the entry point into that building's work (TASK-155)
- **zones are real** — a building holds several cleanable areas (Eingang, Stiege 1–3,
  Tiefgarage, Büro 2. OG), each able to carry its own tag. That is a migration, not a CSS
  change. Every journey below carries a `⬡ zones` line where the zone model changes it.

---

## 0 · Parties, surfaces, and what each can actually see

| Party | Surface | Identity | Can see |
| --- | --- | --- | --- |
| **W** worker | Android app (Kotlin/Compose, 5115 LOC). iOS exists, one build behind, deferred | enrolment code → `worker_sessions` cookie (decision-26); `worker_id` never from the body (decision-22) | own open shift, own last 5 shifts **on this phone**, own material requests. NOT their rate (`roster` omits `hourly_rate_cents`), NOT their month total |
| **D** director/admin | web admin, 14 routes, phone or laptop (decision-28) | username + password, httpOnly cookie (decision-20). Live login `schimmer` | everything except the server access log |
| **C** client contact | `/reinigung/#k=<token>` public portal, phone-first, no login | the link IS the credential | one building, last 20 cleanings, `{date, first name, minutes}`. Nothing else, ever |
| **SYS** | systemd timers + Postgres + node | — | `journalctl`. Sentry is wired and **blind** — `SENTRY_DSN` unset in production (task-44) |
| **PLAY** Google Play | internal testing track, personal account (decision-27) | owner's Google account | — |
| **APL** Apple | TestFlight, internal | Team `6Y842FE8Q4` | — deferred |

### The physical reality that constrains everything

```
tags deployed in the field:                        1
tags we wrote ourselves:                           0
tag at HOIV Arsenalstraße 11:  foreign NXP Mifare Ultralight EV1
  serial 04:A1:A8:52:AE:5C:80  →  location c3c37d4a-ca0a-42c5-b248-9704b9907ec7
  payload: application/ase.mobile, one byte 0x31, NO URL
  NDEF capacity 46 B; our URI needs ~64 B  ∴ physically unwritable
```

`android/nfc/KnownTags.kt` hardcodes that serial→UUID map. `ScanActivity.onTag` synthesises
the URL via `TagLink.uriFor` and re-enters through `ACTION_VIEW`, so everything downstream is
identical to a real tap. **Consequence: the tag cannot wake a closed app.** No URL → no App
Link → no passive tap. Today's only working clock-in at the only live building is
`open app → Scan → hold to wall`. Adopting a second tag needs a new APK and a Play release.

---

## 1 · WORKER journeys

### W1 — Enrolment: a code is issued and typed
**Trigger:** D hires W. `POST /admin/workers/:id/enrolment-code`, or `node ops/issue-invite.mjs --name "…"`.

| # | Step | Surface | State |
| --- | --- | --- | --- |
| 1 | D creates worker row (name, rate, phone, email) | `/workers/` drawer | ✓ |
| 2 | D presses „Zugangscode" | `/workers/` row action | ✓ code shown **once**, `codeOnce` + `codeValidUntil` |
| 3 | D reads code down the phone / WhatsApps it | off-screen | ✓ the panel is inline, not a modal, exactly so the row stays identifiable while reading it aloud |
| 4 | W installs from a Play internal-testing link | Play Store | ⚠ see P1 — D has no view of who accepted |
| 5 | W types code, any case, spaces or dashes | app sign-in screen | ✓ `EnrolmentCode.normalise` |
| 6 | `POST /auth/code` → Set-Cookie; app immediately re-asks `GET /auth/session` | | ✓ the second call proves the cookie landed in the jar |

**Goes wrong:**
- code expired → `401 invalid_code`. **Happened.** TTL was 60 min, now `CODE_TTL_MS = 5 days`
  (`server/lib/enrolment.js:81`, raised 2026-08-17 with the entropy arithmetic redone).
- code already redeemed, revoked, or typed wrong → the *same* `401 invalid_code`. Deliberate:
  no oracle. W cannot tell "expired" from "typo" and neither can D.
- code-shaped typo → refused client-side with the identical `err_invalid_code` so it does not
  spend an attempt against the rate limiter.
- too many attempts → `429 too_many_attempts` → `err_too_many_attempts`, this phone locked out.
- offline → `err_signin_offline`, explicitly *not* described as a bad code and *not* queued.

**System tells them:** one German string under the field. Nothing else, anywhere.
**BREAKS / hands off:** D has **no signal that an attempt happened**. Code state on the worker
row is `none | live | expired | redeemed | inactive` (derived from `enrolment_code_expires_at`
/ `_redeemed_at`, ticked every 30 s). That distinguishes "never used" from "used". It does not
distinguish "typed it wrong nine times" from "never opened the app". Recovery is a phone call.

---

### W2 — First sign-in, and every cold start after
**Trigger:** app launch.

`restoreSession()`: no cookie → `SignedOut()` with **no message** (a fresh install must not
say „Sie wurden abgemeldet"). Cookie present → cached worker shown first (optimistic, so a
cold start in a stairwell opens the app instead of flashing an unusable sign-in screen), then
`GET /auth/session` is authoritative.

- 401 → `dropToSignedOut()`: cookie cleared, notification disarmed, cache cleared.
- **network failure is not a sign-out.** Basement ≠ revoked. Only 401/403 moves state down.
- deactivated worker → 401 on next launch → signed out, no explanation of why.

**BREAKS:** a worker deactivated by mistake is signed out with a generic message and no route
back except phoning D. D sees nothing.

---

### W3 — Arriving and clocking in ★ the highest-frequency journey in the system
**Trigger:** W reaches the building.

Two paths, and only one of them is the product:

```
PASSIVE (the product)   tag URL → OS → ACTION_VIEW → NfcTapActivity → TagLink.locationId
                          → TapInbox → handleTap → local row → POST /shifts/open
ADOPTED (today's only)  open app → Scan → reader mode → KnownTags.locationIdFor(serial)
                          → TagLink.uriFor → ACTION_VIEW → …identical from here on
```

Invariants that are load-bearing and must survive any redesign:
- **a tap ALWAYS produces a local row first.** No roster check, no cache check, no permission
  check, no network check can prevent it. That guard existed on iOS, refused valid tags on a
  cold launch, and cost paid time at a door.
- `TapInbox` holds a tap that arrives while the UI is still a spinner. Dropping it is the bug
  that lost the iOS owner's first real tap.
- `armSignals()` runs **after** the row is on disk, never before. A denied notification
  permission arms nothing; it never rejects a tap. Pinned by `android/checks/core-check.kt`.
- one open shift per worker enforced in Postgres (`shifts_one_open_per_worker_idx`), so a
  double-punch at the door raises 23505 → `409 shift_already_open`, not two shifts.
- `client_uuid UNIQUE` makes the POST idempotent under retry.

**Goes wrong:**

| Failure | W sees | Recovers? |
| --- | --- | --- |
| screen locked (Android only dispatches unlocked) | nothing at all | unlock, tap again |
| NFC off | `NfcReadiness` banner | ✓ |
| adopted tag, app closed | **nothing at all** | only by knowing to open the app and press Scan |
| tag unknown to the server | `422 unknown_location` → `err_unknown_location`, row blocked **red** | needs D |
| tag rewritten by a third party | `TagLink` rejects non-UUID / wrong host / userinfo trick | ✓ silently |
| no signal | row queued, `syncStatus` says unsent, never silently pretty | ✓ on refresh |
| already open elsewhere | `409` → `err_shift_already_open` | see W6 |

**BREAKS:** the adopted-tag case, which is 100% of live taps. „I tapped and nothing happened"
is indistinguishable from „the OS did not dispatch". `ScanActivity` is the diagnostic — it
reports techs, UID, whether an NDEF message existed, what URI was in it and whether that URI
matched this build's host — but W must know to open it.

⬡ **zones:** the tap must resolve to a *zone*, not a building. Today `location_id` is the only
identity a shift carries; with zones every one of these paths must carry `zone_id` and the
server must keep resolving to an active zone of an active building.

---

### W4 — Working
The app becomes one screen about one thing: building name large, clock counting up in 64 pt,
state in the word „Eingestempelt", whole background green → red past 8 h. `Verlauf` tab is
removed while a shift runs; **material request, sign out, resolve-unfinished and the help card
stay reachable** and that is asserted by a build check („material is reachable while a shift
runs — that is exactly when it is needed").

Out-of-app signals: Android gets a lock-screen ongoing notification with a system-drawn
ticking clock, no time limit, plus escalating reminders at 1…8 h. It gets **a dot, not a
number**, on the launcher icon — Android has no API for a count.

**Goes wrong:** notifications denied → `outOfAppSignalsSilenced()` says so once, as a
sentence. Never blocks anything.

---

### W5 — Clocking out
Tap the same tag → `writeTap` sees `running.locationId == locationId` → `closeShift(…,
autoClosed = false)` → `POST /shifts/close` matched by `client_uuid`.

**There is deliberately no in-app clock-out button, and there must never be one.** Two write
paths to one row make two mechanisms disagree about somebody's hours.

**BREAKS — INCIDENT 1, 2026-08-11, Bálint, HOIV, the first successful Android clock-in ever.**
The tag is adopted, so there is no passive tap; the manual Scan button existed **only on the
idle screen** and `ShiftRunningScreen` returned early. W was inside a running shift with no
reachable way out. The shift ran until D force-closed it by hand.
Fixed in the working tree — `TimeSheetApp.kt:676` puts Scan on the running screen, with the
comment „THIS BEING ABSENT WAS A REAL, SHIPPED BUG". **Not on anyone's phone**: it needs a
Play release. Until then the incident reproduces on every shift at the only live building.

---

### W6 — Two buildings, one shift (undocumented but real and daily-plausible)
W leaves building A without tapping out, taps building B. `writeTap` closes A at the moment of
arrival at B with `autoClosed = true`, opens B, and shows a `switchNotice` naming both sites.
Flagged, not silent: the walk time lands on A's labour cost and no human confirmed the end, so
it routes through the same resolution screen as an 8 h timeout.

**BREAKS:** nothing technically. But the shift is now `notPayable` until W resolves it, and W
may dismiss the notice without understanding that.

---

### W7 — Forgetting to tap out → the 8 h auto-close
`ops/sql/autoclose.sql`, `nfc-autoclose.timer`, every 15 min:

```sql
UPDATE shifts SET end_time = start_time + INTERVAL '8 hours', auto_closed = true
 WHERE end_time IS NULL AND start_time < now() - INTERVAL '8 hours';
```

Idempotent by construction. `corrected_at` stays NULL — this file is not a human.
`unresolved ⇔ auto_closed AND corrected_at IS NULL`, one predicate, no third flag.
Payroll excludes it and **names it as an exclusion** rather than dropping it quietly.

**Goes wrong:** W never opens the app again → the shift is excluded from payroll for ever.
decision-10 calls that correct behaviour. It is also unpaid work.
**How W is told:** escalating notifications, and the running clock stops being a clock.
**BREAKS:** the audit record is a `UPDATE <n>` line in journald. Nobody reads journald.

---

### W8 — Resolving an unresolved shift
`GET /shifts/unresolved` → banner + `ResolveSheet` → `POST /shifts/:id/resolve` with the real
end time → `409 already_resolved` if a concurrent resolve won.

**Deliberate deviation from decision-10 on Android:** the sheet is **dismissible**, the banner
stays. „the iOS version learned the hard way that a hard block at the door costs paid time.
The pressure stays; the data loss goes." iOS still hard-blocks. That is a real cross-platform
behaviour divergence and it is intentional.

**BREAKS:** W cannot resolve a shift belonging to a session they no longer have (see W11/W12).
D can resolve it via `PATCH /admin/shifts/:id`, which stamps `corrected_at` — **but records no
reason** (INCIDENT 3).

---

### W9 — Requesting materials
`submitMaterial(typed)` → `MaterialQueue.normalise` → local row → `POST /material-requests`,
attached to the currently open shift's location when there is one. Entirely separate flow from
`LogState` **on purpose**: nothing about materials may ever delay a clock-in, and two flows
cannot await each other.

Status ladder, forward-only: `submitted → approved|rejected`, `approved → ordered`,
`ordered → arrived`; `rejected` and `arrived` terminal. W marks arrival seen
(`POST /material-requests/:id/seen`).

**Goes wrong:** routes not deployed → `404` → `featureUnavailable`, queued rows kept, **not an
error**. Unknown status from a newer server → reported as unknown, never invented.

**BREAKS:** *there is no push, in either direction.* `notePolling` on `/material-requests/`
says so out loud: „arrived" means the row moved, not that a phone buzzed. D learns a worker is
waiting only by opening the screen. W learns the answer only by opening the tab.

---

### W10 — A tap that did nothing
The complete list of causes, and what distinguishes them:

| Cause | Distinguishable by W? | Distinguishable by D? |
| --- | --- | --- |
| screen locked | no | no |
| NFC disabled | banner, yes | no |
| adopted tag + closed app | **no** | no |
| OS never dispatched (observed on real hardware) | only via `ScanActivity` | no |
| request never left the phone | yes — row is red/unsent | no |
| request arrived, 422 unknown_location | yes | only if they look at `/shifts/` and see nothing |
| request arrived, 200 | yes | yes |

**INCIDENT 4.** A tap did nothing and there was no way to tell whether the request ever
arrived. The API now logs `[req] METHOD path status ms` (`server/server.js:177`, tokens
redacted). **That log is reachable only over SSH.** There is no admin surface for it, and
`SENTRY_DSN` is unset so nothing reaches Sentry either.

---

### W11 — Losing the phone / reinstalling / new device
`refresh()` → `adoptServerOpenShift()` re-learns the open shift from the server and re-arms
the notification and the ladder from the same call the tap path uses. The server is
authoritative for open shifts (decision-19), so this works.

**What does NOT survive:** the local shift history. `LogState.recent` is the last 5 rows in
this phone's SQLite. `GET /shifts/mine` exists on the server (`app.js:475`) and **Android never
calls it** — no reference in `net/Api.kt`. So a reinstall wipes W's own record of their work.
W has no way to check their own hours against a payslip. Their rate is not in `roster` either.

**BREAKS:** W disputing hours has nothing to hold up. The dispute is settled entirely from D's
screen, from D's data.

---

### W12 — Being deactivated (the offboarding trap, from the worker side)
D deactivates → `destroyWorkerSessions` → next launch is a 401 → signed out.
If W had an **open** shift, the timer still closes it at +8 h with `auto_closed = true`, and W
can no longer sign in to resolve it. The shift is excluded from payroll for ever.
Recovery exists — `PATCH /admin/shifts/:id` stamps `corrected_at` — and **nothing warns D at
deactivation time**. Still true after the redesign.

---

## 2 · DIRECTOR journeys

### D1 — Onboard a new client from nothing ★ starts next week, and has no thread
**Trigger:** a contract is signed. Today this is four screens and the director's memory.

| # | Step | Screen | Carried forward? |
| --- | --- | --- | --- |
| 1 | create client | `/clients/` **or** inline from `/locations/` | inline path exists and works |
| 2 | create contact at that client | `/clients/` **or** inline | inline, needs client chosen first (`contactNeedsClientHint`) |
| 3 | create building: name, slug, address, lat/lng, client, contract cents, target minutes — 14 fields | `/locations/` drawer, „Schritt 1 von 2" | ✓ within the drawer |
| 4 | geocode fires server-side | — | see S2 |
| 5 | record the contract **period** (`valid_from`, price, target, payer) | `/contracts/`, a **different screen**, building re-selected from its own table | ✗ **no link, no pre-selection** |
| 6 | write / adopt the tag | `/locations/` renders `https://schimmer-glanz.exe.xyz/t?l=<uuid>` verbatim + copy | ✗ adoption is not an admin action at all — see D2 |
| 7 | assign workers | — | ✗ **no worker↔building model exists** |
| 8 | mint the client portal link and send it | `/locations/` row, needs an active contact | ✗ not reachable from `/clients/` |
| 9 | verify: tap the tag yourself | phone | ✗ that test tap is now a **permanent, undeletable payroll row** |

**BREAKS:** steps 5, 6, 8 and 9. Between step 3 and step 5 the director holds the building's
identity in their head and re-finds it in a second table. Step 9 has no undo: there is no
`DELETE /admin/shifts/:id` in `server/routes/admin.js` and none in `web/lib/api.ts`.

⬡ **zones:** step 3 becomes „create building **and its zones**", step 6 becomes one tag per
zone, step 9 becomes one verification tap per zone. This is where the zone model is felt
first, and it is exactly the week it starts.

---

### D2 — Get a working tag onto a wall
Two cases, and only one is supported.

**Case A, our own tag (NTAG213/215):** copy the URI off `/locations/`, write NDEF with NFC
Tools, **do not lock it** (decision-15, migration insurance). Passive tap works. Slug must
never appear in a tag URI (decision-21) and `/locations/` never renders it in a URL shape.

**Case B, a tag already on the wall:** measure its serial, add it to `KnownTags.BY_SERIAL`,
build, sign, upload to Play, wait for the crew to update. **No admin action exists.** The
file's own comment: „acceptable for one tag and absurd for twenty", with the stated upgrade
path a `tag_serials` table beside `locations`, fetched with the roster.

**BREAKS:** which buildings have a live tag lives in the director's head. No `tag_written_at`,
no serial column, no „last successful tap at this building" on the buildings screen. The only
proxy is the dashboard's „active buildings with zero recorded shifts".

⬡ **zones:** the tag table stops being optional. A `tags` child of a `zones` child of
`locations`, with the serial column, is the same migration that makes Case B an admin action.

---

### D3 — Hire a worker and issue a code
Covered from W1. D-side additions:
- `ops/issue-invite.mjs` collapses it to one command, and refuses on an ambiguous name match
  rather than guessing — „issuing a stranger's invite is not a recoverable mistake".
- Re-issuing **kills the previous code immediately**. Marked destructive; revoke sits at the
  same visual weight as issue on purpose, because a code read to the wrong person is the
  expected failure and seconds matter.
- `rateOptionalHint` currently says a worker with no rate „erscheint in der Lohnabrechnung mit
  0,00 €". Payroll does the **opposite** — `Kein Stundensatz` / `Nicht bewertet`, named and
  counted (INCIDENT 5). Wrong about money, in both locales (REDESIGN-REVIEW R2).

---

### D4 — The daily "is everything running" check
Today: open `/`, read the answer line („Muss ich gerade etwas tun?"), scan the on-site table
(oldest first, closest to the 8 h timer at the top), read three triage bullets with **named**
lists, glance at the last 10 completed shifts.

Correctness properties that must survive the map rewrite:
- `home.asOf` — elapsed times are frozen at load and say so. Not a ticking clock (per-second
  live-region churn is a screen-reader DoS).
- `home.overdueFlag` is a **word**, not a colour.
- `home.recentScope` — „ohne Zeitraumfilter… hier wird nichts zusammengezählt". Exists because
  a director once read a correctly-empty exception view as data loss.
- `home.truncatedNote` with the literal 2000 limit.
- a „Stunden diesen Monat" tile was explicitly **rejected**: on the 3rd it reads EUR 0,00 and
  raises a false alarm.

**BREAKS:** the three bullets are bare navigations. `/shifts/` defaults to `last30Days`, so an
unresolved shift older than 30 days is **not on screen after the jump**. The dashboard is also
the only screen that answers „where is everyone" and it answers it as a list of names, with no
geography — which is the whole argument for the map.

⬡ **zones:** „on site now" becomes worker × zone. Four workers in one building at four
different zones is the ordinary case the PoC models and the schema cannot express.

---

### D5 — "I could not clock out" (the support call)
What D must be able to see, and can they:

| W says | D needs | Today |
| --- | --- | --- |
| „I tapped and nothing happened" | did a request arrive at all | ✗ SSH + journald only |
| „it says I am still clocked in" | the open shift, worker, building, since when | ✓ `/` and `/shifts/` |
| „I cannot get out" | close it by hand | ✓ `PATCH /admin/shifts/:id` from the correction drawer |
| „why did it happen" | is this building on an adopted tag | ✗ nothing on any screen records that |
| after the fix: why is this row different | a reason on the record | ✗ **INCIDENT 3**, no column |

**BREAKS:** D closes the shift, the hours become right, and the reason evaporates. TASK-46
proposes `shifts.correction_note TEXT NULL`, required when start/end change, optional
otherwise, never in the portal payload. Not built.

---

### D6 — Correcting the past, and filing a shift that was never tapped
`/shifts/` carries **two** drawers with different rules, and the difference is load-bearing:

| | „Schicht nachtragen" | „Schicht korrigieren" |
| --- | --- | --- |
| route | `POST /admin/shifts` | `PATCH /admin/shifts/:id` |
| end time | **required** | optional |
| marks | `client_uuid = NULL` → `originManual` for ever | stamps `corrected_at` when it resolves a timer-close |
| stated before the form | `createManualNotice` | `correctUnresolvedNotice` — saving **accepts the timer's guess and pays it**, even if nothing was retyped |

Overlaps refused locally (`overlappingShift`) with a named refusal, and server-side with a
`409` the client could not have seen.

**BREAKS:**
- **no delete.** A test tap (D1 step 9), a duplicate, a shift filed against the wrong worker
  and then corrected — the row is permanent. Removing one is SQL on the VM.
- **no reason** (INCIDENT 3).
- `auto_closed` is displayed and never editable — correct, and any UI that offers „corrected"
  as a checkbox undermines it.

---

### D7 — Month-end payroll ★ once a month, highest consequence
`/payroll/` sends the period to the **server** (`GET /admin/data?from=&to=`) and clears the old
snapshot before refetching, so last period's rows never sit under this period's heading.

The caveat block is the product here, not decoration. Every branch:

```
caveatUnresolved {n} → /shifts/     caveatOpen {n} → /shifts/
caveatNoneExcluded                  caveatTruncated {limit, earliest}
caveatReconcile {server, visible}   caveatReconcileOk       ← both branches load-bearing
caveatManual {n} → /shifts/         caveatOrphan  „Bitte melden – sollte nicht möglich sein"
caveatRateHistory                                            ← ALWAYS, unconditional
```

INCIDENT 5 is answered: a worker with no rate is a **named** exclusion, `Nicht bewertet`,
never `0,00 €`. INCIDENT 6 is answered: exclusions are counted, named and linked.
CSV: Vienna-dated filename, UTF-8 BOM, `csvManualShifts` column — the accountant keeps the
file, so the audit trail is in it and not only on screen.

**BREAKS:**
- three links to `/shifts/`, **none passes a filter**, and payroll defaults to `lastMonth`
  while `/shifts/` defaults to `last30Days`. The director reads „2 Schichten müssen bestätigt
  werden", clicks, lands in a different period, and re-derives the filter by hand. `/shifts/`
  accepts exactly one URL parameter, `?period=` (`web/app/shifts/page.tsx:239`). Not worker,
  not location, not shift id.
- `caveatRateHistory` is permanent by design (decision-28, **proposed**, not accepted): one
  mutable `hourly_rate_cents`, so a raise silently rewrites every past month's labour cost.
- 2000-row cap: at 20 workers × 2 shifts/day ≈ 10 weeks of memory.

---

### D8 — Is this building worth the contract?
Three screens, one question.

`/pl/` — margin per building from server SQL only (browser arithmetic over a capped payload
would under-report a month). Three refusals it must keep: **no confident zero** for unknown
revenue (`revenueUnknown`, never EUR 0,00 — a zero reports a paying client as a total loss),
**„not assessable" is not a pass** (`assessNoBaseline`), **the baseline is never invented**
(ships unset). Flagged buildings get an *argument* in prose — `whyMargin`, `whyRevenue`,
`whyLabour`, `whyMaterial`, `whyExcluded`, `whyOpen` — readable down a phone line. „A flag is
not a red dot."

`/analytics/` — variance against `target_minutes_per_month`, a 6-month trend
(`trendInsufficient` rather than a flat line that claims nothing), and the map. Five named map
failure states and seven photo-absence reasons, all in words. **The table is primary and the
map is optional** (`noteMapEquivalent`) — a redesign that makes the map the home screen must
carry that invariant with it, not drop it.

`/contracts/` — period history, half-open Vienna days.

**BREAKS:** `/pl/` → `/contracts/` and `/pl/` → `/shifts/` pass **neither the building nor the
period**. `/analytics/` panel → `/contracts/`, `/shifts/`, `/locations/` pass **no building**.
The director reads „Ordinationszentrum Meidling is 4 points under baseline", clicks, and
re-finds Meidling in the next table. Every time.

⬡ **zones:** „which part of this building eats the hours" is the actual question and is
unaskable today. Zones are what turn D8 from a verdict into a diagnosis.

---

### D9 — Materials: decide, order, price, deliver
`/material-requests/`, cap 500. Summary counts the three stages that need D
(`decide/order/deliver`). Lifecycle buttons stay **on the row** — one click is the point.
Three standing notes: `notePolling` (no push), `noteAttribution` (decision-6, materials split
pro-rata by labour hours — the building select is **context**, not cost attribution),
`noteUnpriced` (an ordered request with no cost is silently worth zero and inflates every
margin). The worker's words are rendered verbatim inside `<q>`.

**BREAKS:** no push in either direction (W9). A worker standing in a building waiting for a
mop finds out by opening a tab. D finds out by opening a screen. Row → worker: no link.
Row → building: no link.

---

### D10 — Give a client contact a link, and take it away
Mint from `/locations/` (needs an active contact **and** an active building), shown once,
`shareExplain` states exactly what the client can see. Revoke is irreversible.
Two hidden-but-correct side effects:
- deactivating a **building** revokes that building's live client links — an access decision
  about an outsider, deliberately not left to D remembering the Kundenlink column.
- deactivating a **contact** revokes that person's live portal links server-side. This one is
  **stated only in a code comment**, not on screen (REDESIGN-INVENTORY §27).

**BREAKS:** grants are managed per building on `/locations/`; contacts live on `/clients/`.
A contact holding links to five buildings is revoked five times, or once by deactivating them
and knowing the side effect.

---

### D11 — Offboard a leaver
Deactivate is soft, history survives, sessions are destroyed, reactivation works.
**The trap (W12) is unchanged after the redesign:** nothing checks for an open or unresolved
shift at deactivation time. `/` and `/payroll/` make the orphaned shift *findable*, which is
the difference between „silently never paid" and „findable if you look".

---

### D12 — Reprice a building
`/contracts/`: `valid_from`, price, target, payer. Half-open `[valid_from, valid_to)`, Vienna
calendar days, `2026-02-31` rejected as a real calendar check (`new Date` would roll it to
2 March). Deleting the current period reopens its predecessor; a closed period cannot be
deleted and the button is simply not drawn. **March keeps the March price for ever** —
revenue is period-correct, **cost is not**, and both screens say so.

---

### D13 — Admin bootstrap, password, lockout
First admin: `server/bin/create-admin.js` over SSH. No self-signup (decision-20). Password
change on `/account/`, `PASSWORD_MIN = 5`. **There is no reset-by-email and its absence is
deliberate** — the identity is a username, this deployment has no outbound mail, and a reset
link we cannot send is a dead end that looks like a feature. Recovery is the operator, on the
machine. `/login/` has **one** failure message for every rejected credential; splitting it
would be a user-enumeration oracle.

**BREAKS:** locked out → SSH. Acceptable, documented nowhere on screen.

---

### D14 — "My hours are wrong"
D can filter `/shifts/` by worker, by location, by period and by „needs attention", and can
see `payable`/`notPayable` in words and `originManual` per row. That is enough to answer it.
**BREAKS:** W has nothing to compare against (W11). The conversation is D reading numbers off
a screen W cannot see, about work W cannot independently evidence.

---

## 3 · CLIENT CONTACT journeys

### C1 — Receiving a link
D pastes it into WhatsApp or an email. `/reinigung/#k=<token>` — a **fragment**, so the token
never appears in a request line or a referrer. 43 base64url chars, 32 CSPRNG bytes.
No login, no account, no cookie. „A shareable link is the whole auth model", and the ceiling
is stated: the link will be forwarded, screenshotted and pasted into a group chat; assume it
already has been. That is acceptable **because the payload is minimal** and the grant is
revocable in one click.

### C2 — Checking what happened at their building
Three fields per row, last 20 cleanings: date, **first name**, minutes. Nothing else, ever —
no surname, no email, no rate, no other building, no ids of any kind. GDPR reasoning is on the
route: a first name plus a duration is the minimum that answers the question, and the minimum
is the lawful amount. German pinned. No admin chrome, no desktop guard, its own style island.
Document title is set client-side so an outsider is never told they have somebody's admin
panel open. Dates are Vienna calendar days formatted in UTC so no zone can move them a day.

**Goes wrong:** empty → `portal.empty`, which is not an error. 429 → `tooMany` + retry.
5xx → `loadFailed` + retry. Unparseable date → shown **verbatim** rather than invented.

### C3 — The link stops working
Revoked, unknown, or building deactivated → **one identical `404 not_found`**, one message,
**no retry button**. „This link used to work" is itself information about our client
relationships. Correct, and it means C's only recovery is to phone D.

### C4 — C wants something the portal does not show
Invoices, before/after photos, a complaint, a schedule. **No surface at all.** Hands off to a
phone call to D, every time. Recorded so it is not rediscovered as a bug.

---

## 4 · SYSTEM journeys

| # | Journey | Mechanism | Where it breaks |
| --- | --- | --- | --- |
| **S1** | 8 h auto-close | `nfc-autoclose.timer` → `ops/sql/autoclose.sql`, every 15 min, idempotent by construction | audit record is a `UPDATE <n>` in journald. No admin surface, no counter, no „the timer ran" indicator anywhere |
| **S2** | Geocode at building creation | `lib/geocode.js`, separate budgets per call (a shared 5 s deadline was measured wrong and left every building unpinned) | **fails soft, always** — no key, quota, DNS, timeout all end lat/lng NULL and the building saved. Correct. Worst case 11 s of spinner. `PARTIAL_MATCH`/`APPROXIMATE_ONLY` exist because Google answers 200/OK for nonsense and hands back a postal-district centre, which would become a confident wrong pin |
| **S3** | Nightly backup | `nfc-backup.timer` → `pg-backup.sh`: dump, gzip, verify header, **then** rotate; 14 days | **the offsite hook is a commented TODO** (task-38). „A dump on the same disk as the database is not a backup." VM loss = total loss of payroll data. `restore-test.sh` exists and has no evidence of ever having run against the offsite copy, because there is none |
| **S4** | An error reaches Sentry | `instrument.mjs`, `@sentry/node`, decision-23 | **`SENTRY_DSN` is unset in production (task-44) → the SDK disables itself and nothing is ever reported.** Wired, tested, and blind. Telemetry may never block a boot or a clock-in, and it does not — it also does not exist |
| **S5** | Request log | `[req] METHOD path status ms`, tokens redacted (`server.js:177`) | SSH only. This is the entire answer to INCIDENT 4 and it is not in the product |
| **S6** | Rate limits & session sweeps | `checkLoginRate` per bucket, `portal:<ip>` in its own bucket so a stranger guessing links cannot lock D out of `/admin/login`; `sessions_expires_at_idx` | a locked-out worker phone produces `429` and no admin-visible record |
| **S7** | The 2000-row cap | `SHIFT_PAGE_MAX = 2000`, no offset | every screen that hits it says so. ~10 weeks at 20 workers. Beyond that, SQL |

---

## 5 · PLATFORM journeys

**P1 — Google Play.** Internal testing track, personal account (decision-27): no D-U-N-S, no
12-tester/14-day gate, up to 100 testers, no public listing. Workers are added by Google
account email. **Every code change a worker needs — the clock-out fix, a newly adopted tag —
is a Play release.** `assetlinks.json` needs **both** SHA-256 fingerprints (upload key and
Play App Signing key) or App Links stay unverified and every tag tap opens a browser.
The signing keystore is the owner's and losing it means a new package name, for ever.
Ceiling stated in the decision: this holds only while the app serves *our own* workers.

**P2 — Apple.** TestFlight, internal, one build behind, deferred. iOS still uses Sign in with
Apple (decision-22) and still hard-blocks on unresolved shifts. Two enrolment paths, one
session table.

---

## 6 · State the user must hold in their head — the exact missing links

Every cross-link in the admin is a bare navigation. **No screen passes a filter to another
screen.** Nine places where that costs a real re-derivation:

| # | Journey | Where the thread snaps | The exact missing link |
| --- | --- | --- | --- |
| 1 | D7 payroll | „2 Schichten müssen bestätigt werden" → `/shifts/` | `?worker=<id>&period=<the payroll period>&state=unresolved`. Today: `?period=` only, and the target defaults to a **different** period than the source |
| 2 | D5 support | any shift row → that worker | **there is no `/workers/<id>` route at all.** `web/app/` has no dynamic segment anywhere |
| 3 | D5 support | any shift row → that building | no `/locations/<id>`; `/locations/` is one flat list with no anchor |
| 4 | D14 | `/workers/` row → that worker's shifts | no outgoing link on `/workers/` at all |
| 5 | D8 | `/pl/` flagged building → `/contracts/`, `/shifts/` | building id **and** period, neither passed. `/contracts/` re-selects from its own table |
| 6 | D8 | `/analytics/` panel → `/contracts/`, `/shifts/`, `/locations/` | building id, not passed, from a panel that was opened *by clicking that exact building* |
| 7 | D1 | `/locations/` → `/contracts/` | building id. The building was just created and must be re-found by name |
| 8 | D9 | material request row → worker, → building | neither exists |
| 9 | D4 | dashboard triage → `/shifts/` | the filter that produced the count. An unresolved shift older than 30 days vanishes on arrival |

Plus four facts that live **only** in a human's memory, with no column to hold them:

- **which buildings have a physical tag on the wall**, and whether it is ours or adopted.
  Nothing in `locations` records it; the adopted serial lives in a Kotlin file.
- **why a shift was corrected** (INCIDENT 3, TASK-46).
- **which worker cleans which building.** No roster, no assignment, no schedule. A worker
  tapping the wrong building is undetectable by construction.
- **what a worker's rate was in March.** One mutable column (decision-28, proposed).

---

## 7 · Impossible, or reachable only by SQL / a new APK

| Journey | Verdict | Why |
| --- | --- | --- |
| Represent a building with several cleanable areas | **impossible** | no zone table. Modelling zones as sibling `locations` rows corrupts every per-building aggregate at once: contract, target, P&L revenue, portal grant, map pin |
| Adopt a second foreign tag | **needs a new APK + Play release** | `KnownTags.BY_SERIAL` is compiled in. SQL does not help |
| Delete a bogus shift (test tap, duplicate) | **SQL on the VM** | no `DELETE /admin/shifts/:id` anywhere |
| Record why a shift was edited | **impossible** | column does not exist |
| Merge two worker rows created by a name typo | **SQL** | no route; one human on two payslips |
| Value past hours at the rate that applied then | **impossible** | single mutable column |
| Read shifts older than the 2000-row window | **SQL** | no offset parameter |
| See whether a tap ever reached the server | **SSH + journald** | no admin surface |
| See any server error | **impossible today** | `SENTRY_DSN` unset |
| Recover from loss of the VM | **impossible** | no offsite backup copy exists |
| Reset a forgotten admin password | **SSH** | deliberate; no mail |
| A worker checking their own month | **impossible** | `/shifts/mine` is never called; rate never sent |
| A client asking anything beyond „when, who, how long" | **impossible** | phone call |
| Detect a worker tapping the wrong building | **impossible** | no assignment model |

---

## 8 · Ranked by frequency × pain

Frequency is per the real shape of this business: 5–20 cleaners, one live building today,
one new client next week. Pain is what it costs when it goes wrong — unpaid work, wrong money,
or a site visit. Score is the product, coarse on purpose.

| # | Journey | Party | Freq | Pain | Score | Why it ranks here |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **W5 clock out** | W | 2–4×/worker/day | extreme | **top** | INCIDENT 1 reproduces on every shift at the only live building until a Play release ships. Failure = an 8 h phantom shift + a hand correction |
| 2 | **W3 clock in** | W | 2–4×/worker/day | extreme | **top** | the product. Adopted tag ⇒ no passive tap ⇒ the appeal of the product is absent at 100% of live sites |
| 3 | **D5 „could not clock out"** | D | ≥1/week now | high | high | every W5 failure becomes this. D can close the shift but cannot see the request log, cannot record a reason, cannot see the tag is adopted |
| 4 | **W7+W8 forget → auto-close → resolve** | W+D | 1–2/week | high | high | unresolved = unpaid. Works end to end; the D-side nag and the W-side dispute path do not |
| 5 | **D1 onboard a new client** | D | starts **next week** | high | high | four screens, no thread, and the verification tap is an undeletable payroll row |
| 6 | **D4 daily check** | D | 1/day | medium | high | the screen being replaced by the map. Its correctness properties are the thing most likely to be lost in that rewrite |
| 7 | **D7 month-end payroll** | D | 1/month | **extreme** | high | real money. Correct today, and three of its links land in the wrong period |
| 8 | **D6 correct / file a shift** | D | 1–3/week | high | high | the only repair tool. No reason field, no delete |
| 9 | **W9+D9 materials** | W+D | 1–2/week | medium | medium | no push in either direction; a worker waits in a building for a screen nobody opened |
| 10 | **D2 tag onto a wall** | D | per building | high | medium | one-off per site, but a wrong sticker costs a site visit, and adoption costs a release |
| 11 | **D3 hire + code** | D | ~1/month | medium | medium | one command now; the „did they get in" signal is still a phone call |
| 12 | **W10 tap did nothing** | W | unknown-but-real | high | medium | genuinely undiagnosable from the panel |
| 13 | **W11 reinstall / new phone** | W | rare | medium | medium | open shift survives, own history does not |
| 14 | **D8 is this building worth it** | D | 1/month | medium | medium | the reports are honest and every link into them loses the building |
| 15 | **C2 client checks a building** | C | 1–4/month/contact | low | low | works, and is deliberately tiny |
| 16 | **S3 backup** | SYS | nightly | **catastrophic** | ⚠ special | frequency×pain understates it: probability low, loss total, no offsite copy |
| 17 | **S4 Sentry** | SYS | every error | high | ⚠ special | not a journey that fails; a journey that does not exist |
| 18 | **D11 offboard** | D | rare | high | low-med | the trap is intact |
| 19 | **D10 portal link** | D | per contact | low | low | works; revocation is per building |
| 20 | **D12 reprice** | D | per contract year | low | low | correct, isolated |
| 21 | **D13 admin password** | D | rare | medium | low | SSH, deliberate |
| 22 | **C3 revoked link** | C | rare | low | low | one message, correct |
| 23 | **W12 deactivated mid-shift** | W | rare | high | low | rare × severe; fix is a warning at deactivation time |
| 24 | **P1 Play release** | PLAY | per fix | medium | ⚠ multiplier | not ranked as a journey — it is the **latency on every worker-side fix above** |

---

## 9 · What the new information architecture must serve

**One action from the home screen** — derived from rows 1–8 above, and nothing else:

1. **a building → everything about that building.** Pin → panel: who is on site now, this
   month's hours vs target, last cleaned + who + how long, contract value, margin, the zone
   list with each tag's last tap, and links out to *that building's* shifts / payroll /
   contract **carrying the building id**. This single link fixes gaps 3, 5, 6 and 7 of §6.
2. **who is on site right now**, oldest first, with the 8 h clock. Already exists; must not be
   lost to the map. Colour is the second signal, the word is the first.
3. **what needs a decision today** — unresolved + open + materials awaiting decide/order —
   each link carrying its own filter.
4. **close or correct a named worker's shift**, reachable in one action from a building or
   from a worker, on a phone, in a stairwell. This is D5, the field event decision-28 exists
   for.
5. **issue an enrolment code for a named worker**, same argument.
6. **this building's tag(s)**: the URI verbatim, the copy control, and — new — whether a tag
   is physically deployed, ours or adopted, and when it was last tapped.

**Everything else must merely not be in the way.** `/inventory/`, `/clients/`, `/contracts/`,
`/account/`, `/pl/`, `/analytics/` are correct, rarely-visited, and their sin is only that
they are peers of the six above in a flat 12-entry sidebar.

**Two things the map must inherit and not break:**
- `noteMapEquivalent` — the table shows everything the map shows, for every building
  **including the unpinned ones**. That is what makes the screen keyboard- and
  screen-reader-usable without a second implementation. The map is the optional part.
- degrade to a plain list when the key is missing, the quota is spent, `gm_authFailure` fires
  late, or the script never arrives. Five named states, in words. A dashboard that goes blank
  because Google is down is worse than a table.

**⬡ The zone model is the load-bearing schema change**, and it is felt in exactly these
journeys: W3 (tap resolves to a zone), W6 (switch between zones of the same building), D1
(create building **and** zones), D2 (a tag per zone; the serial column that also makes
adoption an admin action), D4 („on site now" is worker × zone), D8 („which part of this
building eats the hours"), C2 (the portal must **not** gain zone detail — the payload stays
`{date, first name, minutes}`).

---

## 10 · What did NOT happen in producing this document

- **Nothing was deployed and production was not touched.** No SSH, no write of any kind.
- **No application code was changed.** Nothing under `web/`, `server/`, `android/`,
  `NFCTimeSheets/`, `sql/`, `ops/`.
- **Nothing was committed.** Another workflow is editing `web/messages` concurrently.
- **The map PoC was not re-run**, and its zone shape is marked `INVENTED` by its own README.
  The five Vienna addresses and their coordinates are real; every worker, shift, tag, client,
  contract value, rate and margin in it is seeded fiction.
- **Frequencies in §8 are estimates**, from the shape of the business and the one field test,
  not from measurement. There is no analytics on worker behaviour and there should not be.
- **No task was created by this document.** The ranking in §8 is the input to that step.
