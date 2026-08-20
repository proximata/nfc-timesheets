# LOOK — the admin and the client portal, on a phone

Written by opening 100 full-page screenshots and reading them, not by counting green
assertions. The standing lesson of this repo is that `demo/audit-phone.mjs` was green while
every card was captioned with the wrong column, so the method here is deliberately the other
one: photograph whole screens, print every caption beside the cell it captions AS TEXT, drive
the journeys a director actually does, and break things on purpose.

**Nothing was fixed.** Two probes and a slicer were added under `demo/`; one hypothesis (§1)
was tested by injecting CSS into a live browser and removing it again. No application file
was changed.

| | |
|---|---|
| widths | **360**, **390**, **414**, all `mobile:true`, dsf 2 |
| themes | dark and light at 390; dark at 360 and 414; plus a greyscale pass at 390 |
| screens | 14 admin routes + the client portal + its two failure states |
| stack | `web/out` built with the Maps key, served by `server/server.js` on `127.0.0.1:8080` against `nfc_demo` |
| evidence | `docs/media/look-phone/` (gitignored, 86 MB, 100 PNGs + 166 tiles + a JSON dump per screen) |

Reproduce:

```sh
sh demo/check-guards.sh
psql -q -d nfc_demo -f demo/seed.sql && DATABASE_URL=postgres:///nfc_demo node demo/make-admin.mjs
cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY=$(cd .. && psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY) \
  NEXT_PUBLIC_API_BASE_URL="" pnpm build && cd ..
cd server && DATABASE_URL=postgres:///nfc_demo APP_KEY=… PORT=8080 PUBLIC_DIR=../web/out node server.js &
node demo/look-phone.mjs                     # the sweep
node demo/look-journeys.mjs                  # what each journey costs
node demo/slice-shots.mjs docs/media/look-phone/390-dark-shifts.png 1500
```

Port **8080** is not a preference: the Maps key is referrer-locked to `127.0.0.1:8080` and the
production host, and a map probe on any other port shows zero pins and looks exactly like a
defect. That has been misdiagnosed twice.

---

## Ranked by cost

Cost = what it costs the director × how often he pays it. Frequency is from JOURNEYS §8.

| # | Finding | Pays it | Cost |
|---|---|---|---|
| 1 | The nav strip row takes `1fr` → a blank screen on every load and on every short screen | every navigation | **highest** |
| 2 | `/tags/` has no way in at all, and the guard that would say so does not cover it | every card mounted | **high** |
| 3 | `/shifts/` „Zu entscheiden" contains nothing tappable, and the ledger below it is 39.7 screens | 1–3×/week | **high** |
| 4 | The enrolment-code box strikes through the line that says when the code expires | ~1×/month, per hire | med-high |
| 5 | A 500 says „failed" and „still loading" at once; `/payroll/` and `/shifts/` offer no retry | every bad stairwell | med-high |
| 6 | 2 of 9 destinations visible; the „you are here" mark is scrolled off-screen everywhere else | every navigation | medium |
| 7 | The state pill is 11px — below the design system's own smallest step | every row | medium |
| 8 | Card values are right-aligned, including whole sentences | every card | low-med |
| 9 | The client portal wraps „Mo.," / „17.08.2026" and „3:45" / „Std." on most rows | 1–4×/month, per client | low |

---

## 1 · The nav strip row takes `1fr`. Every page load on a phone starts blank.

**The cause is one missing line.** `web/app/globals.css:227` declares the shell for the
desktop's THREE area rows:

```css
.app-shell { grid-template-rows: auto minmax(0, 1fr) auto;
             grid-template-areas: "header tools" "sidebar content" "footer footer" }
```

The phone block at `:2462` redeclares `grid-template-areas` with **four** rows — header /
`sidebar tools` / content / footer — and does **not** redeclare `grid-template-rows`. So the
three-row template lands on the wrong rows: row 2, which on a phone is the 61px navigation
strip, inherits `minmax(0, 1fr)` and swallows every spare pixel, and the content row becomes
`auto`.

Measured on `/tags/` at 390×844, computed off the live element:

```
rows            49px  526px  205px  64px
                      ^^^^^ the nav strip is 61px tall inside a 526px row
<h1> top        587   of an 844px screen
```

The picture is `docs/media/look-phone/390-dark-tags.png`: the brand, then **half a metre of
black with three nav words floating in the middle of it**, then the heading, just above the
fold. `/tags/` is the screen `CORE-FLOW.md` §4 step 5 sends the director to.

**This is not an empty-screen edge case. It is every navigation.** With 2.5 s of latency
emulated — a stairwell — `/payroll/` mid-load measures `49px 427.5px 303.5px 64px` and its
heading sits at y=489. The 500 state does the same, and that is the moment the words on the
screen matter most (`b-500-payroll.png`).

**Shown red, then green, without touching the repo.** One rule injected into the live page:

```css
@media (max-width: 767px) { .app-shell { grid-template-rows: auto auto minmax(0,1fr) auto } }
```

```
/tags/  before   rows 49px 526px 205px 64px   h1 at y=587
/tags/  after    rows 49px  61px 670px 64px   h1 at y=122     465px recovered
```

`g-tags-before.png` / `g-tags-after.png`. The style element was removed afterwards; nothing
was committed.

`/account/` (708px of content) and `/operators/` (1246px) are **not** affected — their content
already exceeds the spare height, so the `1fr` row has nothing to take. That is why this has
survived: the two screens somebody would have checked are the two that look right.

---

## 2 · `/tags/` cannot be reached from anywhere. Nothing checks that it can.

`web/app/tags/page.tsx:27` says so itself: „Not in the sidebar. Reached by URL (`/tags/`)
until it earns a place in `lib/nav.ts`."

It is in neither `NAV_GROUPS` nor `OFF_NAV_ROUTES`, and `web/scripts/check.mjs:451` — „every
route that left the sidebar keeps a way in (decision-39)" — iterates `OFF_NAV_ROUTES`. A route
in neither list is never examined. **The check passes vacuously for this route**, which is the
fifth vacuous check found in this project.

Grepped the built export rather than the source, because the source is not what ships:

```
"/tags/"       → 0 hits in web/out/**/*.html and 0 in web/out/_next/static/chunks/*.js
"/operators/"  → web/out/_next/static/chunks/d63923a1229dfd97.js      (from /workers/)
```

`/operators/` left the sidebar and kept its way in, exactly as decision-39 intends. `/tags/`
never had one.

Cost: the office turning a written card into a building is step 5 of the phone script, done
standing up, holding a card. Today it is „type `schimmer-glanz.exe.xyz/tags/` into the browser
bar". The screen itself is correct and its empty state says the right thing
(„Keine unzugeordneten Tags.") — it simply cannot be opened.

---

## 3 · `/shifts/` shows three shifts that hold up payroll and lets you touch none of them

The triage block „ZU ENTSCHEIDEN" is the second thing on the screen and it is the right thing
to put there. Read out of the DOM:

```
section          found
a[href], button  []          ← zero
rows             Elif Demir · Läuft · Ordination Gumpendorf
                 Andrea Steiner · Nicht bestätigt · Wohnhausanlage Donaufeld
                 Andrea Steiner · Nicht bestätigt · Buerozentrum Handelskai
```

The outlined `Läuft` / `Nicht bestätigt` pills look like buttons at arm's length and are not.
To act on one of those three the director scrolls down into the ledger:

```
/shifts/ total height   33 493 px  =  39.7 phone screens
cards                   87, 358px each
first „Korrigieren"     y = 863   (below the fold)
filter controls         Mitarbeiter · Objekt · Zeitraum
                        no „needs attention" control, although ?state=unresolved works
                        and the Objektpanel already links with it
```

So the state exists in the URL grammar and has no control on the screen it filters.

**What is right here and must not be lost:** the summary tile („Halten die Abrechnung auf: 3"),
the truncation sentence with real numbers („264 weitere Schichten liegen außerhalb dieses
Zeitraums"), the Vienna-time note, and `Zählt nicht zur Bezahlung` in words. All present at
390 (`tiles/390-dark-shifts-t01.png`, `-t02.png`).

---

## 4 · The enrolment code strikes through its own expiry

`.code` (`globals.css:1406`) is an **inline** element carrying `padding: 12px`, `font-size:
1.5rem`, `line-height: 36px`. Padding on an inline box does not grow the line box, so the
border draws outside the line and lands on the neighbours.

```
.code           display inline · box 54px tall in a 36px line
overlap below   9px   into  <p> „Gültig bis 26.08.2026, 01:13. Danach einfach einen neuen…"
overlap above   7px   into  „Zugangscode für Ana Ilic:"
```

`p-code.png`, and the 2× crop in `j-04-enrolment-code.png`: the bottom border of the code frame
runs through the date at its x-height, reading as a strikethrough over the only sentence that
says whether the code still works. The code is read down a phone line to a cleaner; the expiry
is what stops that call happening twice.

Everything else on that panel is right and survives at 390: the standing note above the create
buttons, „Zugangscode für **Ana Ilic**:" naming the worker beside the code, the copy control at
44px, and the revoke sentence.

---

## 5 · A 500 says „it failed" and „it is loading" in the same breath

Every `/admin/*` response replaced with a 500, at 390:

| screen | live regions | retry |
|---|---|---|
| `/` | „Das hat gerade nicht funktioniert…" **and** „Wird geladen…" | „Aktualisieren" |
| `/payroll/` | „…nicht funktioniert…" **and** „Wird berechnet…" | **none** |
| `/shifts/` | „…nicht funktioniert…" **and** „Schichten werden geladen…" | **none** |

Both are permanently-mounted regions (the pattern REDESIGN-INVENTORY defends, correctly), so a
screen reader announces the failure and then announces that it is still working. The loading
text is never cleared on the error path. On the two screens where a director is most likely to
be on a bad connection, the only way out is a browser reload — and the reload lands on §1's
blank screen.

`b-500-home.png`, `b-500-payroll.png`, `b-500-shifts.png`.

A genuinely offline navigation gets Chrome's own `ERR_INTERNET_DISCONNECTED` page, which is
correct for a static export and is not a product finding.

---

## 6 · Two of nine destinations, and no „you are here"

The strip scrolls sideways and the page does not — that part is right, and `overflow-x: auto`
on `.sidebar` is doing exactly what its comment promises. What it costs:

```
360   2/9 visible  [Übersicht · Schichten]   511px behind the scroll
390   2/9 visible  [Übersicht · Schichten]   481px
414   2/9 visible  [Übersicht · Schichten]   457px

on /payroll/   aria-current="page" → „Lohn"    on screen: NO
on /account/   aria-current="page" → „Konto"   on screen: NO
```

`aria-current` is rendered, so a screen reader is told. A director looking at the screen is
not: the strip is never scrolled to the active entry, so on seven of nine screens the „you are
here" highlight is 300–500px off to the right. The clipped „Mate…" is the only hint that the
strip continues at all, and it is the accidental kind of affordance.

Weighed against the alternative the prototype proposed (`.side{display:none}` under 860px with
no replacement), the strip is the better decision. The gap is that it does not scroll itself
into position.

---

## 7 · The state pill is 11px

```css
.badge, .shift-state { font-size: 0.6875rem }   /* = 11px */
```

`DESIGN.md` §4's scale starts at `0.75rem`. This is the cell that says whether a shift is paid.
Contrast is fine — the repo's own `demo/audit-contrast.mjs` measures `--state-unres` on
`--bg-raised` at **4.92:1** and every state token passes — so this is a size finding and not a
colour one. In a stairwell, in daylight, 11px at weight 400 is the smallest thing on the screen
carrying the largest consequence.

---

## 8 · The card transform right-aligns prose

The row→card transform right-aligns values, which is correct for the money and hours it was
built for. It also catches sentences:

```
„Sanitaerreiniger fuer die
     Ordination, zwei
              Flaschen."     ← the worker's own words, /material-requests/
```

Same on `/locations/`: „Landstrasser Hauptstrasse 46, 1030 / Wien", and client names over two
lines. A ragged left edge on three lines of German is measurably slower to read than a ragged
right one. The verbatim `<q>` is preserved, which is the part that matters; the alignment is
polish.

---

## 9 · The client portal wraps three short columns

`/reinigung/#k=…` at 390 stays a real 3-column table rather than becoming cards, which is the
right call for three short values. But most of the 20 rows wrap anyway:

```
Mo.,          Nikola     3:40
17.08.2026               Std.
```

~250px of content in a 390px viewport, and both the date and the duration break. Row height
~78px for three words. No horizontal scroll, nothing lost, nothing wrong — it just looks like
a page that did not fit, on the one surface a paying customer sees.

---

## What is right — checked by looking, not by counting

**Card captions are correct, everywhere, read as pairs.** Every `data-label` was printed beside
the text of the cell it captions and beside the `<th>` it claims, for all 12 tables that have
rows, at 390. Nothing is captioned with a neighbour's heading. The leading `<th scope=row>`
correctly carries no `data-label` and becomes the card title.

> Vacuity: `/tags/` and `/account/` have no table rows, so the caption check over them proves
> nothing. `/tags/` is precisely where a caption bug would land next, since its table is the
> newest in the product.

**No horizontal page scroll at 360, 390 or 414 on any of the 14 screens.** The only elements
wider than the viewport are the nav strip's own `<ul>` and `<li>`, contained by
`overflow-x: auto` exactly as intended. An 88-character German compound
(`Wohnhausanlage Donaufeld Betriebsgebaeudereinigungsvertragsverwaltung Stiegenhausreinigung`)
pushed into a building name at 360: overflow still 0, wraps mid-compound, nothing clipped, and
the card below it unmoved (`b-longname-home-360.png`). The name was restored afterwards.

**Payroll survives whole at 390, in both branches, and both were made to appear.** The green
branch alone would have proved nothing, so the period was moved to one that actually has
exclusions:

```
thisMonth  RED    „2 Schichten müssen bestätigt werden…"            → Jetzt bestätigen
                  „1 Schicht … ist noch offen und hat keine Endzeit" → Jetzt abschließen
                  „1 Schicht … wurde von Hand erfasst…"              → Anzeigen, welche
                  „…ergeben genau die Summe des Servers…"            ← caveatReconcileOk
                  „Bekannte Einschränkung: … zum heutigen Satz…"     ← unconditional
                  per worker: „2 zu bestätigen" · „1 noch offen" · „Nichts"
lastMonth  GREEN  „Keine Schicht … ist offen oder wartet auf Bestätigung"
                  „…ergeben genau die Summe des Servers…"
                  „Bekannte Einschränkung: …"                        ← still there
```

The reconciliation line and the rate-history caveat are present in **both**, at 390, unclipped.
Named exclusions are named per worker, in words, not as a colour. `p-payroll-thisMonth.png`,
`p-payroll-lastMonth.png`.

**The Objektpanel is the best surface on the phone.** Opened from a home-screen card at 390:
`role="dialog"`, focus moved to „✕ Schließen", focus trapped (Tab from the last control returns
to the first), Escape closes it, `body { overflow: hidden }`. Ten outbound links, **every one
44px tall and every one carrying the building id and a period**:

```
/shifts/?location=1d3b752d…&period=thisMonth
/shifts/?location=1d3b752d…&period=all&state=unresolved     „1 Schicht bestätigen"
/payroll/?location=1d3b752d…&period=lastMonth
/pl/?location=1d3b752d…&period=lastMonth
/contracts/?location=1d3b752d…      /analytics/?location=1d3b752d…
/material-requests/?location=1d3b752d…&status=open
/locations/?zones=1d3b752d…         /locations/?open=1d3b752d…     /clients/?client=3
```

JOURNEYS §6 listed nine places where the thread snapped because no screen passed a filter.
On a phone, this panel closes them. It is also the answer to §2 and §3 above: the missing
route into `/tags/` and the missing action on the triage rows are exactly the shape this panel
already got right.

**Greyscale.** The 390 dark shots were re-rendered through `grayscale(1)`. `/shifts/` triage is
fully readable desaturated: the word („Läuft", „Nicht bestätigt") is the first signal, the 3px
left rule survives as two distinguishable greys, the pill outline is the third.
`tiles/390-dark-shifts-grey-t02.png`.

**Touch targets.** Nothing interactive under 44px except two classified shapes: `a.brand` at
174×24 (WCAG 2.5.8's 24×24, accepted), and four cross-links that are genuinely inside a
sentence — checked by reading their parent block, e.g. „…zählt in der Gewinn- und
Verlustrechnung als null. **Gewinn & Verlust öffnen**". None of them is the only route to its
target; the Objektpanel provides a 44px one to each.

**The client portal gives away nothing.** `/reinigung/#k=…` at 390/360/414:

```
one building        Aerztezentrum Landstrasse, and no other appears anywhere
20 rows             {Datum, FIRST NAME, Dauer}
                    Elif · Nikola · Selim · Marta · Ana · Andrea
absent              surname, e-mail, hourly rate, amount, any other building,
                    any id, any admin chrome, a.brand, a desktop guard
lang                de-AT, pinned
title               „Aerztezentrum Landstrasse – Reinigungsnachweis", set client-side
h-scroll            0
```

Unknown token and **no** token both produce one identical message — „Dieser Link funktioniert
nicht. Bitte wenden Sie sich an Ihre Reinigungsfirma…" — with **no** retry button, so a
stranger probing links learns nothing about whether one ever existed.

**Other things that held.** The settings panel on a phone (Darstellung / Sprache / Abmelden,
all three 44px, overflowing neither edge). The correction drawer (full-screen `role="dialog"`,
Escape closes, body locked, `Beginn*` required and `Ende optional`). The building drawer's
„Schritt 1 von 2" with step-2 fields genuinely hidden rather than merely below the fold.
English: `/payroll/` renders translated `<th>` and `data-label` values with no raw message key
anywhere. The map is **collapsed by default on a phone** with a sentence saying so and the list
below carrying every building — so TASK-206's `RefererNotAllowedMapError` flake does not reach
the phone director unless he opens it.

---

## Checks that currently cannot fail

Recorded because a check that cannot go red is a comment.

1. **The hover-only sweep matched nothing.** One rule in the whole stylesheet reveals on hover
   — `.nav-link-locked:hover .nav-tooltip { opacity: 1 }` — and it also fires on
   `:focus-visible`, so it is not hover-only. `FUTURE_NAV` is empty, so no `.nav-link-locked`
   element exists on any screen. „No affordance is hover-only" is true and unproven.
2. **The caption check over `/tags/` and `/account/`** runs over zero rows (§ above).
3. **`pnpm check`'s route-reachability check does not include `/tags/`** (§2).

---

## What did NOT happen

- **Nothing was fixed.** No file under `web/`, `server/`, `android/`, `ops/` or `sql/` was
  changed. The §1 CSS rule was injected into a live browser and removed in the same run.
- **Production was not touched.** No SSH, no query, no deploy. Everything above is
  `127.0.0.1:8080` against `nfc_demo`.
- **`NFCTimeSheets/` and `project.pbxproj` were not opened.** iOS is out of scope.
- **The Android app was not looked at.** This run is the admin and the portal only.
- Two local `nfc_demo` mutations were made and undone: enrolment codes cleared so the code
  panel could be seen fresh, and one building renamed to an 88-character compound. Both
  reverted; `SELECT count(*) … LIKE '%Betriebsgebaeude%'` returns 0.
- **A portal grant was minted and left live** in `nfc_demo` for
  `Lena Hofbauer → Aerztezentrum Landstrasse`. Local demo data, re-created by
  `demo/seed.sql`.
- **No backlog task was created.** Ranking above is the input to that step.
- **No screenshot was committed.** `docs/media/look/` and `docs/media/look-phone/` were added
  to `.gitignore` before the first PNG was written.
