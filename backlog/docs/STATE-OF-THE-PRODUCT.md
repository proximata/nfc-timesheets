# STATE OF THE PRODUCT — the last read before a paying client sees it

Written 2026-08-21 by the verdict pass, after `537db19`. Nothing here is taken from the
three reports that precede it. Every claim below was re-run, re-photographed or re-measured
against **the live box**, and where a report and the machine disagreed the machine won.

Reproduce:

```
./ops/deploy.sh                                        # build, migrate, restart, verify
./ops/smoke-live.sh                                    # 82 assertions against production
ADMIN_EMAIL=… ADMIN_PASSWORD=… node demo/verdict-live.mjs      # photograph + measure the live admin
ADMIN_EMAIL=… ADMIN_PASSWORD=… node demo/verdict-map.mjs       # did the map DRAW, four ways
VERDICT_MUTANT=navrows node demo/verdict-live.mjs      # the same run, shown RED
DEMO_BASE=http://127.0.0.1:8092 node demo/verdict-failure.mjs  # what a dead API looks like
```

---

## 0 · The first finding: none of it was live

The fix run committed thirteen commits and deployed none of them.

```
box  /srv/nfc/public/  last written  2026-08-21 00:16 UTC  (= 02:16 Vienna)
repo web fixes committed             04:19 – 04:57 Vienna
```

Eight files under `web/` — every one of the seven WRONG findings, the phone nav strip, the
`/tags/` link — were in git and **not on the box the director opens**. The fix report's
"production touched only for TASK-206" is true and was the problem: the Maps key was the
only thing that went live.

Deployed by this run. The box now serves this tree byte for byte:

```
local  web/out/_next/static/chunks/880d6fc2bddad276.css  sha256 27e5aee1…f68ba
remote https://schimmer-glanz.exe.xyz/…/880d6fc2bddad276.css  sha256 27e5aee1…f68ba   MATCH
```

**A near-miss worth keeping.** The first attempt to verify the phone fix on the live box
grepped the served CSS for `grid-template-rows` and found one occurrence — the desktop rule
— and nothing else. That reads exactly like "the fix is not deployed". It was: the minifier
folds the four tracks into the `grid-template` shorthand
(`grid-template:"header header""sidebar tools""content content"minmax(0,1fr)"footer footer"/…`).
The browser is the only instrument that answers this question, which is why everything below
is measured in one.

---

## 1 · PROVEN — with eyes, on the live box, this run

| What | Evidence |
|---|---|
| the phone nav strip is fixed | live `/` `/tags/` `/payroll/` `/shifts/` `/pl/` at 390×844: nav row **61px**, `h1` at **y=122**, scrollWidth 390 |
| …and that measurement can fail | `VERDICT_MUTANT=navrows` re-injects the old three-track rule in the browser: `/tags/` returns to rows **49/526/205/64, h1 y=587** — LOOK-PHONE #1's numbers to the pixel |
| `/tags/` has a way in | `/locations/` carries `<a href="/tags/">Unzugeordnete Tags</a>`, live; removing it (`VERDICT_MUTANT=tagslink`) turns the assertion red |
| `/tags/` is a real screen | `<h1>Unzugeordnete Tags</h1>`, German throughout, **no raw Zulu timestamp anywhere** (W7) |
| the map DRAWS on production | 18 tile requests, 30 tile nodes, Google attribution, **140 distinct colours** in the clipped rectangle, HOIV pin labelled `HOIV · 0 vor Ort · kein Tag · ohne Zone`; 5/5 loads, 0 `RefererNotAllowedMapError` |
| `/pl/` no longer prints a vacuous zero | live production, `app_settings` empty: the first tile reads **`Nicht beurteilbar`**, not `0` (W4) |
| the money fixes, with data | seeded `nfc_demo`: `Ergebnis 1.531,52 €` now carries **on its own tile** „1 Objekt mit 796,06 € realen Kosten ist nicht in dieser Summe enthalten" (W3); `/payroll/`'s rate-history caveat is the **first bullet above the table**, open (W2) |
| …and those can fail | the two page files reverted to `2cc19b2` and rebuilt: `check-pl-vacuous` **FAIL (5)**, `check-reports` red on both W2 assertions. Restored, both green |
| a dead API is honest | every `/admin/*` response blocked in the browser: **5/5 screens show the error and none still claims to be loading** |
| telemetry is wired | `check-telemetry-wire` PASS with `--import`; on the box `/proc` argv is `node --import /srv/nfc/instrument.mjs`, running as `app` |
| the timers RAN | `check-timers-ran.sh` OK — autoclose and backup both fired, both exited 0, `postgres ∈ app` asserted |
| production is clean | exact counts, not estimates: workers/operators/shifts/zones/reported_tags/phone_identities all **0**, locations 1, admins 1 (`schimmer`), sessions 1 |
| HOIV still has its pin | `hoiv-arsenalstrasse-11 | true | 48.1761151 | 16.3953038` |

Also green this run: `check-api` (182), `check-close-flag` (7), `check-phone-namespace`,
`check-branding`, `check-guards` (78 files), `web && pnpm verify`, `check-nav-strip-rows`,
`check-tags-screen`, `check-code-box`, `check-reports`, `check-unit-drift`, `smoke-live` (82).

### Where the reports disagreed, and who was right

**LOOK C5 vs RELIABILITY #3 — RELIABILITY was right, LOOK is stale.** LOOK says an offline
`/payroll/` shows the error *and* „Wird berechnet…", and the fix run deferred C5 into
TASK-230. RELIABILITY says twelve screens stopped doing that, but its check
(`check-load-failure.mjs`) reads the **source**, by its own admission. Driven in a browser
with every `/admin/*` response blocked: 5/5 screens show the error, **none** contradicts
itself. LOOK.md was written before `5456650` landed.

**LOOK's one greyscale failure — moot, and replaced by a smaller true one.** LOOK measured
`.form-error` (≈#8a8a8a desaturated) against „Wird berechnet…" (≈#E9EAEC) and concluded the
error ranked below the loading line. That loading line no longer exists. What is still true,
measured by painting the computed colour into a canvas rather than parsing it: `.form-error`
is **luma 157 at 14px** against body copy at **173 at 15px** — dimmer and smaller, but by
16/255, not the 4× a bad `lab()` parse first suggested. TASK-229 (1) stands, downgraded.

**Nobody's finding, seen in the same photograph:** the failure sentence is printed **twice**
on every one of the five screens — once as `.form-error`, once as an ordinary near-white
paragraph below the filter card. Nothing is wrong; it is just said twice, in two weights,
and neither copy is a button.

---

## 2 · UNOBSERVED — a skip is not a pass

- **390px was never looked at by the LOOK pass** (its own note) and this run measured five
  routes there, not seventeen. `/analytics/`, `/clients/`, `/contracts/`, `/inventory/`,
  `/material-requests/`, `/account/`, `/operators/`, `/workers/` at 390 remain LOOK-PHONE's
  word, not this run's.
- **The nav-strip check is non-vacuous on `/tags/` only.** Under the mutant the other four
  routes stayed green — their content is tall enough to hide the bug. Any future regression
  is caught on one route.
- **The client portal has not been opened on production.** One **live** `portal_grants` row
  exists (contact 1, HOIV, minted 2026-08-13, never revoked). Only its hash is stored, so
  nothing in this repo can say who holds that URL. The refusal path was checked: an unknown
  token gets `404 not_found`, same as an absent one.
- **`MAP_SAMPLES=0` used to print a green line over zero loads.** Fixed to say SKIPPED. Sixth
  vacuous check found in this project — this one written by the run whose job is to find them.
- **`pg_stat_user_tables` said production held 1 shift, 1 zone and 1 phone identity.** It is
  an estimate. Exact `count(*)` says 0/0/0. Anyone reading the estimate would have reported
  live test data that does not exist.
- Light theme, 1280px, `/analytics/`, and the whole UGLY list were not re-examined.
- Nothing was tested with more than one worker tapping at once, or against a real radio.

---

## 3 · VISUAL

**Good enough to show a client.** The desk admin at 1680 is coherent, German throughout,
dark and light both ship, and the map draws with the building pinned and labelled. The
screens that carry money now say what they do not know: `Nicht beurteilbar`,
`Nicht eingetragen`, `Nicht berechenbar` — three distinct refusals, not one silent zero. The
phone shell is fixed: the 465px of black that used to sit between the brand and the heading
is gone on every route, measured.

**Weak.** All sixteen UGLY findings are still live and were re-confirmed by eye this run:
money columns are **left**-aligned on `/payroll/` and `/pl/` (`.data-table td{text-align:left}`
at specificity (0,1,1) beats `.col-numeric{text-align:right}` at (0,1,0)), so `236,25 €` and
`3.874,51 €` share a left edge and `tabular-nums` buys nothing; every in-cell button sits
8px below its row; the brand wraps to two lines at 1280, which is a 13" MacBook Air. On a
phone only 2 of 9 nav destinations are visible and the „you are here" mark scrolls off.

**First to break at 20 workers / 8 buildings.** `/shifts/` is 39.7 phone screens for the 351
seeded shifts. A 20-worker operation writes ~440–880 shifts a month, and a „Dieses Jahr"
period ~10,000 against a hard server ceiling of **2000** rows per request
(`SHIFT_PAGE_MAX`, and the panel already asks for the maximum). Past that the ledger
truncates. Payroll has the reconciliation caveat for exactly this and it is asserted; the
`/shifts/` ledger has no pagination, no search and no tappable triage control, so at eight
buildings it becomes a scroll nobody performs.

---

## 4 · UX

**Good enough to show a client.** The whole card chain now works end to end and is reachable
without typing a URL: write → report → `Unzugeordnete Tags` → building or zone → tap. An
unbound card gets its own German sentence („Dieser Tag ist noch keinem Objekt zugeordnet…")
instead of the generic rejection bucket. Nothing in the app closes a shift, which is the
point. Caveats survive where money leaves the building: the rate-history sentence is the
first thing above the payroll table, not folded into a closed disclosure.

**Weak.** Ten of thirteen CONFUSING findings are open (TASK-230): the phone says `Betreiber`
where the admin says `Operator` — the two ends of the one procedure the owner runs by hand;
a 401 drops the director on a blank sign-in form with no „Ihre Sitzung ist abgelaufen" and
loses his period; `/payroll/`, `/pl/`, `/shifts/` and `/locations/` offer **no retry control**
when the server is unreachable — „versuchen Sie es noch einmal" is attached to nothing, and
only `/` has `Aktualisieren`. `/analytics/` still does not answer its own question.

**First to break at 20 workers / 8 buildings.** Two things, both today invisible:
`app_settings` is **empty on production**, so `/pl/` will flag nothing for ever and every
verdict reads „nicht beurteilbar" until the director sets a Zielmarge — honest now, but
useless. And `location_revenue` is empty, so the screen that answers „verdienen wir an
diesem Objekt" has nothing to answer with. Eight buildings × twelve months is 96 revenue
cells to be typed by hand, one at a time, with no import.

---

## 5 · RELIABILITY

**Good enough to show a client.** This is the strongest of the three, and it is the only one
proven by breaking production rather than by asserting at it. Postgres stopped mid-request
→ recovers in ~2s, same PID; API restart and two VM reboots with a shift open → shift
survives, serving again in ~21s; disk at 4MB free → clock-in and clock-out both still work;
the tag host's nginx stopped → the cleaner still clocks in, which is the two-host split
earning its keep; nine concurrent taps → one row every time. The 8h net closes a 9h shift at
`start+8h` and leaves a 7h one open. A fresh dump restores identical to production. The unit
file is now an artefact the deploy installs and asserts, the API runs as a nologin `app`
account, and `instrument.mjs` is loaded with `--import` — so a DSN would now take effect.

**Weak.** `SENTRY_DSN` is **still unset on the box** (verified: 0 matching lines in
`/etc/nfc/env`). The SDK loads and reports nowhere; journald is the whole of observability
(TASK-224). Backups are all on the one disk (TASK-227). The 8h net was dead for six days in
July and `list-timers` was green throughout; it is alive today only through an undocumented
`postgres ∈ app` group membership, now asserted by `check-timers-ran.sh` (TASK-226).

~~**First to break at 20 workers / 8 buildings — and the top of the whole ranking.** A shift
tapped with no signal is written correctly on the phone and **never pushed**, because there
is no background sync worker (TASK-225).~~ **CLOSED — 0.5.1 / versionCode 8, published.**
The paragraph above was the single worst thing in this document and it is no longer true of
the build the box serves. Delivery is a JobScheduler job with a network constraint that
survives a reboot; ordering and idempotency are a pure function over the existing
`client_uuid`; and what has NOT arrived is now visible to the worker (German, with the time
of the last attempt) and to the office (`X-Pending-*` → four `workers` columns, migration
009). Proven by switching an Android instance's radio off against production —
`demo/prove-offline-push.mjs`, 9 phases, OK with **6 assertions observed RED in the same
run**. *(Corrected 2026-08-21 by § 8: that instance is an EMULATOR, not a real device. The
sentence originally read "a real device". See § 8.2 for what that does and does not
invalidate.)* Full write-up, including the three defects the run found rather than asserted, is
`backlog/docs/RELIABILITY.md` § 1.

**And it is in the field's reach, which is a different claim.** § 0 of this document is
about thirteen commits that were in git and not on the box; the same trap was sprung on the
APK. The box was serving **0.4.1 / 6** — the build whose background push is dead and in
which opening the app from Recents CLOSES the worker's shift — while every fix sat in
`android/dist/`. Now published, and driven end to end on a phone running the field build:
Settings reads „Installiert: 0.4.1 (6)" and **„Version 0.5.1 ist verfügbar."**

What is left of it is smaller and filed: TASK-233 (the force-stop caveat sits below the
fold at 1080×2400 — to be moved, never deleted) and TASK-234 (a job armed for real work is
not cancelled when the foreground pass delivers it instead). Neither loses an hour.

---

## 6 · What cannot be known without hardware and a real card

Unchanged by this run, and unchangeable from a laptop. `CORE-FLOW.md` §4 is the script; §5
is the full list. The load-bearing ones:

- **No NFC card has ever been written by this code.** Every write assertion is against a
  stubbed card. TASK-222 is the owner's, by hand.
- Whether a real NTAG213 reports `maxSize` **137** or the raw **180**. Step 1 of the phone
  script — refusing the foreign Mifare Ultralight — is the only instrument that answers it,
  and it is step 1 because if it writes, every card written after it is suspect.
- Whether the overwrite guard fires against a real mounted card.
- Tag pulled mid-write, NFC toggled off mid-write, screen locked, app force-stopped mid-write.
- Whether App Links verify on the phone in hand: `adb shell pm get-app-links …` must report
  `timesheets.exe.xyz: verified`, or every tap opens Chrome instead of the app.
- Android 9 vs 16. One phone has been used.
- A real radio in a real basement. TASK-225's delivery is now proven on a real Android
  instance with the radio switched off by `svc`, which is a **clean, instant** loss of
  connectivity. A basement is a slow, flapping one: a radio that holds a dead association,
  a TCP connect that hangs rather than refuses, captive-portal wifi in a lobby. The queue
  and the ordering are proven; the timing against a real radio is not.

---

## 7 · Addendum — the second-client ceiling (TASK-235/236, 2026-08-21)

This document's own §3 named the first thing to break at 20 workers / 8 buildings:
`/shifts/` at 39.7 phone screens with no server-side windowing, and `/pl/` permanently
"nicht beurteilbar" because `app_settings` and `location_revenue` both ship empty and the
only write path was a 96-times-over drawer. Both are fixed and deployed; full measurement
is `backlog/docs/SCALE-PROOF.md`, not repeated here. The headline:

- `/shifts/` now WINDOWS `GET /admin/data` by period/worker/location/state instead of
  fetching the whole ledger up to `shift_limit`. Reproduced against a grown `nfc_demo`
  (8 buildings, 20 workers, 2862 shifts): the OLD unbounded request returned **0 of 410**
  real March rows (the newest-2000-rows-sitewide window started in April) — a real month
  reading as empty. The NEW windowed request answers it correctly regardless of ledger
  size, and the 2000-row ceiling is truthful at 1999/2000/2001 rows, with truncation and
  "outside the period" proven to never be conflated.
- `/pl/` gained `POST /admin/revenue`, a bulk write: 8 buildings x 12 months = 96 cells
  saved in one 42ms request instead of 96 drawer submissions, scoped to blank cells only
  so a mistake can create a wrong new row but never silently overwrite a correct one, with
  a review step before anything is sent. The baseline gained a `0%` SUGGESTED placeholder
  (never auto-saved) so the screen is not permanently inert on a fresh box.
- **Not fixed, stated plainly**: a full month's ledger at 20-worker density is still
  ~229 phone screens rendered. Windowing fixed the fetch and the truncation message, not
  the row-count-on-screen UX — that is LOOK-PHONE.md finding #3 and was out of scope here.
- Deployed: `./ops/deploy.sh` clean, `check-unit-drift` OK, association files verified on
  both hosts, `./ops/smoke-live.sh` 82/82, production left exactly as found (0 workers,
  0 shifts, HOIV pinned).

---

## 8 · THE LAST READ — the verdict pass, 2026-08-21, after `64f6f3f`

Everything below was done to the **live box** by this pass, not read out of a report. Where
a report and the machine disagreed, the machine is recorded and the report is corrected in
place. Reproduce:

```
./ops/check-box-serves-head.sh                 # is the box serving THIS tree
./ops/deploy.sh                                # build, migrate, restart, verify, re-hash
./ops/smoke-live.sh                            # 82 assertions against production
./ops/check-media-pii.sh                       # no committed screenshot names a real person
ADMIN_EMAIL=… ADMIN_PASSWORD=… node demo/verdict-live.mjs
ADMIN_EMAIL=… ADMIN_PASSWORD=… node demo/verdict-clarity-live.mjs
ADMIN_EMAIL=… ADMIN_PASSWORD=… node demo/verdict-map.mjs
ADMIN_EMAIL=… ADMIN_PASSWORD=… WORKER_ID=… node demo/prove-offline-push.mjs
node demo/check-shift-screen-brand.mjs         # the screen the CLEANER looks at
cd android && ./checks/run.sh
```

### 8.0 The box was one web-commit behind, again — and this time the check said so

`check-box-serves-head.sh` (written by the previous pass, in response to this failing three
times in one week) found the box serving a bundle built at `2358102a6244` while HEAD was
`64f6f3f`. Its § 3a correctly reported that nothing under `web/` had changed between them,
so nothing was actually stale — the instrument that used to be missing now distinguishes
"behind" from "wrong". Deployed anyway; the box now hashes identical to this tree, file for
file, including the APK.

### 8.1 The worst finding: TASK-238 was Done, and the cleaner's screen was still pink

Found by opening a screenshot `demo/prove-offline-push.mjs` had written an hour earlier and
nobody had looked at.

TASK-238 removed Material You from `ui/Theme.kt` and shipped 0.5.2 / versionCode 9 with a
hand-written scheme. That half was right. But `lightColorScheme()` assigns only what it is
handed, and the three roles the **clocked-in screen** is painted with were not handed over.
Measured on the shipped build, on that screen:

```
#FFD8E4  47.9% of the app's pixels   channel spread 39   Material baseline tertiaryContainer
#E6E0E9  40.9%                       channel spread  9   Material baseline surfaceContainerHighest
#31111D   0.7%                       channel spread 32   Material baseline onTertiaryContainer
```

**88.8% of the one screen the person doing the work looks at all day** was a colour nobody
in this project chose. The task's own AC — *"the dominant surface is achromatic"* — was
checked off over it.

**Why the check stayed green, which is the more useful half.**
`demo/check-app-not-wallpaper.mjs` renders with `am force-stop` + `am start -n <activity>`
and **no tap intent**, so it lands on the idle screen — whose dominant surface is `#FAFAFA`
and genuinely is the brand's — and has never once rendered the running screen its own
finding was written about. It asks whether the app follows the wallpaper. It answers that
correctly. It is not the question the AC was closed on. § 2 above counted the
`MAP_SAMPLES=0` line as the sixth vacuous check found in this project; this is the
seventh, and the second in a row found by a pass whose job is to find them.

The distinction worth keeping: `check-app-not-wallpaper` is **not vacuous** — its negative
case is a real build and it can go red. It answers a true and useful question. It was
closed over a DIFFERENT question, by a human reading `OK` and a task title in the same
glance. That failure mode survives every rule about falsifiability.

Fixed, shipped and verified: every role assigned in both schemes, elevation reading the same
way in both themes, `surfaceTint` set to the surface so Material's tonal overlay cannot leak
the accent back. **0.5.3 / versionCode 10**, published, `/app/version` byte-identical to
`android/dist`, signer unchanged so App Links still verify.

| instrument | what it covers | red | green |
|---|---|---|---|
| `core-check.kt` § 17 | the CLASS — every role used in `app/src` assigned in BOTH schemes | drop `tertiaryContainer` from one scheme → sets disagree; from both → `Missing: [tertiaryContainer]` | `core-check: OK` |
| `check-shift-screen-brand.mjs` | the INSTANCE, on a device — photograph the RUNNING screen | 0.5.2/9 → `#FFD8E4, 47.9%, spread 39` | 0.5.3/10 light `#F0F1F3`/`#FFFFFF` worst spread 6; dark `#131519`/`#1B1E23` worst spread 8 |

`prove-offline-push` re-run end to end on 0.5.3/10 afterwards: **OK, 69 ok, 5 RED, 0 FAIL** —
the theme change costs no wage.

### 8.2 The offline tap, re-proven — and two corrections to how it was reported

**PROVEN, twice, by this pass, against production.** Radio off with `svc`, tap, the row on
the phone and **nowhere else**, `am kill`, network back, and the row arrives with the app
never reopened, carrying the *tap's* own timestamp. Then: a close never overtakes its open
(`404 unknown_shift`, fully credentialled); the same `client_uuid` twice is one row; a
force-stop stalls it **visibly** and opening the app clears it; a server-side session delete
neither loses the row nor files it under the next holder.

```
0.5.2 / 9   70 ok   5 RED   0 FAIL
0.5.3 / 10  69 ok   5 RED   0 FAIL     ← the build the box now publishes
```

**Correction 1 — it is an EMULATOR, not a real device.** The only Android attached to this
project is `emulator-5554`, `ro.product.model=sdk_gphone64_arm64`, `ro.kernel.qemu=1`. Every
run ever made of this file was an emulator. `RELIABILITY.md` § 1 said "a real Android
instance"; the WAGES report said "real device". Both are corrected in place.

*What that does NOT invalidate:* the queue, the ordering, the idempotency, the survival of
`am kill`, and JobScheduler's persistence are platform behaviour and are genuinely proven.
*What it does:* `svc wifi disable` is a clean, instantaneous loss of connectivity. A basement
is a slow, flapping one — a radio holding a dead association, a TCP connect that hangs
rather than refuses, a lobby captive portal. The mechanism is proven; the timing against a
real radio is not, and cannot be from here.

**Correction 2 — five REDs, not six.** `demo/prove-offline-push.mjs` contains exactly five
`red(…)` calls and both runs printed five. Small, and recorded because averaging two
disagreeing reports is how this project has twice mistaken a skip for a result.

**One thing an emulator DID settle, and it was on the "unknowable" list.**
`adb shell pm get-app-links io.github.qwadratic.NFCTimeSheets` reports
`timesheets.exe.xyz: verified`. App Link verification is a network fetch of
`assetlinks.json` plus a signature comparison, and neither is hardware-dependent: this is
real evidence that the association file and the shipped signer agree. What remains
phone-specific is only whether a given OEM build performs verification at all and when.

### 8.3 A real person, a real address and a real contract sum were in HEAD of a PUBLIC repo

Found by opening a **committed** screenshot. `docs/media/prove-live/02-building-created.png`
and its `.txt` sibling carried, legibly: the client contact's full name, the building's
street address, and `5.000,00 €` per month. `github.com/proximata/nfc-timesheets` is public.
Tracked since `2cc19b2`.

The README in the same directory ended with *"Nothing here carries a real customer name,
address or rate."* That sentence was written by the run that produced the files, believed by
every run after it, and there was nothing that could have contradicted it.

Done here (`987368b`, TASK-239): the four files out of HEAD, and `ops/check-media-pii.sh` —
which reads the real names, addresses, contacts and contract sums out of the **live
database at run time** (hard-coding them would put the leak in the file meant to prevent
it), greps every committed transcript, and refuses any committed `prove-live` screenshot
with no transcript beside it, because painted text is invisible to grep. `--mutate` restores
the withdrawn file from history and goes red on three values.

Its own first two revisions each found fewer than they should have — `to_char()` formats in
the *server* locale, and Node's `de-AT` groups with U+202F while the bundle renders a full
stop. Both are written into the file: it read 3 needles and matched 2, i.e. it would have
cleared the very file it was written for.

**NOT fixed, and it is the owner's:** the blobs are still fetchable from history. That needs
`git-filter-repo` plus a **force push to a public repo**, which an agent does not do
unilaterally. TASK-37 is the same remedy for a different blob — do both in one rewrite.

### 8.4 Verified live, with eyes, this pass

| What | Evidence |
|---|---|
| the box serves this tree | `check-box-serves-head` OK — JS/CSS `1135dc1e…`, bundle `4d6c7ce9…`, `server/{lib,routes,server.js,instrument.mjs}`, APK byte for byte, build id `64f6f3fce16b` |
| the clarity pass is LIVE, not just committed | `verdict-clarity-live` **all green on production**: `Betreiber` (never `Operator`), a 401 returns to `/payroll/?period=2026-07` and says the session expired, `Erneut versuchen` at 44px on four screens and it actually reloads, 12px badge floor, `.btn-quiet` underlined, `.form-error` luma 178 ≥ prose 173, `Kunde anlegen` singular |
| the phone shell at 390 | nav row 61px, `h1` at y=122, `scrollWidth` 390 on `/ /tags/ /payroll/ /shifts/ /pl/`; the strip self-scrolls to „you are here" on `/`, `/pl/`, `/payroll/`, `/account/` |
| the map DRAWS on the real host | 18 tile requests, 30 tile nodes, **138 distinct colours** in the clipped rect, HOIV pinned and labelled `HOIV · 0 vor Ort · ohne Zone`, 5/5 loads, zero `RefererNotAllowedMapError` — seen, not counted |
| `/pl/` on a fresh box has a way forward | four tiles read `Nicht beurteilbar` / `Nicht berechenbar` / `Nicht berechenbar` / `Nicht eingetragen`, and the screen offers `Zielmarge festlegen`, `Zielmarge jetzt festlegen` and an inline blank-cell revenue row in the same view |
| money right-aligns | `0,00 €` under ARBEIT and MATERIAL share a right edge on live `/pl/` (U1) |
| the API is what the repo says | `check-unit-drift` OK — argv is `/usr/bin/node --import /srv/nfc/instrument.mjs /srv/nfc/server.js`, running as nologin `app` |
| the timers RAN | `check-timers-ran` OK, last fire 46216s ago against a 129600s ceiling, `postgres ∈ app` asserted |
| the whole API surface | `smoke-live` **82/82** |
| the Android logic | `checks/run.sh` — core-check, known-tags, tag-writer, manifest-check all OK |
| production is exactly as found | `0 workers, 0 operators, 0 shifts, 0 zones, 0 reported_tags, 0 phone_identities, 0 location_revenue, 0 app_settings, 1 location, 1 admin (schimmer), 1 session`; HOIV `hoiv-arsenalstrasse-11 \| true \| 48.1761151 \| 16.3953038` |

Everything this pass created on production was removed by it: one throwaway admin (73), one
throwaway worker (88), four shifts. Counted before and after, exactly, not estimated.

### 8.5 VISUAL

**Good enough to show a client.** The desk admin at 1680 is coherent, German throughout,
dark and light both ship, and the map draws with the building pinned and labelled. The
screens that carry money say what they do not know — three distinct refusals, never a silent
zero — and now offer the control that resolves each. The phone shell is whole at 390 on
every route measured, the nav strip scrolls itself to where you are, and money right-aligns.
**And the cleaner's own screen is finally the product's colour rather than Google's**, in
both themes, which until today was true of no build ever shipped.

**Weak.** Most of the UGLY list is still open (TASK-230): in-cell buttons sit below their
row, and on a phone only 2 of 9 nav destinations are visible at a time even though the strip
now scrolls. `/analytics/` still does not answer its own question. `/pl/` on a fresh box is
eleven bullets of argument under four refusals — honest, and bleak on day one.

**First to break at 20 workers / 8 buildings.** `/shifts/` row density on a phone, measured
this pass on the live box: **four shifts render 2318 CSS px**, i.e. roughly 0.7 phone screens
each. TASK-235 fixed the *fetch* — the window is correct and the truncation message is
truthful — and explicitly did not fix this. A 20-worker month is 440–880 shifts; at this
density that is several hundred phone screens with no search and no triage control. It is
LOOK-PHONE #3, it is filed, and it is the first thing a second client will feel.

### 8.6 UX

**Good enough to show a client.** The card chain works end to end without typing a URL:
write → report → `Unzugeordnete Tags` → building or zone → tap. Nothing in the app closes a
shift. A 401 no longer discards the director's period. Every screen that can fail to load
now offers a control rather than an instruction attached to nothing. Caveats survive where
money leaves the building.

**Weak.** `/pl/` is inert until the director types a Zielmarge and one revenue figure —
both now reachable in two clicks from the screen itself, which is the change that makes it
weak rather than useless. The `Unzugeordnete Tags` route is still reached only from
`/locations/`. TASK-230 keeps C7, C9, C11, C12 and PHONE #8/#9 open.

**First to break at 20 workers / 8 buildings.** Eight buildings × twelve months is 96 revenue
cells. TASK-236 turned that from 96 drawer submissions into one 42ms bulk write scoped to
blank cells — that is the ceiling raised, not removed: there is still no import, and every
figure is typed by a human once.

### 8.7 RELIABILITY

**Good enough to show a client, and it is the strongest of the three** — the only one proven
by breaking production rather than by asserting at it. Postgres stopped mid-request →
recovers in ~2s; two reboots with a shift open → the shift survives; disk at 4MB → clock-in
still works; the tag host down → the cleaner still clocks in; nine concurrent taps → one
row; the 8h net closes a 9h shift and leaves a 7h one open. The stranded-shift hole is
closed and re-proven twice by this pass. The unit file is an artefact the deploy installs
and asserts.

**Weak.** `SENTRY_DSN` is **still unset on the box** — verified again this pass, 0 matching
lines in `/etc/nfc/env`. The SDK is loaded via `--import` and reports nowhere; journald on
one VM is the whole of observability (TASK-224). Backups are all on the one disk (TASK-227).
The 8h net lives on an undocumented `postgres ∈ app` group membership, now asserted
(TASK-226).

**First to break at 20 workers / 8 buildings.** Not the API and not the queue — the *people*
layer. Twenty phones is twenty enrolments, twenty `phone_pending_*` columns nobody has a
screen to sort by, and one `admins` row. Behind that: `SHIFT_PAGE_MAX` at 2000 is proven
truthful rather than removed, so a „Dieses Jahr" period on a second client truncates —
visibly, with the right sentence, which is the correct behaviour and still a wall.

### 8.8 What still cannot be known without hardware and a real card

Unchanged, and unchangeable from a laptop. `CORE-FLOW.md` § 4 is the script.

- **No NFC card has ever been written by this code.** Every write assertion is against a
  stubbed card. **TASK-222, the owner's, by hand.**
- **The Ultralight refusal is step 1 and is the owner's**: present a foreign Mifare
  Ultralight and watch the writer refuse it. It is step 1 because if it *writes*, every card
  written after it is suspect. It also settles whether a real NTAG213 reports `maxSize` 137
  or the raw 180.
- Whether the overwrite guard fires against a real mounted card.
- Tag pulled mid-write, NFC toggled off mid-write, screen locked, app force-stopped mid-write.
- Android 9 vs 16, and one OEM vs another: **one emulator has been used**, not one phone.
- A radio that flaps instead of dying. See § 8.2.

### 8.9 What needs the owner, and nothing else

1. **`SENTRY_DSN`** — one string into `/etc/nfc/env`, then `systemctl restart nfc-api`.
   Everything else is already wired and asserted; without it the product has no way to tell
   anyone it is broken except journald on a box nobody watches (TASK-224 / TASK-44).
2. **The Ultralight refusal, then a real card** (TASK-222). Until this runs, the feature the
   product is named after has never touched hardware.
3. **A force push to the public repo** to purge two blobs from history — TASK-239 and
   TASK-37, one rewrite, and a decision on whether this repository stays public at all.
