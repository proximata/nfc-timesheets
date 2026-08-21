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

**First to break at 20 workers / 8 buildings — and the top of the whole ranking.** A shift
tapped with no signal is written correctly on the phone and **never pushed**, because there
is no background sync worker (TASK-225). No server row means no 8h net, no payroll line, and
**no way to ask the question** — `worker_sessions` has no last-seen column. With one worker
in one building this is a rounding error someone notices. With twenty workers across eight
buildings, several of them basements, it is a payroll that is quietly short every month and
a director who cannot tell absence from a phone in a pocket. The cheap half is detection,
not delivery.

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
- A real radio in a real basement — which is the mechanism behind TASK-225.
