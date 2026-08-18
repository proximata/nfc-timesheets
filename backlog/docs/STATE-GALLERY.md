# State gallery — every screen, every state, photographed and judged

**400 screenshots · 81 distinct states · 4 configurations each (1680 and 390 px, dark and light).**
Written for the owner. Nothing here is deployed; production still runs the old admin.

The images are in `docs/media/states/`. **They are gitignored and not committed** — 55 MB of
regenerable PNGs, and this repo has already paid for one history rewrite over committed media.
Everything below names the file it is talking about, so any claim can be re-shot and checked.

To rebuild the whole set (~35 minutes):

```
sh demo/check-guards.sh
cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY="$(cd .. && psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY)" \
  NEXT_PUBLIC_API_BASE_URL="" NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm build && cd ..
DATABASE_URL=postgres:///nfc_demo APP_KEY="$(psst get APP_KEY)" PORT=8080 \
  PUBLIC_DIR="$PWD/web/out" node demo/demo-server.mjs &
SHOOT_OUT="$PWD/docs/media/states/" node demo/shoot-ia.mjs      # screens + panels + map states
SHOOT_OUT="$PWD/docs/media/states/" node demo/shoot-states.mjs  # transient + seeded states
node demo/probe-panel-reach.mjs                                 # the geometry behind finding 3
```

---

## The five things to fix first

| # | What | Why first | Task |
| --- | --- | --- | --- |
| 1 | **/pl/ books revenue for days that have not happened** | reports **99,25 % margin** for a real building; the contract decision is made on it | TASK-175 |
| 2 | **Payroll's „Nicht gezählt" says 0 while 810,30 € is missing** | the number that becomes a bank transfer | TASK-176 |
| 3 | **Worker panel hides all 3 cross-links; 950 px of scroll on a phone** | D5, the stairwell call, ≥1/week | TASK-177 |
| 4 | **Day zero has no way forward** | the new client starts next week and this is their first screen | TASK-178 |
| 5 | **390 px spends 760 of 844 px before the first fact** | every phone visit, every day | TASK-179 |

1 and 2 are money. 3, 4 and 5 are time. Nothing in this list is a taste argument.

---

## 1 · Screenshot index

Naming: `<state>-<width>-<theme>[-top|-bottom|-overlay].png`.
`-top` = viewport only (the map does not survive a full-page capture); `-bottom` = scrolled to
the total; `-overlay` = the drawer, photographed over its page.

### The fourteen screens, as they ship

`home` `shifts` `material-requests` `workers` `locations` `clients` `payroll` `pl` `account`
`contracts` `analytics` `inventory` `login` `portal`

### Object surfaces (decision-38 — query parameters on existing routes)

| File | State |
| --- | --- |
| `home-panel` | building panel on a pinned building — the info box on the pin |
| `home-panel-unpinned` | building with no coordinates → the drawer instead |
| `home-panel-ghost` | well-formed uuid naming no building |
| `worker-panel` | worker as an object, `/workers/?worker=1` |
| `shifts-filtered` `shifts-unresolved` | one building; the triage filter |
| `payroll-filtered` `pl-filtered` `analytics-filtered` `contracts-filtered` | scoped to one building |
| `materials-filtered` `locations-notag` | one status; buildings with no tag |

### The map's degraded states — all four, all ordinary

| File | State |
| --- | --- |
| `home-map-nopins` | no building geocoded — **this is production today** |
| `home-map-blocked` | `gm_authFailure` — key refused, or quota spent |
| `home-map-offline` | `maps.googleapis.com` blocked by the browser |
| `home-empty` | no active building at all |

### Transient states — held still by patching `fetch` inside the page

| File | State |
| --- | --- |
| `state-loading-{home,shifts,payroll,pl,analytics}` | the API never answers |
| `state-error500-{home,shifts,payroll,workers}` | server answered 500 |
| `state-offline-{home,shifts}` | the request never left the machine |
| `state-401-from-payroll` | session expired mid-session → what the redirect actually shows |
| `state-form-login-failed` `state-form-account-rejected` | the two forms, rejected |

### URLs that name nothing

`state-badurl-ghost-worker` · `state-badurl-ghost-location` · `state-badurl-malformed-location` ·
`state-badurl-uppercased-location` · `state-badurl-unknown-period` · `state-badurl-nonsense-param`

### Seeded states — these do not exist until something creates them

| Group | What was written | Files |
| --- | --- | --- |
| `state-norate-*` | the **busiest** worker made rate-less | payroll ×2 periods, pl, workers, home |
| `state-baseline-*` | a 25 % margin baseline set | pl, pl scoped to one building |
| `state-portal-*` | three client links: live, empty, revoked; plus a brand-new building | ready, empty, revoked, notoken, badtoken, toomany, failed, admin-newbuilding |
| `state-onerow-*` | one building, one worker, one shift — week one of a real client | home, shifts, payroll, pl, workers, locations, analytics |
| `state-empty-*` | day zero: nothing created, nothing tapped | all 11 screens |

### Where the database ended up

`nfc_demo` was dumped with `pg_dump -Fc` before the first write and restored with
`pg_restore --clean` after every destructive scenario and again at the end. Row counts before
the gallery started and after it finished:

```
admins 1 · app_settings 0 · clients 3 · contacts 4 · inventory_items 9 · location_contracts 6
locations 6 · material_requests 8 · portal_grants 0 · schema_migrations 5 · shifts 351
worker_sessions 0 · workers 8
```

Identical on every table but one: `sessions` went 450 → 462, twelve rows the harness's own
sign-ins created; they expire on their own and the next login sweeps them. `locations` is back at
6 active and 5 pinned. No worker's rate was left changed, no portal grant survived, the building
created for the empty-portal state is gone. **Production was never touched — no SSH, no write,
not even a read.**

---

## 2 · The critique

Ranked by frequency × pain, split the way the brief asks: what misleads about money or hours,
what costs time every day, and what is merely ugly.

### (a) Misleads about money or hours

---

**A1 · /pl/ reports margins built on revenue for days that have not happened.** — TASK-175

`thisMonth`, `thisQuarter` and `thisYear` all end at a **future** boundary
(`web/lib/period.ts`), and the server accrues the monthly contract fee for every contract-valid
day in the range with no clipping to today (`server/lib/reporting.js`, `contractSlice`). Labour
only exists for days that have happened. So the margin is always wrong in the flattering
direction, and by a lot.

```
state-onerow-pl-1680-dark.png     1 building · 1 shift of 3:15 · „Dieses Jahr"
                                  → Marge 99,25 %   Ergebnis 8.340,65 €
state-baseline-pl-1680-dark.png   6 buildings · 25 % baseline · „Dieses Jahr"
                                  → Marge 76,99 %   every building „Auf oder über der Zielmarge"
```

The screen refuses to guess everywhere else — `Kein Vertrag hinterlegt` instead of 0,00 €,
„nicht beurteilbar" is not a pass, a `revenuePartial` note when the *contract* covers less than
the period. There is no state at all for the reverse: a *period* that runs past today.

Journey **D8** (is this building worth the contract) and **D12** (reprice). One dropdown click,
monthly, and it is the input to a pricing decision.
Cheapest fix: a sentence in the methodology block when `range.to > now`, naming the days that
have not happened. No arithmetic touched. Clipping the accrual is the real fix and needs its own
decision record — it would change numbers already reported.

---

**A2 · Payroll's „Nicht gezählt" cell reads 0 while wages are missing from the total.** — TASK-176

```
payroll-1680-dark.png                            Auszuzahlen 3.638,26 €   Nicht gezählt 0
state-norate-payroll-lastmonth-1680-dark.png     Auszuzahlen 2.827,96 €   Nicht gezählt 0
                                                 ↑ 810,30 € less, same „0"
```

The cell counts unresolved and open *shifts* only. A worker with hours and no hourly rate is not
in it — but their wages are not in the payout either. And „Stunden 267,25" **includes** the
72,25 hours that were never valued, so the two headline numbers do not reconcile with each other:
267 hours at ~14,50 € is ~3.875 €, not 2.828 €, and nothing on the band explains the gap.

Everything else on this screen is already honest and must not be touched: the caveat prose names
the count and links to the fix, the per-row column says „Kein Stundensatz", and the CSV carries
`csvTotalNoRate`. **Seven of the eight surfaces are right. Only the headline lies** — and the
headline is what the answer band was built to be read alone.

Journey **D7** (month-end payroll, extreme consequence) and **D14** („my hours are wrong").
Cheapest fix: count exclusions of every kind in the cell; add „davon N nicht bewertet" to the
hours sub-line. Two expressions.

---

### (b) Costs the director time, every day

---

**B1 · The worker panel hides all three of its cross-links below a ten-row history.** — TASK-177

Measured, not eyeballed — `demo/probe-panel-reach.mjs`:

```
                          cross-links reachable without scrolling
1680×1000  worker panel        0/3    first one needs   145 px
 390×844   worker panel        0/3    first one needs   950 px
1680×1000  building drawer     6/6    already visible
 390×844   building drawer     6/6    already visible
```

The difference is ordering and nothing else. `BuildingFacts` puts „Weiter zu" before its history;
`WorkerPanel` puts it after ten shift cards. This is defect V1 of the map round — the info box
hiding 8 of 8 links — repeated in the drawer, which nobody measured.

Journey **D5** („I could not clock out", ≥1/week) and JOURNEYS §9 item 4, which asks for closing
a named worker's shift *in one action, on a phone, in a stairwell*. That is the journey
decision-28 exists for, and it currently costs 950 px of scrolling past history nobody asked for.
Cheapest fix: move one block above another. The building panel already proves it reads well.

---

**B2 · Day zero has no way forward, and says nothing four times.** — TASK-178

`state-empty-home-1680-dark.png`. Four empty panels; the sentence „Sobald ein Objekt angelegt ist,
erscheint es hier und auf der Karte" **with no link to the screen that creates one**; the only
header action is „Aktualisieren". „Zurzeit ist niemand eingestempelt." appears three times and
„Nichts offen." a fourth — about a thousand pixels explaining absence.

And the map says: „**0 Objekte haben keine Koordinaten, daher gibt es nichts zu zeichnen.**"
That sentence contradicts itself, and its trigger is exactly zero active buildings — production's
day one, and the state the new client is onboarded into.

Journey **D1** (onboard a new client from nothing — *starts next week*). Once per client, but it
is the first impression and the first dead end.
Cheapest fix: the empty list gets the link it already describes; the zero-building case gets its
own sentence. Keep every empty-state sentence — an empty exception view reading as data loss is
the incident this ledger design exists to prevent.

---

**B3 · At 390 px, 760 of 844 pixels go by before the first fact.** — TASK-179

`home-390-dark-top.png`, top to bottom: brand → **Darstellung** select → **Sprache** select →
Abmelden → a nav strip cut off mid-word → h1 → question → answer band → „Karte anzeigen" → a
paragraph saying the map is collapsed → the list's own two-line note → first building name at
y ≈ 760.

The two controls a director touches once *ever* hold the top of the phone screen. Related, same
cause: `demo/shoot-ia.mjs` counts **175 controls under 44 px on /shifts/ at 390 px** — the row
links are 17–20 px, under the 24 px minimum let alone the 44 px target.

Journey **D4** (daily check) and **D5**. Every phone visit.
Cheapest fix: collapse theme + language + sign-out into one disclosure at 390 px and move it below
the nav. Grow the row hit areas. Nothing is removed.

---

**B4 · Answer bands print 0 where they mean „nothing to measure".** — TASK-180

Four screens, one pattern:

| File | Cell | With how many rows |
| --- | --- | --- |
| `state-empty-pl-1680-dark` | „Unter der Zielmarge **0** / Alle Objekte konnten beurteilt werden" | zero objects |
| `state-empty-analytics-1680-dark` | „Über der vereinbarten Zeit **0** / Unter … **0**" | zero buildings |
| `pl-1680-dark` | „Unter der Zielmarge **0** / 6 Objekte sind nicht beurteilbar" | nothing *can* be flagged |
| `state-empty-home-1680-dark` | „Zu erledigen **0**" | empty database |

Every sub-line is honest. The number above it is not, because 0 means two different things here
and the typography gives the reassuring one the large type. /pl/'s own callout says
„nicht beurteilbar" ist nicht dasselbe wie „in Ordnung" — and then its answer band does exactly
that, two inches higher.
Cheapest fix: let the cell take a string, pass an em dash when the denominator is zero. Four call
sites, no sub-line touched.

---

**B5 · The triage view shows the same shift twice.** — TASK-183

`shifts-unresolved-1680-light.png`: `?state=unresolved&period=all` renders the „ZU ENTSCHEIDEN"
band **and** the table with the identical row, under two answer cells both reading „1", after a
filter bar that repeats „Angezeigt werden alle geladenen Schichten" a second time. One shift,
five restatements. This is the destination of the dashboard's most-used link.
Journeys **W8** + **D5**, 1–2/week. Fix: suppress the band when the filter *is* the band's own
predicate.

---

### (c) Merely ugly

- **C1 · `no_key` in the interface.** `home-map-nopins-1680-dark-top.png` — five rows read
  „Keine Koordinaten · **no_key**", one reads „noch nie abgefragt". Half German, half machine, and
  `no_key` is the status on production's only building. TASK-181.
- **C2 · /workers/ is a paragraph inside a table cell.** `workers-1680-dark.png` — eight columns,
  and one holds the whole sentence „Kein Stundensatz – in der Lohnabrechnung namentlich
  ausgenommen, nicht mit 0,00 € bewertet", per row. Every cell wraps to three lines; the wrapped-word
  count is 86, the highest in the product. TASK-183.
- **C3 · The client portal wraps every cell on a phone.** `state-portal-ready-390-dark.png` —
  „Mo., 17.08.2026" over two lines, „2:15 Std." over two lines, twenty times. It is the only screen
  an outsider ever sees, it arrives by WhatsApp, and it does not carry the operator's name. TASK-182.
- **C4 · The info box floats free of its pin, and covers three others.**
  `state-badurl-uppercased-location-1680-dark.png` — the box for Aerztezentrum Landstrasse sits on
  top of Buerozentrum Handelskai and Wohnhaus Wagramer Strasse with no tail or leader to its own pin.
  Which building it describes is only knowable from its title.
- **C5 · The map caption band is a ~700 px stub under a 1350 px map.** Cosmetic, but it is the
  landing screen and it reads as unfinished.

---

## 3 · What is GOOD, and must survive the next pass

A critique that only lists faults gets the working parts refactored away. These are the parts.

1. **The map's degraded states are better screens than the drawn map.**
   `home-map-nopins-*` and `home-map-blocked-*`: no grey box, no spinner, no apology. The reason
   in a sentence — including „Welches von beidem, lässt sich hier nicht unterscheiden" — the
   complete list underneath, and a per-row „Koordinaten holen" on the buildings that need it.
   Six buildings are fully visible above the fold in the degraded state; one is visible when the
   map draws. **Never replace these with a grey frame.**

2. **/pl/'s three refusals, on screen and not in a tooltip.** „Kein Vertrag hinterlegt" instead of
   0,00 €. „Nicht beurteilbar – keine Zielmarge gesetzt", never a pass. And per row: „davon 46:15
   von 2 Mitarbeitern ohne Stundensatz – nicht bewertet". The methodology block stays prose a
   director can read down a phone line.

3. **The escape hatches from an empty period.** „264 weitere Schichten liegen außerhalb dieses
   Zeitraums", „Angezeigt wird 20. Juli bis 18. August", and the two jump buttons. This is the
   whole reason „empty" no longer reads as „gone".

4. **Payroll's reconciliation line in *both* branches**, including „auf dieser Seite fehlt nichts".
   Silence would be indistinguishable from not having checked.

5. **The filter chips.** Every one removable, the unknown one amber-outlined with a sentence, and
   at 390 px the chip wraps and keeps its ✕ on screen (`home-panel-ghost-390-dark.png`).

6. **The unknown-object contract.** An UPPERCASED uuid resolves to its building (decision-21 puts
   a uuid in the tag URI); a well-formed uuid naming nothing says so and does not silently show the
   unfiltered screen. Both verified: `state-badurl-uppercased-location-*`, `state-badurl-ghost-location-*`.

7. **Words before colour, everywhere.** „über 8 Stunden, der Timer wird diese Schicht beenden",
   „Zählt nicht zur Bezahlung" next to every state, „▲ prüfen" on the pin. All of it survives
   greyscale.

8. **The portal's single failure message** for unknown, revoked and switched-off. Splitting it into
   friendlier per-cause messages would be a probe into our client relationships. Do not.

9. **`/reinigung/` as its own style island** — light card, no admin chrome, no locale switcher,
   exactly three fields per row. It stayed clean through the whole redesign.

10. **The harness itself.** `demo/shoot-states.mjs` dumps before it writes and proves the row counts
    afterwards; `demo/check-guards.sh` refuses a database that is not `nfc_demo`. Between them they
    caught two of their own bugs during this run — a „loading" screenshot of a fully loaded /pl/,
    and a navigation that hung because two states differed only by URL fragment.

---

## 4 · What is still MISSING against JOURNEYS.md

### Zones are not built (decision-37, TASK-158, TASK-167) — what that costs today

A shift resolves to a **building**, not a place inside it. Concretely:

```
W3  tap → building.  A six-storey house with three entrances is one number.
W6  two zones, one shift — cannot be recorded at all.
D1  cannot create zones ∴ a tag per entrance cannot be ordered.
D2  „which sticker goes where" has no data behind it.
D4  „who is on site" is worker × building, never worker × zone.
D8  „which part of this building eats the hours" is unanswerable.
```

The practical cost: **the second client cannot be onboarded at the granularity they will ask
for, and every tag written before zones exist will have to be re-written.** decision-15 keeps
tags unlocked, which is the only reason that is survivable rather than a re-purchase.

### The verification tap is still deferred (IA-PLAN §9.2)

Testing a tag still means starting a real shift, and shifts are never deleted — so verifying a
tag costs an undeletable payroll row, multiplied by the number of zones. The stated trigger
(„tags deployed in bulk, or zones going in") fires the moment the second client is onboarded.

### Still SQL or SSH only

shifts older than the 2000-row window · whether a tap ever reached the server · resetting a
forgotten admin password (deliberate) · recovering from loss of the VM (**no offsite copy
exists**) · seeing any server error at all (`SENTRY_DSN` is unset).

### Still impossible from any screen

A worker seeing their own month (`/shifts/mine` is never called) · detecting a worker tapping the
wrong building (no assignment model) · deleting a shift (correction only, no delete route) ·
recording *why* a shift was corrected (D6 has no reason field).

### Still a phone call

„Did the enrolment code arrive" (D3) · anything a client asks beyond when/who/how-long (C4) · a
materials request nobody has opened — there is no push in either direction (W9/D9), and the
standing callout on that screen says so.

### The one live tag

Still a foreign, URL-less tag adopted by hardcoded serial in `android/nfc/KnownTags.kt`. Nothing
in the admin says a tag is adopted, so W10 („my tap did nothing") remains undiagnosable from the
panel — which is the same gap D5 hits from the other side.

---

## 5 · What did NOT happen in producing this

- **Production was not touched.** No SSH, no read, no write. Every number here comes from
  `nfc_demo` on this machine.
- **No application code was changed.** Nothing under `web/`, `server/`, `android/`,
  `NFCTimeSheets/`, `sql/`, `ops/`. Two files were added under `demo/` and one line to
  `.gitignore`.
- **No screenshot was committed.** `docs/media/states/` is gitignored.
- **`no_key` was not fixed, the payroll cell was not fixed, nothing on this list was fixed.**
  Eight tasks were filed (TASK-175 … TASK-183) and every one of them is queued, not done.
- **The map's `noKey` state was not photographed** — it needs a second build with the key removed,
  and it is not one of the four degraded states the owner named. The other four are all here.
- **Frequencies are JOURNEYS.md §8's estimates**, from the shape of the business, not from
  measurement. There is no analytics on worker behaviour and there should not be.
