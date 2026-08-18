# IA round — the visual verification

Independent visual pass over `37081ea` + `a4a5b17` (the query-parameter object surface and the
map landing surface). Everything below was driven in a browser by this pass, not read off the
build reports. Where a build report's number is reproduced, it says so; where it is contradicted,
it says that too.

**Instruments** (all new here, all in `demo/`): `verify-ia-visual.mjs`, `probe-ghost-overflow.mjs`,
`probe-infobox.mjs`. Re-run of the builders' own `shoot-ia.mjs`, `measure-ia-weight.mjs`,
`check-ia-greyscale.mjs`, `audit-map-contrast.mjs`.

**Evidence**: `docs/media/ia/` — 152 screenshots, 152 greyscaled, 14 domain-state crops,
66 baseline shots in `before/`. Every screen at 1680 and 390, dark and light.

---

## Verdict

The structural claim is TRUE and I could reproduce it: 12 → 9 nav destinations, measured from
the sidebar's own hrefs on both origins in one browser. Filters are carried on links. The
degraded map states are real, seeded, and genuinely good — better than the plan asked for.

Two defects found that the build reports do not contain, both on the map landing surface, both
reproducible from a clean seed:

| # | What | Severity |
|---|---|---|
| **V1** | Desktop pin info box: **0 of 8 cross-links visible**, no expand affordance | high |
| **V2** | `/?location=<unknown-uuid>` at 390px scrolls sideways; the ✕ is off-screen | medium |

Plus one omission: the tree contains an **uncommitted** `demo/audit-map-contrast.mjs` that is
**red with 18 failures**. Two of those are real (§6).

---

## 1 · V1 — the desktop info box hides every cross-link

This is the important one. decision-38 exists so that *every cross-link carries its filter*, and
IA-PLAN §9 records the owner's answer: info boxes on the pin carry the numbers **and** the
cross-links, **expandable**. On desktop, at rest, the director can see none of them.

Measured (`demo/probe-infobox.mjs`, 1680×1000, real building):

```
.map-info        384 × 302   top=460  bottom=762
.map-info-body   scrollHeight=671  clientHeight=236   overflow-y: auto
expander         null
links            0 of 8 fully visible · 0 sliced · 8 below the box
```

All eight sit at y = 776 … 1140 — every one of them *below* a box that ends at 762:

```
/shifts/?location=…&period=thisMonth        /contracts/?location=…
/payroll/?location=…&period=lastMonth       /analytics/?location=…
/pl/?location=…&period=lastMonth            /material-requests/?location=…&status=open
/locations/?open=…                          /clients/?client=2
```

**65% of the box's content is below its fold, and it is the 65% that contains all the actions.**
The picture shows the cut landing mid-glyph, so the box's bottom edge reads as a rendering fault
rather than as "there is more": `docs/media/ia/home-panel-1680-dark-overlay.png`.

**The builders' check is not wrong, it measures the wrong property.** `check-map-home.mjs`
asserts the links are *reachable* — it dispatches a real wheel event (deliberately, over
`scrollIntoView`, with the reasoning written down) and confirms `scrollTop > 0` moves links into
view. That assertion is true and it stays true. Reachable ≠ discoverable, and the owner's word
was *expandable*.

⚠ One honest caveat on the screenshots: `demo/cdp.mjs` launches Chrome with `--hide-scrollbars`,
so the absence of a scrollbar in the image is partly an artefact. It is not wholly one — macOS
overlay scrollbars are invisible at rest anyway — and it does not touch the measured facts:
`expander: null`, `0/8` visible.

**The phone is fine.** At 390px there is no `.map-info` at all; the bottom sheet renders all
eight links at 44px each. `home-panel-390-dark-overlay.png`. The defect is desktop-only — the
director's actual working surface.

---

## 2 · V2 — the unknown-object chip pushes the page sideways at 390px

Reproduced on a freshly seeded database, both themes, in my own re-shoot:

```
/?location=00000000-0000-4000-8000-000000000000   390px
scrollWidth 443 > vw 390        (plain /  →  390, clean)
```

The builders' culprit list names the sidebar. **The sidebar is innocent** — it reaches
`right=696` on the plain home screen too, where the document still measures exactly 390, so
something clips it and that clip holds. The real culprit, isolated in `demo/probe-ghost-overflow.mjs`
by asking which elements land in the 391–560 band instead of sorting by worst-overflow:

```
span.filter-chip-text   left=25  right=395  w=370  white-space: nowrap
  „Objekt: unbekannt – dieses Objekt ist hier nicht vorhanden"
button.filter-chip-remove ✕  right=426
```

The longest chip string in the product, set `nowrap`, starting 25px in. Visible in
`home-panel-ghost-390-dark-top.png`: „vorhanden" is sliced by the viewport edge and **the ✕
remove control is entirely off-screen** — at the width decision-28 makes mandatory, and on the
one state whose entire purpose is to be escapable.

The prose underneath is excellent and should survive any fix:

> Ein Filter aus der Adresse verweist auf einen Datensatz, den es hier nicht gibt. Deshalb ist
> diese Ansicht leer – es fehlen keine Daten. Filter entfernen, um wieder alles zu sehen.

…but it points at a control the reader cannot see. Fix is `white-space` on `.filter-chip-text`,
not a shorter sentence: the sentence is the good part.

---

## 3 · Weight — LIGHTER / SAME / HEAVIER

Same tape measure as last round (`demo/weight-probe.mjs`, one definition, imported by both
callers), both origins in one browser, `fe68c7f` in a git worktree at `/tmp/ts-before` served on
:8083. No stash. My numbers reproduce the builders' exactly.

| screen | 1680 | 390 | verdict |
|---|---|---|---|
| **home** | 1340 → 2611 **+95%** | 2908 → 4862 **+67%** | **HEAVIER** |
| analytics | 1655 → 1482 −10.5% | 3536 → 3342 −5.5% | **LIGHTER** (boxes 4→3) |
| workers | 1135 → 1135 | 3288 → 3420 +4% | SAME / marginally heavier |
| shifts · material-requests · locations · clients · contracts · inventory · payroll · pl · account | 0% | 0% | **SAME** |

### Did the home screen get heavier, and is it justified?

Yes, materially. Justified in the part that was complained about; not entirely justified in the
part nobody measured.

**What did not get worse — and this is the metric the complaint was phrased in.** `read` (words
of prose above the first datum) is **5 → 5**. The first datum is still the answer band at
**y=179**, directly under the h1. You do not read more before you get an answer. Every added
pixel is *below* the first answer.

**The map is not most of the growth.** On production today — one building, `lat NULL` — the map
draws nothing and the region collapses:

```
home, map drawn         2611px
home, no coordinates    2075px     ← production, day one
home, key rejected      2117px
home, no active object  1765px
before                  1340px
```

So the Objektliste is ~735px of the growth and the tiles ~536px. The list is new *answers* —
six buildings × occupancy, last cleaned, what to check — that previously cost two screen visits.
That trade is good.

**⚠ Where it is not justified.** At 1680×1000 the OBJEKTE heading sits at ~964px: on a
1000px-tall desktop viewport the director sees the band and the map, and **not one row of the
list**. The build report calls the list "primary" and the map "a region above it" — the layout
says the opposite. The optional thing holds the fold; the always-rendered thing is below it.
Directly visible in `home-1680-dark-top.png`, which *is* a 1000px viewport.

On production day one this inverts and is fine (no map → list at top). It is worst exactly when
the map is working, i.e. after onboarding succeeds.

`workers` +4% at 390 only (+132px) — marginal, one filter chip's worth. Not worth an action.

---

## 4 · Greyscale — the five domain states and the pins

Every screenshot greyscaled with `ffmpeg -vf format=gray` → `docs/media/ia/grey/` (152).
Focused crops of the states that do not exist at rest → `docs/media/ia/states/` (7 + 7 grey).

`demo/check-ia-greyscale.mjs` PASSES, 22 assertions. All five domain states survive desaturation
**as words**, which is the point — colour is never doing the work:

| state | the word that carries it, in grey |
|---|---|
| running | `Läuft` + `Zählt nicht zur Bezahlung` |
| auto-closed unresolved | `Nicht bestätigt` + `vom 8-Stunden-Timer beendet, 17.08.2026, 06:00` |
| corrected | `Korrigiert` + `Zählt zur Bezahlung` |
| inactive | `Inaktiv – keine Anmeldung möglich` |
| excluded from payroll | `Kein Stundensatz` / `Nicht bewertet` — and never `0,00 €` |

Verified in the picture, not only in the assertion: `states/state-unresolved-grey.png` shows five
distinct badge words plus an italic `Am Tag gescannt` (italic is a second non-colour signal), and
`states/state-excluded-grey.png` shows all five payroll caveats intact with the rate-less worker
named in the table. **Nothing true was deleted to make a screen lighter.**

Pins, in grey: `● 1 vor Ort ▲ prüfen` vs `○ 0 vor Ort` — filled/hollow glyph *and* the count
*and* the word. Readable in `grey/home-1680-dark-top.png`.

### Proved the check can go red

A check whose negative case cannot fail is not a check. I broke both and reverted both.

```
de.json  pinOnSite „vor Ort" → „aktiv", objectsNobody → „leer"
  → FAIL every pin states its occupancy as a WORD, not only as a dot
  → FAIL the Objektliste says occupancy in words on every row      exit 1
```

---

## 5 · Card captions below the breakpoint — by TEXT

`ResponsiveTableLabels` copies `thead th` text onto each cell as `data-label`. The probe compares
**caption text against that column's header text**, never counts. **0 mismatches** across all
screens, all four configurations.

Confirmed by eye at 390px (`shifts-390-dark.png`, cropped): `OBJEKT` → the building link,
`BEGINN` → 17.08.2026, 14:00, `ENDE` → 16:15, `DAUER (STD:MIN)` → 2:15, `STATUS` → the badge,
`ART DER ERFASSUNG` → Am Tag gescannt. The worker name is the card title, correctly unlabelled.

**Proved red**, since this is the exact bug that once shipped green:

```
ResponsiveTableLabels.tsx   headings[i] → headings[i + 1]
  → FAIL shifts   cell[1] label="Beginn" header="Objekt" | cell[2] label="Ende" header="Beginn" …
  → FAIL workers  cell[1] label="Telefon (nur zum Anrufen)" header="E-Mail-Adresse (App-Anmeldung)" …
```

Both sabotages reverted; `git status web/` clean; clean rebuild verified.

---

## 6 · The uncommitted map contrast audit is red

`demo/audit-map-contrast.mjs` exists in the working tree, is **not tracked by git**, and exits 1
with **18 failures across 60 measurements**. Neither build report mentions it. Triaged:

**Two are real and worth fixing** — one token, light theme only:

```
light  .map-pin-flag „prüfen" — a WORD, so body tier   4.34:1  need 4.5:1   (dark: 8.18:1 ok)
light  .map-info unresolved state word                 4.34:1  need 4.5:1   (dark: 8.95:1 ok)
```

`--state-unres` on `--bg-overlay`/`--bg-raised` misses body-text contrast in light theme. It is
the single most important signal on the map — the building that needs attention — and it is
marginal, not catastrophic. Dark theme passes comfortably.

**Six are the audit being strict about a mitigated property.** `.map-pin-label chip fill vs the
tile — 1:1` and `.map-info fill vs the tile — 1:1` fail, but the very next assertion measures the
mitigation and passes: the 1px border is 3.33:1 / 3.35:1 against the same tile. A bordered chip
does not need fill contrast. Not defects.

**`.map-pin-flag.is-notag` hatching 1.26:1** — nearly invisible, but the flag also carries the
word „kein Tag" at 4.93:1. Third signal, not load-bearing.

**The rest are Google's tile geometry under the muted style the owner asked for**: roads vs
ground 1.12:1, the Danube 1.06:1, district boundaries 1.37:1, street names 3.4–3.9:1. This is a
consequence of "muted map in the dark palette" and it is visible in the screenshots — the dark
map is close to featureless. Defensible: the map is context and the pins are the data. Worth an
explicit decision rather than an audit that stays red.

---

## 7 · What I looked at that the assertions do not cover

- **The degraded states are the best part of this round.** `home-map-nopins-1680-dark-top.png` —
  production's day-one state — collapses the map region entirely, promotes the Objektliste to the
  top, and gives every row `Koordinaten holen`. No dead grey rectangle. `home-map-blocked` says
  „Der Kartenschlüssel wird für diese Adresse abgelehnt, oder das Kontingent ist aufgebraucht.
  Welches von beidem, lässt sich hier nicht unterscheiden" — it refuses to invent a distinction
  the browser cannot make. That is the right call and it is rare.
- **`no_key` leaks a machine token to the director.** In the no-coordinates state five rows read
  „Keine Koordinaten · no_key" while the sixth reads „Keine Koordinaten · noch nie abgefragt".
  One of these is German and one is a database enum. Visible in `home-map-nopins-1680-dark-top.png`.
  Small, cheap, and the inconsistency makes it obvious.
- **Pin labels collide with each other and with Google's own place names** at the default zoom
  (`home-1680-dark-top.png`: the Aerztezentrum chip sits on top of the „Wien" label). The spec
  anticipated crowding beyond ~60 buildings; it is already visible at five. Not a defect at this
  data volume, but it will not scale the way §2.4 assumes.
- **The phone header is heavy before any content**: brand, then a Darstellung/Sprache row, then
  Abmelden, then a horizontally scrolling nav strip that cuts „Objekte" to „Obj" with no fade or
  arrow to say it scrolls. ~230px of chrome above „Übersicht" at 390px. Pre-existing, not this
  round's, but it is the first thing you see on a phone.
- **Light theme pins are weaker than dark**: white chips on a near-white map, delimited only by a
  faint border, and the hollow `○` is very light. Consistent with the 4.34:1 finding above.

---

## 8 · Reproduced, contradicted, and left alone

**Reproduced.** Nav 12 → 9, from the live sidebar on both origins. Every weight number.
Caption parity. Greyscale PASS. `home-panel-ghost` overflow (independently, on a fresh seed).

**Contradicted.** `shoot-ia.mjs` recorded `read: 0, firstDatumY: 0` for the home screen while
`measure-ia-weight.mjs` recorded `read: 5` — same commit, same imported ruler. I drove it and
dumped every candidate the walker considers: the first datum is `div.answer`, 1363×115, at
**y=179**, with „Muss ich gerade etwas tun?" above it. `read = 5` is correct; the `0` was a
transient and did not recur in my re-shoot (`read=5`, `px=2611`, identical). No action beyond
knowing that the shoot's inline weight reading on map screens has flaked once and the
`measure-ia-weight` figure is the one to quote.

**A harness hazard, not a product defect.** I found the demo database with all six locations
`active=false, lat NULL, geocode_status='no_key'` — the degraded-state seeding of a map check
having failed to tear down. It did **not** contaminate the shipped screenshots: row counts hold
at 17/6 across all four configurations in both runs, so the shoot ran on good data and something
after it left the mess. Reseeded (`demo/seed.sql`, 6 active / 5 pinned) before every measurement
above. Worth a guard that refuses to start when the seed looks degraded.

**Left alone, deliberately.** `android/`, `NFCTimeSheets/`, `project.pbxproj` untouched. No
dependency added — everything here is `demo/cdp.mjs`, Node and ffmpeg. Street View: zero code,
zero requests, confirmed. Zones, `GET /admin/overview`, the backfill against production
(TASK-170) are out of scope and remain open. `check-reports` and
`check-materials-account-login` are still red on the closed-`<details>` family — pre-existing,
reproduced, not this round's and not touched.

---

## 9 · Recommended, in order

1. **V1** — give the desktop info box a real affordance. Cheapest honest fix: render the
   cross-links *outside* the scrolling body, or make the box a `<details>` that opens upward
   with the count in the summary („8 Verknüpfungen"). Low effort, high value — without it,
   decision-38's whole point is invisible on the landing surface.
2. **V2** — allow `.filter-chip-text` to wrap (or truncate with the full text in `title` + the
   existing `visually-hidden` label). Low effort. Keep the sentence.
3. **§6** — lift `--state-unres` in light theme to ≥4.5:1, then commit `audit-map-contrast.mjs`
   green, with the tile-geometry rows either accepted in a decision or dropped from the gate.
   Low effort.
4. **§3** — decide whether the map or the Objektliste holds the desktop fold. This is a design
   call, not a bug; it only needs an answer because the build report and the layout disagree.
5. **§7** — replace `no_key` with the German phrasing the sibling row already uses. Trivial.
