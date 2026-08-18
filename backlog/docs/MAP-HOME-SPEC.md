# MAP-HOME-SPEC — the map is the home screen

Status: specification for TASK-155. Design only. No application code was written.
Written after `backlog/docs/JOURNEYS.md`; §8 of that document (frequency × pain) is the test
every decision below is measured against.

Sources read, not inferred: `.poc-map/dashboard-map.html` + `README.md`, `web/app/page.tsx`,
`web/app/analytics/page.tsx`, `web/lib/map.ts`, `web/lib/api.ts`, `server/lib/geocode.js`,
`server/lib/reporting.js`, `server/db/migrations/001…005`, `backlog/docs/REDESIGN-INVENTORY.md`
§1 + §11, `backlog/docs/REDESIGN-REVIEW.md`, `docs/brand/DESIGN.md`, `docs/brand/prototype.html`,
`backlog/decisions/*` — **including `decision-37` (zones), which landed from a parallel
workflow while this was being written. §4 below was rewritten to match it.**

Two owner decisions are settled input, not open questions:

1. **the map replaces today's exceptions dashboard as the landing surface**
2. **zones are real** — a building holds several cleanable areas, each able to carry its own tag

---

## 0 · The headline, before anything else

```
buildings with coordinates in production today:   0
the one live building (HOIV Arsenalstraße 11) was created before the geocoding key existed
  → locations.lat IS NULL, geocode_state = 'never_attempted'
∴ on the day this ships, the map draws ZERO pins
```

So the list is not the fallback. **The list is day one**, and the map is the part that arrives
when someone presses „Koordinaten holen". Any design in which the list is a degraded state
ships an empty screen to the only building this company currently cleans.

Everything below follows from that: `Objektliste` is always rendered, on every path, and the
map is a region above it that may or may not appear.

---

## 1 · What the PoC proves, and what is new

`.poc-map/` is 5 files, invented data, a seeded PRNG and a frozen clock. It is a shape proof.

| Thing | PoC status | Verdict for the product |
| --- | --- | --- |
| labelled pin carrying name + live on-site count | **proven**, screenshot `shots/01-map.png` | port as-is |
| dark map style, POI + `labels.icon` off | **proven** | port. The icon kill is load-bearing: Google's motorway shields are blue and blue is the one accent (DESIGN.md §3.3) |
| pin → side panel, five numbers | **proven** | port the shape; **change which five** (§3) |
| panel returns focus to its opener, Esc closes | **proven** | port |
| zone list rows with per-zone last tap | **proven visually** | **new data**, and the shape is now fixed by decision-37: a zone row *is* the tag record, there is no `tags` table, and „last tap" is derived (§4). The PoC's per-zone **durations** are not portable — a shift is building-level |
| cross-links out of the panel | **shape only** — every link is a toast | **the real work is on the TARGET screens** (§3.3). `/shifts/` reads exactly one parameter today |
| Street View thumbnail, metadata checked before the image | **proven** | **change the source**: read the stored `locations.street_view_status`, never call metadata from the browser (§8) |
| „Keine Straßenansicht (REQUEST_DENIED)" text fallback | **proven** | port. It is also the only state today — the Street View Static API is not enabled on the project |
| 100vh layout, map fills the viewport | built that way | **rejected** (§6): it hides the triage list, which is journey D4 |
| „Stunden diese Woche" band cell | built | **rejected.** `web/app/page.tsx` states why: on a Monday morning it reads 0:00 and means nothing. The prototype's version of this cell was already refused once |
| „Objekte prüfen" 4th band cell | built | **not ported as a cell.** It restates `problemCount` in different units; two counts of the same thing that can disagree is the quiet lie a dashboard tells |
| overlapping pins (Simmering sits on Arsenalstraße in the shot) | **unsolved** | new (§2.4) |
| pins are keyboard-focusable | built | **changed** (§2.5) |
| degradation | 2 states (`gm_authFailure`, script `onerror`) | **new**: 9 states (§5) |
| the map is constructed once | n/a, no refetch | **new, and it is the cost bug** (§8) |

---

## 2 · The map at rest

### 2.1 What must be readable WITHOUT a click

Tested against the top of JOURNEYS §8. A number that is not on this list does not belong at rest.

| # | Fact | Journey | Where it lives at rest |
| --- | --- | --- | --- |
| 1 | how many things need me, and of what kind | D4 (6) | answer-band cell 1, `problemCount` + `todoParts`, unchanged |
| 2 | how many people are on site, and who | D4, D5 (3) | answer-band cell 2 + **every pin label** |
| 3 | **which building** each of them is in | D5, D14 | the pin. This is the entire argument for the map: today the answer is a list of names with no geography |
| 4 | which buildings need looking at, **named** | D4, D8 | the `▲ prüfen` chip on the pin **and** the reason in the list row |
| 5 | which buildings have no coordinates | D1 (5), S2 | the list, in words, with a retry control |
| 6 | as-of stamp: these elapsed times are frozen | D4 | `home.asOf`, unchanged. **Not a ticking clock** — per-second live-region churn is a screen-reader DoS |
| 7 | the payload was truncated | D7 | `home.truncatedNote`, unchanged |

Everything else is **one action away**, never zero: the triage rows, the on-site table, the
recent-activity list, and the panel.

### 2.2 Extent, centre, zoom

- fit to the bounds of all **pinned active** buildings, padding 48px.
- exactly one pinned building → `setCenter` + `setZoom(16)`. `fitBounds` on one point zooms to
  maximum and lands the director on a rooftop with no street around it. `/analytics/` already
  does this; carry the same guard.
- zero pinned → the map region is not rendered at all (§5, `noPins`). No empty grey frame.
- inactive buildings are **not** pins. They appear in the list, muted, per the soft-deactivation
  rule (nothing is destroyed, nothing is deleted).

### 2.3 Pin anatomy and states

The pin is a label, not a dot. Reading order inside it is fixed:

```
[glyph] Kurzname   [n] vor Ort   │ ▲ prüfen
   │       │          │              └── attention chip, only when there is something
   │       │          └── occupancy, the WORD carries it, the number is emphasis
   │       └── locations.name, shortened at the first comma / „ Straße"
   └── ● occupied · ○ empty · ▢ no tag configured
```

**Occupancy and attention are independent.** A building can be fully staffed and still need
looking at. Modelling them as one traffic light makes the pin and the answer band disagree.

| State | Glyph | Word (first signal) | Weight / shape | Colour (second signal) | Trigger | Greyscale test |
| --- | --- | --- | --- | --- | --- | --- |
| **on site now** | `●` | `{n} vor Ort` | count in 700, label 400 | left rule 3px accent blue | ≥1 open shift at any zone | bold number + filled glyph |
| **nobody there** | `○` | `0 vor Ort` | all 400, muted | left rule 3px `--text-muted` | no open shift | hollow glyph, no bold |
| **unresolved shift** | + `▲` chip | `prüfen` + reason in the list (`2 nicht bestätigt`) | chip in 600, own divider rule | amber `oklch(.78 .14 75)` | `auto_closed AND corrected_at IS NULL`, any zone, **no period filter** | the chip is a separate boxed element with a word in it |
| **no tag configured** | `▢` | `kein Tag` | muted, chip in 600 | `--text-muted`, hatched left rule | ≥1 active zone with neither `tag_serial` nor `tag_deployed_at` (decision-37). **Today's proxy, and it stays the proxy for every zone-less building**: an active building appearing in no loaded shift (`home.rowDeadTag`) | hatch + word |
| **no coordinates** | — | — | — | — | `lat IS NULL` | **not a pin at all.** List row only, `geocode_state` in words + „Koordinaten holen" |

Rules that make the table true rather than decorative:

- **colour is the second signal, always** (DESIGN.md §3.4). The test is the shipped one:
  desaturate the screenshot; if the state is unreadable, the design is wrong.
- a pin may carry **at most two** chips. Three states at once (`● 2 vor Ort ▲ prüfen ▢ kein Tag`)
  overflows the map; the third is dropped from the pin and stated in the list row. Priority:
  `prüfen` > `kein Tag`.
- the pin's accessible summary lives on its list row, not on the pin (§2.5).
- **no animation.** The live-shift pulse is the one animation with a job (DESIGN.md §6) and it
  is not on the pin: five pulsing labels over a moving map is noise, and `prefers-reduced-motion`
  would have to remove the only signal.

### 2.4 Overlap — unsolved in the PoC, decided here

Two buildings 800 m apart at zoom 11 collide; the PoC screenshot shows it. No clustering library
(that is a dependency, and the budget is zero).

- draw order: **ascending latitude**, so a southern label never covers a northern anchor.
- the selected pin is raised to the top of `floatPane`.
- above `PIN_LABEL_MAX = 30` active pinned buildings the label degrades to `glyph + count` and
  the name comes back on hover / on selection. Ceiling stated: beyond ~60 buildings the map is
  a heat blur and the list is the product. Upgrade path is a grid-based collision pass or the
  `markerclusterer` script tag, argued in a decision record if it is ever needed.
- **the list below is the guaranteed answer.** A pin hidden under another pin is a cosmetic
  failure, not a lost fact.

### 2.5 Keyboard and screen reader — a deliberate, stated ceiling

`ponytail:` the pin layer is `aria-hidden="true"`, pins are `tabindex="-1"`, mouse and touch
only. The `Objektliste` immediately below carries the same buildings, the same numbers, the same
states in words, and the same action (open the panel), and it is the only set of tab stops.

Why, rather than a roving tabindex over pins: pins are ordered by geography, so tab order is
arbitrary; and a screen reader that reads „Arsenalstraße, 1 vor Ort" from a pin and again from a
list row is announcing the portfolio twice. This is exactly the invariant `/analytics/` already
states as `noteMapEquivalent` — *the table is primary, the map is optional* — and inheriting it
is what makes the map cheap.

Ceiling: a keyboard user cannot select a pin *on the map*. Upgrade path: roving tabindex over
pins sorted north→south, with the list kept as-is. Do not build it until someone asks.

Selecting a list row pans + selects the matching pin, so the two surfaces never disagree about
what is open.

---

## 3 · The side panel

Opens from a pin click or a list row. `aria-labelledby` the building name. Desktop:
non-modal right panel, 408px, `translateX` 200ms. Phone: bottom sheet, modal (§7).
Esc closes and returns focus to the opener. Clicking the map closes it.

### 3.1 The five numbers

Chosen by JOURNEYS §8 rank, which is why this set differs from the PoC's.

| # | Cell | Content | Serves | Refusals it must honour |
| --- | --- | --- | --- | --- |
| **N1** | **Gerade vor Ort** (wide) | `{n}` + names + `seit HH:MM` per person + zone | D4 (6), D5 (3) | frozen at load, `home.asOf` applies to the panel too. ≥8 h shows `overdueFlag` as a **word** |
| **N2** | **Offene Punkte hier** | `{u} nicht bestätigt · {o} offen · {m} Material` | D5 (3), W7+W8 (4), D9 (9) | **no period filter.** An unresolved shift from March is an open point today. Zero states each part in words, never a dash |
| **N3** | **Zuletzt gereinigt** | relative age + worker + zone + duration | D4, D2 (10) | „noch nie" is a real answer and is not an error. A truncated payload must never read as „never cleaned" — this number comes from SQL, not from the capped shift list |
| **N4** | **Stunden diesen Monat / Monatsziel** | `23,3 / 40,0 Std.` + bar + „Soll bis heute (anteilig) 26,7" | D8 (14), D7 (7) | `target_minutes IS NULL` → `Kein Monatsziel vereinbart`, **not 0 %**. The variance flag is **suppressed before day 10** of the month and while the building has no shift in the period: on the 3rd every building is 90 % „behind" and that is a property of the calendar. „Nicht beurteilbar" is not a pass (`/pl/` `assessNoBaseline`) |
| **N5** | **Vertrag / Marge letzter Monat** | `456,00 € / Monat` + client name; below it `Marge Okt. 31 %` | D8 (14), D12 | **never a confident zero.** Unknown revenue → `revenueUnknown`, never `0,00 €` — a zero reports a paying client as a total loss. Margin from server SQL only; browser arithmetic over a capped payload under-reports. Carries the `rate_basis: current` caveat (decision-28, proposed): past hours are valued at today's rate |

Delta from the PoC, stated plainly: the PoC has no **N2**. Its panel therefore cannot start D5,
the third-ranked journey in the product, and its fifth cell (margin) is rank 14. N2 is the cell
that turns the map from a report into a work surface.

### 3.2 The zone block

Below the five numbers, one row per zone (PoC shape, real data required):

```
▲ Eingang        Vesna G. · 17.11. auto-beendet, nicht bestätigt      vor 4 Std.
● Stiege 2       Marta N. · läuft seit 13:20                          seit 38 min
○ Tiefgarage     Tomasz L. · 20.11.                                   vor 6 Std.
▢ Büro 2. OG     kein Tag hinterlegt                                  —
```

The unresolved shift is usually **not** the most recent shift on that zone. Carry it explicitly
or the row captions the wrong worker and the wrong date with „nicht bestätigt" — the PoC hit this
and its comment says so.

Per zone, additionally, one line of tag truth: `eigener Tag` / `fremder Tag übernommen` /
`kein Tag`, plus `zuletzt getappt {when}` and the zone's own `/t?l=<zone uuid>` with a copy
control. This is JOURNEYS §6's first orphan fact — *which walls have tags* — given a home.
Sources and the one thing this block must **not** print (per-zone hours or euros): §4.

### 3.3 Cross-links — every one carries state

This is the point of the whole exercise. The admin has **two** cross-links in fourteen screens
and neither passes a filter.

| # | Label | Target | Rendered when | Fixes |
| --- | --- | --- | --- | --- |
| 1 | Schichten dieses Objekts · November | `/shifts/?location=<uuid>&period=thisMonth` | always | §6 gap 3 |
| 2 | {u} Schichten bestätigen | `/shifts/?location=<uuid>&period=all&state=unresolved` | `u > 0` | §6 gap 9 — **`period=all` is mandatory**; unresolved shifts are frequently older than 30 days and that is what makes them unresolved |
| 3 | {n} offene Schicht schließen | `/shifts/?location=<uuid>&period=all&state=open&shift=<id>` | `o > 0` | D5 in one action, from a stairwell |
| 4 | Lohn · nur Mitarbeiter mit Stunden hier | `/payroll/?location=<uuid>&period=lastMonth` | always | §6 gap 1. **`lastMonth`, matching payroll's own default** — a link that lands in a different period than its source is the defect this exists to remove |
| 5 | Vertrag · {client} | `/contracts/?location=<uuid>` | always | §6 gaps 5, 7 |
| 6 | Ergebnis · Marge {x} % | `/pl/?location=<uuid>&period=lastMonth` | margin known | §6 gap 5 |
| 7 | {m} Materialanforderungen | `/material-requests/?location=<uuid>&status=open` | `m > 0` | §6 gap 8 |
| 8 | Objekt bearbeiten · Tag-URL | `/locations/?open=<uuid>` | always | §6 gap 7. The URI stays whole and copyable (decision-21: UUID, never the slug) |
| 9 | Kunde · Kundenlink | `/clients/?client=<client_id>` | `client_id` set | D10 |
| 10 | per person in N1/N3 → that person's shifts | `/shifts/?worker=<id>&period=all` | per row | §6 gaps 2, 4 — the closest thing to the `/workers/<id>` route that does not exist |

Three rules, and they are what make these links honest:

1. **a link is never rendered to an empty target.** `m = 0` → no material link; the N2 cell says
   `keine Materialanforderung` in words. A link that lands on „nichts gefunden" is the misreading
   this product has already produced once.
2. **the label states the filter before the click** („…dieses Objekts · November"), and
3. **the target screen echoes the filter as a removable chip** (`Objekt: Arsenalstraße ✕`).
   Without 3, a filtered screen is indistinguishable from a screen with no data — the exact
   failure `home.recentScope` was written to prevent. Every parameter a screen does not
   understand must be **ignored silently**, never 404, never an error.

**None of these parameters is read by any screen today.** `/shifts/` accepts `?period=` and
nothing else (`web/app/shifts/page.tsx`, read from `location`, not `useSearchParams`, so the
static export keeps working). The panel is cheap; the parameter contract is the work.

---

## 4 · Zones on the map

**Bound by `decision-37` (status: PROPOSED — the owner accepts decisions), full design in
`backlog/docs/ZONES-DESIGN.md`.** Everything in this section follows that record; where this
spec's first draft disagreed with it, the record won. Three of its rulings change the map:

```
no `tags` table          — a zone row IS the tag record; zones.tag_serial carries the
                           adopted-hardware exception; a tag we wrote has no row at all
zero backfill            — no default zone per building. Zones are OPT-IN per building and
                           a building with no zones behaves exactly as today
shift stays building-level — shifts.location_id NOT NULL; start_zone_id / end_zone_id are
                           nullable TAP FACTS, never a cost split
```

| Question | Answer | Why |
| --- | --- | --- |
| Does the panel list zones? | **Yes when the building has them**, one row each, §3.2 | it is where the orphan fact „which walls have tags" finally lives |
| Does a zone get its own pin? | **No. One pin per building, always.** | Zones share the building's single geocoded coordinate, so N zones would stack N pins on one point. Worse, a zone pin implies a zone is a unit of business — it is not: the contract, the target, the portal grant, the margin and the client relationship are all per building. Modelling zones as sibling `locations` rows corrupts every per-building aggregate at once |
| Ever an exception? | deferred, not rejected | A zone with its own street entrance (a separate Tiefgarage address) would need `zones.lat/lng` and a second geocode. Not now; note it in the zones decision record so it is a choice and not an oversight |
| What does the pin badge count? | **distinct workers with an open shift at that building, across all zones** | It is the director's question („wie viele Leute sind im Haus"), and one worker cannot hold two open shifts (`shifts_one_open_per_worker_idx`), so workers and open shifts cannot disagree. Counting *zones occupied* would read 4 when 4 people are in one stairwell |
| Where does „3 von 5 Zonen aktiv" go? | the panel, never the pin | two numbers on a pin is a riddle |
| Does the client portal gain zones? | **NO** | decision-37 §5. C2's payload stays `{date, first name, minutes}`; a zone name is internal building structure. Pinned by a check, not by a promise |
| „Welche Zone frisst die Stunden?" | **cannot be answered, and the panel must not imply it can** | decision-37's stated accepted loss: a shift is building-level, so there is **no per-zone duration and no per-zone money**. „Die Tiefgarage wurde seit 14. Mai nicht getappt" is answerable; „die Tiefgarage kostet 180 €/Monat" is not. Any zone row that prints hours or euros is a fabricated measurement |

**What the map reads from the zone model** (all derived, no new aggregate columns):

| Panel needs | Source under decision-37 |
| --- | --- |
| zone list | `zones WHERE location_id = ? AND active` — empty is the normal case |
| „läuft seit HH:MM, {worker}" per zone | the open shift whose `start_zone_id` is that zone |
| „zuletzt getappt {when}" per zone | `MAX(start_time/end_time)` over shifts naming that zone. **Derived** — decision-37 deliberately has no `last_tapped_at` column |
| tag state per zone | `tag_serial IS NOT NULL` → `fremder Tag übernommen` · `tag_deployed_at` set → `eigener Tag` · neither → `kein Tag` |
| the zone's tag URI | `/t?l=<zone uuid>` — the id space is shared, `l` now means „the id of the place that was tapped" (decision-37 §2). The location UUID stays valid for ever, so the one deployed tag needs no migration and no site visit |

**The sequencing warning belongs on this screen.** The APK in the field compares raw ids, so it
reads an intra-building zone tap as a *building switch* → `auto_closed = true` + a new shift, i.e.
a flood of unresolved, unpaid work. decision-37 orders it: migration → resolver → admin zone CRUD
→ **Play release** → every phone confirmed on that build → only then a second physical tag.
Until that is done, the panel's zone block must **state it in words** wherever a second tag could
be written („Zweiter Tag in diesem Objekt erst, wenn alle Telefone die neue App haben"), de/en
parity. A map that quietly hands out a second tag URI is the surface that causes the flood.

A building with **no** zones renders the block as one stated line — „Keine Zonen angelegt. Dieses
Objekt verhält sich wie bisher: ein Ort, ein Tag.

---

## 5 · Degradation — a first-class state, not an error message

Nine states. Each is a designed rendering, in German, in words, next to a list that already
carries every fact the map would have carried.

| # | State | Trigger | Map region | Message | Retry? |
| --- | --- | --- | --- | --- | --- |
| 1 | `noPins` **← production today** | every active building has `lat IS NULL` | **not rendered** | `{n} Objekte haben keine Koordinaten. Die Liste ist vollständig.` | per row: „Koordinaten holen" (the existing `geocodeLocation` write) |
| 2 | `noKey` | `NEXT_PUBLIC_GOOGLE_MAPS_KEY` empty **at build time** | **not rendered** | „Für diesen Build ist kein Kartenschlüssel hinterlegt." A deployment fact, not a fault | no. A retry cannot fix a build |
| 3 | `loading` | script in flight | reserved box, `hidden`, never a spinner over the list | nothing; the list is already usable | — |
| 4 | `network` | script `onerror` — offline, ad blocker, CSP, DNS | collapsed | „Die Karte konnte nicht geladen werden." | **yes**, and it really retries: `loadGoogleMaps` clears its cached rejection |
| 5 | `timeout` | 10 s, no `error` event (blocked script that never settles) | collapsed | „Die Karte antwortet nicht." | yes |
| 6 | `blocked` | `gm_authFailure` — referrer rejected, API not enabled, **or quota/billing** | **torn down**: remove the map, do not leave Google's grey box | „Der Kartenschlüssel wird für diese Adresse abgelehnt, oder das Kontingent ist aufgebraucht. Die Liste unten ist davon nicht betroffen." | no |
| 7 | one building unpinned | `lat IS NULL` on some rows | map draws the rest | list row states `geocode_state`: `nie versucht` / `fehlgeschlagen ({status})` | „Koordinaten holen" |
| 8 | data fetch failed | `/admin/overview` 5xx / offline | pins **frozen** to the last good snapshot | the existing `role="alert"` above, plus `home.asOf` on the map region: „Stand 09:14 Uhr, Aktualisieren fehlgeschlagen" | the refresh button |
| 9 | session lost | 401/403 | nothing | `router.replace('/login/')` — a dead session must never render an empty map that reads as „no buildings" | — |

Rules:

- **`blocked` is the dangerous one and the PoC only overlays it.** `gm_authFailure` fires *late*:
  the script loads, `google.maps` appears, `new Map()` succeeds, and what renders is a grey box
  under Google's own „This page can't load Google Maps correctly" alert. The region must be
  removed, not covered. `web/lib/map.ts` already exposes `onMapsAuthFailure` for exactly this.
- **quota exhaustion is not distinguishable from a rejected key in the browser.** Both arrive as
  `gm_authFailure`. Do not invent a distinction — name both possibilities in one sentence and
  point at where the truth is. Inventing `mapQuota` would be a screen guessing about billing.
- **the map never blocks first paint.** Answer band and list render from `/admin/overview`;
  the Maps script is loaded after, and its failure changes one region.
- **no state is a bare „Fehler".** Seven of the nine have different owners: add a key to the
  build, fix an address, tick a box in the Cloud console, wait, press refresh.
- offline: the panel is a client-side fetch app end to end (static export, decision-16). With no
  network there is no snapshot and the honest rendering is the existing error alert over the last
  loaded data with its as-of stamp. **No offline cache, no service worker** — a cached payroll
  figure presented as current is worse than no figure.

### 5.1 The fallback IS the layout

There is no separate „fallback view" to build and keep in sync. `Objektliste` is rendered on
every path; degradation only decides whether a map sits above it.

`Objektliste` — one row per building, a `.data-table` so it inherits the row→card transform on
phones for free (`components/ResponsiveTableLabels.tsx`), max **5 columns** so it cannot
reproduce review defect R1 (768–1439px horizontal scroll):

| Objekt | Vor Ort | Zuletzt gereinigt | Zu prüfen | (Öffnen) |
| --- | --- | --- | --- | --- |
| Arsenalstraße 11 | `● 1` Marta N. seit 13:20 | vor 4 Std. | `▲ 2 nicht bestätigt` | → |
| Donaufeld 101 | `○ 0` niemand vor Ort | vor 6 Std. | — | → |
| Meidling | `○ 0` niemand vor Ort | **keine Koordinaten · nie versucht** | `▢ kein Tag` | → |

Sort: attention first, then on-site, then name. Same order the map's pin priority uses.

---

## 6 · What happens to the exceptions dashboard

**Nothing is deleted and nothing moves to another screen.** The map is inserted; the ledger stays
under it, on the same route, in the same order, with the same strings.

```
/  Übersicht
 1  PageHeader + question           „Wo wird gerade gearbeitet, und wo muss ich eingreifen?"
 2  AnswerBand, TWO cells           Zu erledigen {problemCount} · Vor Ort {open}
 3  ─ NEW ─ map region (optional)   fixed height min(52vh, 560px), never 100vh
 4  ─ NEW ─ Objektliste             always rendered, the map's equivalent
 5  Zu erledigen                    AttentionList + moreToDo + clearNotes + truncatedNote
 6  Vor Ort                         table, oldest first, asOf, overdueFlag as a WORD
 7  Zuletzt erfasste Schichten (10) recentScope: „ohne Zeitraumfilter … keine Summe"
```

- **not 100vh.** A viewport-locked map hides blocks 5–7 on the landing screen, which loses D4 —
  the journey the map is supposed to serve — and would be the exact regression REDESIGN-REVIEW
  warns about. The map owns the top of the fold; the ledger is one scroll away.
- **the answer band stays at two cells.** No „Stunden diese Woche" (reads 0:00 on Monday), no
  „Stunden diesen Monat" (reads 0,00 € on the 3rd; already rejected once), no „Objekte prüfen"
  (a second count of `problemCount` that can drift out of step with it).
- block 6 gains one thing only: the building name becomes the panel opener, so „who is on site"
  and „where" are one click apart instead of two screens.
- rejected alternative: move blocks 5–7 to a new `/heute/`. It adds a 15th screen, makes D4 two
  clicks, and the complaint that started this work is that there are 14 screens and no flows.

Correctness properties of block 5–7 that a rewrite must carry, verbatim, because they were each
bought with an incident: `home.asOf` · `home.overdueFlag` as words · `home.recentScope` ·
`home.truncatedNote` with the literal limit · the **named** lists in the triage rows · the empty
state that reads „nichts zu tun" and never as a screen that failed to load.

---

## 7 · Phone, 390px (decision-28)

**On a phone the home screen is the list, and the map is one tap away.** That is the honest form
of „a map on a phone is mostly a list".

| Aspect | ≤767px |
| --- | --- |
| map region | **collapsed by default** behind „Karte anzeigen" (44px target, `aria-expanded`). Choice is remembered per session, not per device |
| why collapsed | 5 labelled pins across Vienna at 390px are unreadable; it spends a billed map load and mobile data in a stairwell; and the director on a phone is standing *in* one building, not surveying the portfolio |
| map height when opened | 320px fixed. Never `100vh`, never `100dvh` |
| gestures | `gestureHandling: 'cooperative'` — **mandatory**. One finger scrolls the page; two fingers pan the map. `greedy` (the PoC's setting) traps the page scroll and is the classic mobile map bug |
| pins | identical markup. If a label does not fit, the fact is still in the list — that is what the list is for |
| Objektliste | rows become cards via the existing `.data-table` transform. No bespoke card component |
| panel | **full-height bottom sheet**, `aria-modal="true"` + focus trap (it covers the page, so it is modal here and non-modal on desktop). Close returns focus to the row that opened it |
| cross-links | ≥44px, stacked, full width, each with its filter stated on a second line |
| hover | none exists. No affordance may be hover-only |
| sidebar | unchanged — the horizontal strip, never `display:none` (mutation-tested in REDESIGN-REVIEW §5 M4) |
| regression to avoid | review defect R1: 768–1439px sideways scroll. The 5-column cap is the guard; verify at 390 / 767 / 1024 / 1280 / 1440 |

---

## 8 · Performance and cost

### 8.1 Maps loads

Billing for the Dynamic Maps SKU is per **map load** — one `new google.maps.Map(...)` — not per
script fetch, and not per pin.

```
1 director × ~10 opens/day × 22 days              ≈    220 loads/month
pessimistic: 5 admins × 30 opens/day × 30 days    ≈  4 500 loads/month
```

Volume is not the risk. **A reconstruction loop is**, and one already exists in the tree:
`web/app/analytics/page.tsx` builds the map inside a `useEffect` keyed on `[report, pinned]`, so
every refetch constructs a new `Map`. With any polling at all that is thousands of billed loads
per open tab per day.

Rules:

- **construct the map once per mount**, hold it in a ref; a data refresh updates markers only.
- **no auto-refresh polling on `/`.** The refresh button stays the way to get a newer answer —
  which is also why `home.asOf` exists.
- theme switch (`ThemeSwitcher` has three states: System/Dunkel/Hell) calls
  `map.setOptions({ styles })`. It must **not** remount the map — that would bill a load per
  toggle.
- fix the analytics reconstruction in the same task; it is the same three lines.

### 8.2 Street View thumbnails

- **metadata is free, images are billed.** A photo is requested **only** when metadata already
  answered `OK`, because the static image endpoint answers HTTP 200 with a grey „no imagery"
  tile — a plain `<img>` + `onerror` ships that tile and presents it as a photograph of the
  client's building.
- the answer is **already stored**: `locations.street_view_status`, written by
  `server/lib/geocode.js` at building creation. **The browser must read the column and never call
  the metadata endpoint itself** — that is the PoC's one wrong pattern, and it costs a network
  round trip on every panel open.
- **one image per panel open, per building**, at panel open only. Never at map render: 30
  buildings on the landing screen would be 30 image requests per page view for pictures nobody
  looked at.
- one fixed size (`400x220`, `source=outdoor`, `return_error_code=true`) so repeat opens hit the
  browser cache. `source=outdoor` is **not optional**: without it Street View returns
  user-contributed *indoor* panoramas, and the PoC's first run put a stranger's office wall,
  framed family photos included, in the panel.
- **today the cost is zero and the render is text**: the Street View Static API is not enabled on
  the operator's Cloud project, so metadata answers `REQUEST_DENIED` for every building and the
  panel shows „Keine Straßenansicht". Correct, stated, and it starts working the day the owner
  ticks the box. Do not work around it.

### 8.3 The key, referrer restrictions, and what they imply

The browser key is public by construction — `NEXT_PUBLIC_*` is inlined into the bundle at **build
time** — and is only safe because it is HTTP-referrer restricted to
`https://schimmer-glanz.exe.xyz/*`, `http://localhost:3000/*`, `http://127.0.0.1:8080/*`.

| Implication | Consequence for this design |
| --- | --- |
| a new host (staging, an IP, a tunnel) is silently rejected | it arrives as state 6 `blocked`. The list is unaffected — which is why the list is not optional |
| the key is baked at build time | a build made without the key ships `noKey` **permanently**. Add a build-time check that prints a loud warning when `NEXT_PUBLIC_GOOGLE_MAPS_KEY` is empty; do not fail the build (a key-less build must stay possible) |
| referrer restriction is not a spend cap | set a per-day quota cap and a billing alert in the Cloud console. Ops, not code, and it belongs in the runbook |
| the geocoding key is a **different**, IP-restricted key and lives only in `server/lib/geocode.js` | it must never reach a browser. Stated in that file; restate it in the task |
| the PoC substitutes the key at serve time and keeps it off disk | keep that pattern for any future PoC. It does not apply to the product, where the key is legitimately in the bundle |

⚠ Exact free-tier volumes and per-SKU prices are **not stated here on purpose** — Google changed
the model in 2025 and this document will not carry a number it cannot verify. Read the Cloud
console before launch; the arithmetic above (≈220 loads/month) is the input to that check.

### 8.4 The data payload

Today `/` fetches `/admin/data?limit=2000` — up to 2000 shift rows — to compute four counts.

- add **`GET /admin/overview`**: one row per building, aggregates computed in **SQL**. Reason,
  and `/pl/` already makes it: browser arithmetic over a capped payload silently under-reports.
  Aggregates must not be capped by `SHIFT_PAGE_MAX`.
- ~30 buildings × ~400 B ≈ **12 KB**, against ~400 KB for the shift payload. On a phone in a
  stairwell that difference is the screen loading or not.
- the ledger blocks (5–7) keep using `/admin/data`; the map does not need it. Two fetches, each
  with one job, is the correct split — but they must render from **one** as-of stamp or the map
  and the on-site table can disagree by a refresh.
- no new npm dependency, server side or client side. Server deps stay `pg` + `@sentry/node`
  (decision-16 as amended by decision-23). Maps still loads via a plain script tag.

### 8.5 Sketch of the contract

```
GET /admin/overview  →
{ as_of, buildings: [ {
    id, slug, name, address, active,
    lat, lng, geocode_state, geocode_status, street_view_status,
    client_id, client_name,
    on_site: [ {worker_id, worker_name, since, minutes, zone_id, zone_name} ],
    unresolved_count, open_count, material_open_count,
    last_clean: {end, worker_name, zone_name, minutes} | null,
    month_minutes, target_minutes | null,
    contract_cents | null, margin_bp | null, margin_unknown_reason | null, rate_basis,
    zones: [ {id, name, active, tag_state, tag_serial_present, last_tap_at} ]   // last_tap_at DERIVED
} ] }
// zones is an empty array for every building today, and that is the normal case (decision-37)
// no per-zone minutes and no per-zone cents: a shift is building-level
```

Money is integer cents, time is integer minutes, timestamps are ISO with the business timezone
`Europe/Vienna` applied at the formatting boundary only — including across DST.

---

## 9 · i18n and accessibility

- new keys live in `home.*` (no new namespace: the map is not a new screen). **de and en key sets
  must be byte-for-byte identical**; the parity check is mutation-proved and will go red.
- German is the real UI language. Test every pin label and every panel cell at German compound
  length: `Materialanforderungen`, `Straßenansicht nicht verfügbar`, `Nicht bestätigt`.
  `overflow-wrap: anywhere` on any cell that can take a compound noun.
- Google's own map labels: `language=de&region=AT` on the script URL.
- landmarks unchanged; the map region is a labelled `<section>` whose accessible name states that
  the list below carries the same objects.
- contrast measured, not eyeballed: body ≥4.5:1, large/UI ≥3:1, focus ring ≥3:1 against both the
  control and its background. Pin labels sit on a `--bg-overlay` chip, never directly on map
  tiles — text on a photographic or tiled background cannot be contrast-checked.
- 44px touch targets, no hover-only affordance.
- motion: panel 200ms, `prefers-reduced-motion` reduces to 0.01ms. Numbers never animate.
- `role="status"` for the as-of stamp; nothing on this screen is `role="alert"` except the load
  error, which already is.

---

## 10 · Open, and deliberately not decided here

1. **`decision-37` is PROPOSED, not accepted.** §4 is written against it. If the owner changes
   the model — in particular if a shift ever becomes zone-level — §3.2 and §4 change with it.
2. **Exact Maps pricing tier and free volume** — verify in the Cloud console (§8.3).
3. **Zone-level coordinates** for a zone with its own street entrance. Deferred, not rejected.
4. **Clustering above ~60 buildings.** Ceiling stated in §2.4; no library until it is real.
5. **Whether `/shifts/` gains `?zone=`.** Follows the zones record, not this spec.
6. **Enabling the Street View Static API** is an owner action in the Cloud console.
7. **`decision-28` (contract history / `rate_basis`) is still *proposed*.** N5 renders its caveat
   either way; if that record is accepted, the caveat text changes and the panel must follow.

---

## 11 · Task seeds

Not created. Ordered, with what blocks what, so a later step can cut them without re-deriving.
Effort is relative (low / med / high) with the reason; no time estimates.

| # | Task | Blocks / blocked by | Effort | Acceptance evidence |
| --- | --- | --- | --- | --- |
| 1 | **Get `decision-37` accepted, then its migration** (`zones` incl. `tag_serial`, nullable `start_zone_id`/`end_zone_id`, composite FKs). Design is already written: `backlog/docs/ZONES-DESIGN.md` | blocks 6; §4's sequencing binds the Play release | med — schema + a decision, no UI | zero rows created by the migration; payroll / P&L / analytics / portal / autoclose SQL byte-identical before and after |
| 2 | `GET /admin/overview`, SQL aggregates, one row per building | blocked by 1 for the zone block only; the rest ships without it | med — new SQL, no new dep | payload ≤20 KB for 30 buildings; totals equal `/payroll/`'s for the same period; not capped by `SHIFT_PAGE_MAX` |
| 3 | **URL filter contract**: `/shifts/` `?location&worker&state&period`, `/payroll/?location`, `/pl/?location`, `/contracts/?location`, `/material-requests/?location&status`; removable filter chip on each; unknown params ignored | blocks 5; **highest value of the set** — it is what makes any cross-link real | med — five screens, one pattern | each link from §3.3 lands on a screen that shows the filter and the right rows; a link that would land empty is not rendered |
| 4 | `Objektliste` on `/` — always rendered, `.data-table`, 5 columns, sorted attention→on-site→name | none | low | renders identically with the map absent; no horizontal scroll at 390/767/1024/1280/1440 |
| 5 | Map region + labelled pins + side panel (desktop) | blocked by 2, 3, 4 | high — the visible half | pin states readable in a desaturated screenshot; panel carries N1–N5; every link carries its filter |
| 6 | Zone block + tag truth in the panel, incl. the „second tag not before every phone is updated" warning | blocked by 1 | low once 1 exists | a building with no zones states so; a zone with no tag says so; the „nicht bestätigt" caption names the unresolved shift's worker, not the latest one; **no zone row prints hours or euros** |
| 7 | **Degradation: all nine states**, incl. `gm_authFailure` teardown and the build-time key warning | blocked by 4 | med — the states are cheap, proving them is not | each state forced and screenshotted; with the script blocked at the network layer the page still lists every building |
| 8 | Phone: collapsed map, `cooperative` gestures, modal bottom sheet | blocked by 5 | low-med | one-finger scroll scrolls the page at 390px; focus trapped in the sheet; focus returns to the opener |
| 9 | **Construct the map once** — fix on `/` and on `/analytics/` | independent, do it early | low — three lines, real money | a refetch produces zero additional map loads (counted in the network panel) |
| 10 | Street View from the stored column + one image per panel open + session cache | blocked by owner enabling the API | low | zero image requests on the landing screen; „Keine Straßenansicht" today; one request per panel open when enabled |
| 11 | `home.*` keys, de + en, exact parity | with 5 | low | parity check green; German compound lengths do not overflow any pin or cell |

Sequencing note: **3 before 5.** Shipping the map first produces a beautiful panel whose links
land where the old ones do, and the complaint that started this work — one screen per table, no
flows — survives the redesign that was supposed to end it.

---

## 12 · What did NOT happen

- **No application code was written or changed.** Nothing under `web/`, `server/`, `android/`,
  `NFCTimeSheets/`, `sql/`, `ops/`.
- **Nothing was committed.** Another workflow is editing `web/messages`.
- **Production was not touched** — no SSH, no deploy, no write. The claim that the live HOIV row
  has NULL coordinates is taken from the briefing and from `geocode_state`'s definition in
  `server/lib/reporting.js`; it was **not** re-verified against the live database.
- **No backlog task was created.** §11 is the input to that step.
- **The PoC was not re-run in this session.** Its screenshots in `.poc-map/shots/` were read;
  its README marks the multi-tag shape and every worker, shift, rate and margin in it as invented.
- **`decision-37` was not written by this workflow** and is not modified here. It appeared
  untracked during this session; §4 was rewritten to obey it rather than to argue with it.
  `backlog/docs/ZONES-DESIGN.md` was not re-read line by line — only the decision record.
- **No Maps price or free-tier volume is asserted.** §8.3 says why.
