# IA-PLAN — the admin stops being a filing cabinet and becomes an object surface

Status: **plan for approval. No application code was written. Nothing was committed.**

Inputs, all read, none inferred: `AGENTS.md` · `backlog/decisions/` (37 records) ·
`backlog/docs/JOURNEYS.md` (the party × journey map) · `backlog/docs/ZONES-DESIGN.md` +
`decision-37` · `backlog/docs/MAP-HOME-SPEC.md` · `backlog/docs/REDESIGN-INVENTORY.md` ·
`backlog/docs/REDESIGN-REVIEW.md` · `web/lib/nav.ts` · `web/app/shifts/page.tsx` ·
`web/app/analytics/page.tsx` · `web/lib/map.ts` · `sql/` + `server/db/migrations/001–005`.

Two owner decisions are settled input and are not re-argued: **the map replaces the home
screen** and **zones are real**.

---

## 0 · One screen

**What changes.** Nothing is deleted and nothing is added. The *entry point* changes from a
table list to an object.

```
screens        14 → 14      zero added, zero removed        (deliberate — see §1)
nav            12 →  9      3 object-scoped screens leave the sidebar, none loses a route
cross-links     2 → 37      today 0 carry state; after, every one carries its filter
new panels          2       Objektpanel + Mitarbeiterpanel — query params, NOT new routes
new routes          0       static export stays (decision-16); no dynamic segments anywhere
migrations          1       006_zones — additive, zero rows created (decision-37)
new server routes   1       GET /admin/overview — SQL aggregates, one row per building
new npm deps        0       server stays pg + @sentry/node; Maps stays a script tag
Play releases       2       (a) the clock-out fix — NOW, alone   (b) the zone switch rule
```

**What it costs.** Relative effort, with the reason. No time estimates.

| Block | Effort | Why |
| --- | --- | --- |
| URL filter contract (6 screens, one pattern) | **med** | `/shifts/` already reads `?period=` from `window.location.search`; this is that pattern, five more params, six screens, plus a removable chip on each |
| `GET /admin/overview` | **med** | new SQL, no new dependency; must not be capped by `SHIFT_PAGE_MAX` |
| Objektliste + ledger on `/` | **low** | `.data-table`, 5 columns, existing card transform |
| Objektpanel (the building surface) | **high** | it is the new IA object: 5 numbers, zone block, 11 links |
| Map region + 9 degradation states | **high** | the states are cheap, proving them is not |
| Mitarbeiterpanel | **med** | same pattern as the building panel, half the content |
| Nav prune | **low** | one file, reversible |
| Zones: migration → server → admin → Android | **med each, long tail** | schema is small; the Play release is the latency |
| D1 onboarding thread (4-step drawer) | **high** | it crosses four screens' writes |

**What it risks.** Three things, and they are the whole risk list in one line each:

```
⚠ a flood        a second physical tag before the zone-aware APK is on every phone turns
                 every intra-building tap into auto_closed=true + a new unpaid shift
⚠ a blind spot   `/` is rewritten, and every one of its correctness properties (asOf,
                 recentScope, truncatedNote, overdueFlag-as-a-word, named triage lists)
                 was bought with an incident
⚠ no parachute   006_zones would be applied to a database whose only backup is on the same
                 disk (S3 / task-38: the offsite hook is a commented TODO)
```

---

## 1 · The diagnosis, and why the answer is not fewer screens

The measured finding: the redesign changed 0 screens, 0 nav destinations, 0 cross-links. It
made a filing cabinet lighter.

The tempting fix — merge screens until there are eight — is the wrong one and would cost the
fortnight this project cannot spend. `/payroll/` is correct. `/pl/` is correct. `/shifts/` is
the only repair tool and it works. Their sin is not that they exist; it is that **nothing
crosses them**, so the director assembles every journey in their own head.

∴ the change is one new axis, not a rewrite:

```
today     screen → table → row → (dead end)
after     OBJECT → panel → every screen that holds a fact about that object, pre-filtered
```

Two objects only: **a building** and **a worker**. Those are the two nouns every ranked
journey names (JOURNEYS §8 rows 1–14). There is no third.

**ponytail:** the panels are query parameters on existing routes (`/?location=<uuid>`,
`/workers/?worker=<uuid>`), not dynamic route segments. Ceiling named: the URL says
`/workers/?worker=…` and not `/workers/<id>`, which is uglier and does not nest. Upgrade path:
`generateStaticParams` if the export ever gains a server. Reason it is not built now: the admin
is a static export served by the same Node process (decision-16); a dynamic segment needs
either a server render or a pre-generated page per row, and rows are created daily.

---

## 2 · The new information architecture

### 2.1 The one new idea

```
                      ┌─────────────────────────────────────┐
   pin / list row ───▶│  OBJEKTPANEL   /?location=<uuid>    │───▶ 11 links, each with state
                      │  who is here · offene Punkte ·      │
                      │  zuletzt gereinigt · Std/Ziel ·     │
                      │  Vertrag/Marge · ZONEN + Tag-Wahrheit│
                      └─────────────────────────────────────┘
                                     │
   payroll row / shift row ─────────▶│
   material row / on-site row        ▼
                      ┌─────────────────────────────────────┐
                      │  MITARBEITERPANEL /workers/?worker= │───▶ 5 links, each with state
                      │  open shift + close it · unbestätigt│
                      │  · Code-Status · Stundensatz · 10   │
                      └─────────────────────────────────────┘
```

The Objektpanel is specified in full in `MAP-HOME-SPEC.md` §3 (five cells N1–N5, the zone
block, the ten links). This document adds the Mitarbeiterpanel, the nav, and the order.

**Why a Mitarbeiterpanel at all.** JOURNEYS §6 gaps 2 and 4: *there is no `/workers/<id>`
route anywhere and `/workers/` has no outgoing link at all.* D5 (rank 3) and D14 both start
with a person's name. Today the answer is: read the name off `/shifts/`, go to `/workers/`,
find them again, read the rate, go back. The panel is that loop, closed, on a phone, in a
stairwell — which is what decision-28 exists for.

### 2.2 Navigation: 12 → 9

```
  Übersicht        /                   map + Objektliste + the ledger      ← the entry point
  Schichten        /shifts/            the repair bench
  Material         /material-requests/ a worker is WAITING on this queue → it is a today screen

── Stammdaten ──
  Objekte          /locations/
  Mitarbeiter      /workers/
  Kunden           /clients/

── Geld ──
  Lohn             /payroll/
  Ergebnis         /pl/

── (pinned bottom) ──
  Konto            /account/
```

**Leaving the sidebar, keeping their routes:** `/contracts/`, `/analytics/`, `/inventory/`.
Each is object-scoped or catalogue-scoped: no journey in §8 starts by opening them cold.
Each keeps ≥2 inbound links that carry state (§3), and each gains one link from the screen
whose users actually need it, so it is never reachable only by typing a URL:

```
/contracts/   ← Objektpanel L5 · /pl/ L23 · /locations/ row L36 · onboarding step 2
/analytics/   ← Objektpanel L10 · /pl/ (flagged building)
/inventory/   ← /material-requests/ (already links there today) · /pl/ (material cost)
```

⚠ This one is taste, not derivation. It is listed in §8 as an owner decision, and it is one
file (`web/lib/nav.ts`), reversible in a minute.

### 2.3 Verdict per screen — all 14

| # | Screen | Verdict | Journey that decides it |
| --- | --- | --- | --- |
| 1 | `/` Übersicht | **REWRITTEN IN PLACE → the object entry point.** map region (optional) + `Objektliste` (always) + today's ledger **verbatim below it**. Same route, nothing moved to a new screen | D4 (6). The ledger stays because moving it to `/heute/` adds a 15th screen and makes the daily check two clicks — the exact complaint |
| 2 | `/shifts/` | **SURVIVES, becomes the repair bench.** Gains `?location &worker &state &period &shift &origin`; both drawers unchanged; the **unbounded** client-side snapshot stays unbounded | D5 (3), D6 (8), D7 (7), D14. It is the only repair tool in the product |
| 3 | `/material-requests/` | **SURVIVES, stays top-level.** Gains `?location &status &worker`; rows gain links to the two panels | D9 (9). A worker is standing in a building waiting; that is a today problem, not a catalogue one |
| 4 | `/workers/` | **SURVIVES + hosts the Mitarbeiterpanel** (`?worker=`). The panel is the `/workers/<id>` that does not exist. Enrolment-code panel stays **inline, not modal** | D3 (11), D5 (3), D14, D11 (18). Gaps 2 + 4 |
| 5 | `/locations/` | **SURVIVES as master data; loses its job as the work surface.** The Objektpanel takes D4/D5/D8. Keeps create/edit/deactivate, the tag URI control, the portal link. Grows the 4-step „Objekt einrichten" thread. Sheds columns (review defect R1) | D1 (5), D2 (10). Nine columns is why 1024px scrolls sideways |
| 6 | `/clients/` | **SURVIVES, off the daily path.** Gains `?client=`; rows link to `/locations/?client=` | D10 (19) |
| 7 | `/inventory/` | **SURVIVES, LEAVES the nav.** No change to the screen | nothing in §8 opens a catalogue cold |
| 8 | `/contracts/` | **SURVIVES as a route, LEAVES the nav, BECOMES a panel target.** Gains `?location=` pre-select | D12 (20) always starts at one building; D1 step 5 is where the thread snaps today |
| 9 | `/payroll/` | **SURVIVES, internals untouched.** Only its three caveat links change — they carry `period` **and** `state` — plus per-row links to the two panels | D7 (7), highest consequence in the product, correct today. Every caveat branch, the CSV shape and both reconcile branches are frozen |
| 10 | `/pl/` | **SURVIVES.** Its four unfiltered links become four filtered ones; the flagged-building link goes to the **panel**, not to another table | D8 (14) |
| 11 | `/analytics/` | **SURVIVES as the trend report, LEAVES the nav. Its map dies here** and moves to `/`. Its panel's three unfiltered links collapse into one link to the Objektpanel. Its `noteMapEquivalent` invariant **moves with the map** | D8 (14). Two maps in one admin is two things that can disagree |
| 12 | `/account/` | **SURVIVES, unchanged**, pinned bottom | D13 (21) |
| 13 | `/login/` | **SURVIVES, unchanged.** One failure message stays one | D13 — splitting it is a user-enumeration oracle |
| 14 | `/reinigung/` | **SURVIVES, FROZEN.** Payload stays `{date, first name, minutes}`. **No zones, ever.** Pinned by a check, not by a promise | C2 (15). Minimality *is* the GDPR argument on the route |
| — | `app/not-found.tsx` | unchanged | — |

**Nothing merges. Nothing dies. Nothing is added.** That is the point: the complaint was never
screen count, and a merge of `/pl/` + `/analytics/` (the only tempting one) risks 174 message
keys of load-bearing refusals to save one sidebar row that §2.2 removes for free.

### 2.4 Drawers and panels — what is new, and where it lives

| Surface | Host route | URL | Contents | New? |
| --- | --- | --- | --- | --- |
| **Objektpanel** | `/` | `?location=<uuid>` | MAP-HOME-SPEC §3: N1 vor Ort · N2 offene Punkte hier · N3 zuletzt gereinigt · N4 Std/Ziel · N5 Vertrag/Marge · zone block · 11 links | **new** |
| **Mitarbeiterpanel** | `/workers/` | `?worker=<uuid>` | open shift + „schließen" link · unbestätigte Schichten · Code-Status (`none∣live∣expired∣redeemed∣inactive`) + issue/revoke · Stundensatz + „kein Stundensatz" as a **named** state · last 10 shifts · 5 links | **new** |
| „Objekt einrichten" | `/locations/` | drawer | the existing 2-step drawer grows to **4**: ① Objekt + Kunde ② Vertrag-Periode + Monatsziel (writes `location_contracts`) ③ Zonen + Tag-URIs ④ Kundenlink. Each step saves before it advances | **new steps on an existing drawer** |
| Schicht nachtragen / korrigieren | `/shifts/` | drawers | unchanged, two drawers, different rules (end time required vs optional) | unchanged |
| Zugangscode | `/workers/` | **inline panel** | unchanged and deliberately not a modal — it is read down a phone while the row stays identifiable | unchanged |

---

## 3 · Every cross-link, and the state it carries

Parameter vocabulary — **one set of names, used identically on every screen**:

```
location=<uuid>   worker=<uuid>   client=<uuid>   shift=<uuid>
period=            all | thisMonth | lastMonth | last30Days | last7Days   ← must equal lib/period.ts ids
state=             open | unresolved | manual | noEmail | noTag
status=            open | decide | order | deliver                        ← materials only
open=<uuid>        opens the edit drawer on /locations/
```

Three rules that make a link honest, all three mandatory:

1. **never render a link to an empty target.** `m = 0` → no material link; the cell says
   `keine Materialanforderung` in words. A link that lands on „nichts gefunden" is the exact
   misreading `home.recentScope` was written to prevent.
2. **the label states the filter before the click** — „Schichten dieses Objekts · November".
3. **the target echoes the filter as a removable chip** — `Objekt: Arsenalstraße ✕`. Without
   this, a filtered screen is indistinguishable from an empty database.
   **Unknown parameters are ignored silently** — never a 404, never an error.

| # | From | To, with state | Fixes | Journey |
| --- | --- | --- | --- | --- |
| L1 | Objektpanel | `/shifts/?location=U&period=thisMonth` | gap 3 | D4 |
| L2 | Objektpanel | `/shifts/?location=U&period=all&state=unresolved` — **`period=all` mandatory** | gap 9 | W8, D5 |
| L3 | Objektpanel | `/shifts/?location=U&period=all&state=open&shift=S` | gap 3 | **D5, rank 3** |
| L4 | Objektpanel | `/payroll/?location=U&period=lastMonth` | gap 1 | D7 |
| L5 | Objektpanel | `/contracts/?location=U` | gaps 5, 7 | D12 |
| L6 | Objektpanel | `/pl/?location=U&period=lastMonth` | gap 5 | D8 |
| L7 | Objektpanel | `/material-requests/?location=U&status=open` | gap 8 | D9 |
| L8 | Objektpanel | `/locations/?open=U` | gap 7 | D1, D2 |
| L9 | Objektpanel | `/clients/?client=C` | — | D10 |
| L10 | Objektpanel | `/analytics/?location=U` | gap 6 | D8 |
| L11 | Objektpanel, per person | `/workers/?worker=W` | gaps 2, 4 | D5, D14 |
| L12 | Mitarbeiterpanel | `/shifts/?worker=W&period=all` | gap 4 | D14 |
| L13 | Mitarbeiterpanel | `/shifts/?worker=W&period=all&state=unresolved` | gap 1 | W8 |
| L14 | Mitarbeiterpanel | `/shifts/?worker=W&period=all&state=open&shift=S` | gap 2 | D5 |
| L15 | Mitarbeiterpanel | `/payroll/?worker=W&period=lastMonth` | gap 1 | D7 |
| L16 | Mitarbeiterpanel | `/?location=U` (where they are on site now) | gap 2 | D5 |
| L17 | `/payroll/` `caveatUnresolved` | `/shifts/?period=<the payroll period>&state=unresolved` | **gap 1** | D7 |
| L18 | `/payroll/` `caveatOpen` | `/shifts/?period=<the payroll period>&state=open` | gap 1 | D7 |
| L19 | `/payroll/` `caveatManual` | `/shifts/?period=<the payroll period>&origin=manual` | gap 1 | D7 |
| L20 | `/payroll/` row | `/workers/?worker=W` | gap 2 | D7, D14 |
| L21 | `/payroll/` row | `/?location=U` | gap 3 | D7 |
| L22 | `/pl/` flagged row | `/?location=U` | gap 5 | D8 |
| L23 | `/pl/` | `/contracts/?location=U` | gap 5 | D8, D12 |
| L24 | `/pl/` | `/shifts/?location=U&period=<the P&L period>` | gap 5 | D8 |
| L25 | `/pl/` | `/material-requests/?location=U` | gap 8 | D9 |
| L26 | `/analytics/` panel | `/?location=U` (replaces its three bare links) | gap 6 | D8 |
| L27 | `/shifts/` row | `/workers/?worker=W` | gap 2 | D5 |
| L28 | `/shifts/` row | `/?location=U` | gap 3 | D5 |
| L29 | `/material-requests/` row | `/workers/?worker=W` | gap 8 | D9 |
| L30 | `/material-requests/` row | `/?location=U` | gap 8 | D9 |
| L31 | `/` triage: unbestätigt | `/shifts/?period=all&state=unresolved` | **gap 9** | D4 |
| L32 | `/` triage: ohne E-Mail | `/workers/?state=noEmail` | gap 9 | D4 |
| L33 | `/` triage: toter Tag | `/locations/?state=noTag` | gap 9 | D4, D2 |
| L34 | `/` on-site row | opens the Objektpanel in place (`?location=U`) | gap 3 | D4 |
| L35 | `/locations/` row | `/?location=U` | gap 3 | D2 |
| L36 | `/locations/` row | `/contracts/?location=U` | gap 7 | D1, D12 |
| L37 | `/clients/` row | `/locations/?client=C` | — | D10 |

**37 links, every one carrying state.** Today: 2 measured, 0 carrying state (the inventory's
cross-link map lists ~14 bare navigations; none passes a filter either way). All nine of
JOURNEYS §6's named gaps are closed by L1–L37; gaps 1, 3, 5, 6, 7 and 9 are closed by the
filter contract **alone**, before any panel exists.

---

## 4 · What is NOT changing, and why

A rewrite that touches everything is how this project loses a fortnight. Explicitly frozen:

**Routes and shell**
- no route renamed, no route deleted, **no dynamic segment added**. Static export stays (decision-16).
- global chrome untouched: skip link, four landmarks, brand, locale switcher, sign-out,
  `aria-current="page"`, the sidebar-as-a-strip on phones (mutation-tested, review §5 M4),
  `.data-table` row→card transform and `ResponsiveTableLabels`' document-order labelling.
- **permanently mounted live regions stay permanently mounted.** No conditionally rendered
  toasts. A text change inside an existing region is announced; an appearing node often is not.
- focus management as-is: moved deliberately to a named target, returned to the opener on close.

**Money, time, language**
- integer cents end to end; `cents/100` only at the `Intl` boundary. Integer minutes.
- `Europe/Vienna` pinned on every `format.dateTime`; `de-AT` month names („Jänner").
- de/en **exact** key parity, mutation-proved. German is the real UI language.

**Screens whose correctness is already paid for**
- `/payroll/`: every caveat branch incl. **both** `caveatReconcile` and `caveatReconcileOk`,
  `caveatRateHistory` unconditional, named exclusions (`Kein Stundensatz` / `Nicht bewertet`,
  never `0,00 €`), the CSV's Vienna-dated filename + UTF-8 BOM + `csvManualShifts` column.
- `/pl/`: `revenueUnknown` (never a confident zero), `assessNoBaseline` (not a pass),
  `baselineUnset`, the flagged-building argument as prose.
- `/shifts/`: the **unbounded** client-side dataset. A server-bounded fetch cannot say
  „nothing in August — 5 shifts exist in earlier periods", and that distinction was once the
  difference between „fine" and „our payroll data is gone". URL params **seed the existing
  client-side filter state**; they must never become a server query.
- `/` ledger: `asOf` (frozen elapsed times, not a ticking clock), `recentScope`,
  `truncatedNote` with the literal 2000, `overdueFlag` **as a word**, named triage lists, and
  the standing refusal of a „Stunden diesen Monat" tile.
- `/reinigung/`: three fields, German pinned, one failure message for
  unknown/revoked/inactive, no admin chrome, its own style island.
- soft deactivation only; **no delete endpoint for shifts** (but see §8.4).

**Worker side**
- **no in-app clock-out button, ever.** Two write paths to one row make two mechanisms
  disagree about somebody's hours.
- a tap ALWAYS writes a local row first — no roster, cache, permission or network check may
  precede it. `armSignals()` after the row is on disk. Pinned by `android/checks/core-check.kt`.
- `422 unknown_location` keeps its code — a new code renders as „unknown status from a newer
  server" on every phone in the field.
- the tag URI keeps its shape: `https://schimmer-glanz.exe.xyz/t?l=<uuid>` (decision-21), and
  a **location** UUID keeps resolving for ever (decision-37 §2).
- 8 h auto-close, `unresolved ⇔ auto_closed AND corrected_at IS NULL`, decision-10: untouched.

**Budget**
- no new npm dependency, client or server. Server deps stay `pg` + `@sentry/node`.
- Google Maps via a plain script tag with the existing referrer-restricted browser key. The
  geocoding key is a different, IP-restricted key and must never reach a browser.

---

## 5 · Order of work

### 5.1 Which comes first: zones, or the map?

**Neither. The filter contract does.**

```
map first            → a beautiful panel whose 11 links land where today's 2 land.
                       The complaint that started this work survives the fix for it.
zones first          → a schema nobody can see, and the Android tail (a Play release you
                       cannot force onto a phone) starts before the value does.
filter contract first→ ships alone, changes no schema, needs no APK, and closes 6 of the 9
                       named gaps on its own.
```

Then: **zones' invisible half early, its visible half late.** The migration and the resolver
are zero-behaviour changes (with zero zone rows, every code path is today's code path), and
they must start early because the Android step has unbounded latency: Play internal testing
gives no way to force an update (P1). The map's web work runs in parallel and does not wait
for them.

⚠ **Ship the Android clock-out fix as its own Play release NOW, before any of this.** It is in
the working tree (`TimeSheetApp.kt:676`), it is on nobody's phone, and INCIDENT 1 reproduces
on every shift at the only live building until it lands. Do not let it ride with the zone
release.

### 5.2 The steps, each shippable on its own

| # | Step | Ships alone? | Depends on | Task |
| --- | --- | --- | --- | --- |
| 0 | Accept decision-37; accept/reject decision-38 and -39 | — | owner | §8 |
| 0b | **Play release: the clock-out fix, alone** | ✓ | — | existing Android work |
| 1 | **URL filter contract** across 6 screens + chips + ignore-unknown | ✓ | — | TASK-160 |
| 2 | `GET /admin/overview` (SQL aggregates, one row per building) | ✓ (nothing renders it yet) | — | TASK-161 |
| 3 | `Objektliste` on `/`, ledger retained verbatim below | ✓ | 2 | TASK-162 |
| 4 | **Objektpanel** `/?location=<uuid>`, 11 links | ✓ | 1, 2, 3 | TASK-163 |
| 5 | Map region above the list + 9 degradation states + construct-once (incl. the `/analytics/` reconstruction bug) | ✓ | 3 | **TASK-155** (updated) |
| 6 | **Mitarbeiterpanel** `/workers/?worker=` | ✓ | 1 | TASK-164 |
| 7 | Nav 12 → 9 + the inbound links for the three demoted routes + a reachability check | ✓ | 4 | TASK-165 |
| 8 | Phone pass on the new home (collapsed map, cooperative gestures, modal bottom sheet, 5-column cap) | ✓ | 5 | TASK-166 |
| 9 | Zones migration `006_zones.sql` — **zero rows** | ✓ | 0 | TASK-156 |
| 10 | Zones server: `activePlace()` + `roster.zones` + admin CRUD | ✓ | 9 | TASK-157 |
| 11 | Zones in the admin: zone list + per-zone URI on `/locations/` | ✓ | 10 | TASK-158 |
| 12 | **Zone block in the Objektpanel** (tag truth, last tap, the sequencing warning) | ✓ | 4, 11 | TASK-167 |
| 13 | Android: the switch rule compares **buildings** → **Play release** | ✓ | 10 | TASK-159 |
| 14 | Confirm every worker phone is on that build | — | 13 | TASK-159 AC |
| 15 | **Only now**: a second physical tag in any building | — | 14 | — |
| 16 | D1 onboarding thread: „Objekt einrichten" ①–④ | ✓ | 1, 11 | TASK-168 |

Order inside the web track is **1 → 2 → 3 → 4 → 5**; inside the zones track
**9 → 10 → 11 → 13 → 14 → 15**. The two tracks touch only at step 12.

### 5.3 If the owner stops after step 1

**The intermediate state is a complete, coherent improvement, not a half-migration.**

```
after 1   every existing cross-link carries its filter; `/shifts/` shows
          „Objekt: Arsenalstraße ✕" and „Zeitraum: alle ✕"; payroll's three links land in
          payroll's own period.  Gaps 1,3,5,6,7,9 closed.  No new screen, no map, no zones,
          no migration, no APK.  Highest value per unit of risk in the whole plan.
after 3   home = answer band + Objektliste + the ledger.  Zero pins in production today
          (every building has lat IS NULL), and that is the DESIGNED normal case, not a
          fallback.  The list is day one.
after 5   home = map + list + ledger.  Zone block absent → the panel states
          „Keine Zonen angelegt. Dieses Objekt verhält sich wie bisher: ein Ort, ein Tag."
after 9   migration applied, zero rows, every code path is today's code path.  Nothing on
          any screen changes.  Safest possible stopping point for a schema change.
after 11  ⚠ THE ONE UNSAFE STOP.  An admin can create zones and copy a second tag URI while
          the APK in the field still compares raw ids.  Mitigation is in TASK-158's AC:
          the copy control for a building's SECOND and later zone is behind a ConfirmModal
          naming the risk, and the panel states it in words, de/en.
after 13  ⚠ still unsafe until step 14 confirms every phone.  Play cannot force an update.
```

### 5.4 What must never be half-migrated

- **the parameter vocabulary.** One screen reading `?loc=` while another reads `?location=`
  is worse than none reading anything. Step 1 lands all six screens or none.
- **the ledger.** `/` must never exist in a state where the map has shipped and `asOf` /
  `recentScope` / `truncatedNote` have not.
- **zone rows vs the APK.** Steps 9–11 create no zone rows in production. The first zone row
  in production is an owner action taken after step 14.

---

## 6 · Risk list

### 6.1 What could regress

| Risk | Guard |
| --- | --- |
| `/` loses a correctness property in the rewrite (`asOf`, `recentScope`, `truncatedNote`, `overdueFlag` as a word, named triage lists, the rejected hours tile) | each is an AC on TASK-162/155, checked as a **string**, not as an element count — counting is how this repo shipped cards captioned with the wrong column |
| review defect **R1**: horizontal scroll 768–1439px | `Objektliste` capped at **5 columns**; verify at 390 / 767 / 1024 / 1280 / 1440. `/locations/` sheds columns in the same pass |
| a filtered screen reads as an empty database | rule 3 of §3 — a removable chip, plus the existing `emptyOutside` / `latestRecorded` escape on `/shifts/` extended, **not replaced** |
| payroll's links land in the wrong period *again* | `period=` values must be the literal ids from `lib/period.ts`; AC asserts source period == target period |
| `/shifts/` quietly becomes server-bounded while adding `?location=` | AC: the snapshot fetch keeps no `from`/`to`; the params seed client-side filter state only |
| Maps cost blows up | construct the map **once** per mount; fix the existing `useEffect([report, pinned])` reconstruction on `/analytics/` in the same task; no auto-refresh polling on `/` |
| the three demoted routes become unreachable later | a check that asserts every admin route not in `PRIMARY_NAV` has ≥1 inbound link in the built export |
| `/` grows again (it already grew 9% in the redesign) | map ≤ `min(52vh, 560px)`, **never 100vh**; collapsed by default on phones |
| de/en parity breaks | existing mutation-proved parity check; it goes red |

### 6.2 What could lose data

| Risk | Guard |
| --- | --- |
| **006_zones applied to production while the only backup is on the same disk** (S3 / task-38: the offsite hook is a commented TODO) | **do not apply 006 to production until task-38 lands**, or take a verified off-box dump immediately before and restore-test it. This is an owner decision (§8.6), stated because the loss is total |
| `PATCH /admin/shifts/:id` starts raising `23503` when a correction changes `location_id` while the zone columns are set → **the only repair tool in the product breaks** | decision-37 §7 requires the update to CLEAR both zone columns in the same statement. AC on TASK-157 |
| a backfilled „Eingang" zone puts a fabricated measurement in a payroll database | AC on TASK-156: `SELECT count(*) FROM zones` = 0 after the migration |
| `/admin/overview` computes aggregates in the browser over a capped payload → silent under-reporting presented as fact | AC on TASK-161: totals equal `/payroll/`'s for the same period; aggregates not bounded by `SHIFT_PAGE_MAX` |
| the 2000-row cap silently truncates a new surface | every screen that can hit it already says so; the overview must be **uncapped**, and must say so if that ever changes |
| a shift filed by a verification tap is undeletable, ×N zones ×N buildings | §8.4 — needs an owner decision before zones reach the fourth building |

### 6.3 What could break the ONE live tag

The tag at HOIV is foreign hardware with no URL, 46 B capacity, resolved by a serial compiled
into the APK. It is the only tag in the field, and it pays the only live building.

| Risk | Guard |
| --- | --- |
| the URI shape changes (`?z=`, or location UUIDs stop resolving) | forbidden by decision-37 §2. AC on TASK-157: a synthesised `…/t?l=<location uuid>` still opens a shift, byte-identically |
| `activeLocation()` → `activePlace()` changes the error code | AC: **`422 unknown_location` unchanged**. A new code renders as „unknown status from a newer server" on every phone |
| `/roster` payload changes shape rather than growing | `Api.kt:82` reads `getJSONArray("locations")` and ignores the rest → additive only, never a rename |
| `KnownTags.BY_SERIAL` removed before the serial is on a zone row **and** every phone has cached a roster | AC on TASK-159: the compiled entry stays as a last-resort fallback; a fresh install with no network must still clock in at HOIV |
| the HOIV building is deactivated during testing → its zones deactivate → the tag stops resolving | production is read-only for this work; nothing in this plan writes to it |

### 6.4 What could break the one live worker journey

`tap → POST /shifts/open → … → tap → close`. Two ways to break it, both fatal to trust:

1. **The flood.** A second physical tag in a building before the zone-aware APK is on every
   phone: the shipped build compares raw ids, so an intra-building tap reads as a *building
   switch* → `auto_closed = true`, a new shift, and the old one unpayable until resolved. At
   five zones this is unpaid work at scale. Gated by steps 13–15 and by TASK-158's
   ConfirmModal.
2. **A precondition creeping in front of the tap.** Anything that makes the local row wait on
   a roster lookup, a cache, a permission, a notification or the network. `buildingOf()` in
   TASK-159 reads the **cached** roster for exactly this reason — a stairwell has no signal
   and a cache miss may never block a clock-in.

Also standing, and not made worse by this plan: the adopted tag cannot wake a closed app, so
the only working clock-in at the only live site is `open app → Scan → hold to wall`. The
Objektpanel's zone block is where „is this building on an adopted tag" finally becomes visible
to the director (D5's fourth row, today answerable by nobody).

### 6.5 What needs a decision record before it is built

| Record | Status | Blocks |
| --- | --- | --- |
| **decision-37** — zones: no `tags` table, shared id space, shift stays building-level | **proposed** | TASK-156/157/158/159/167 |
| **decision-38** — the object surface is query parameters on existing routes; every cross-link carries its filter; unknown params are ignored | **proposed, written by this plan** | TASK-160 and everything downstream |
| **decision-39** — the map is the landing surface; the ledger stays on the same route; three object-scoped routes leave the sidebar | **proposed, written by this plan** | TASK-155/162/163/165 |
| decision-28 — contract history / `rate_basis` | proposed | the panel's N5 caveat text |
| — the verification tap (§8.4): a void/soft-delete for shifts, **or** a read-only verify mode | **not written** — needs the owner's answer first | D1 step 9 at N zones |

---

## 7 · Backlog tasks filed

Nine new, one updated, four existing wired in. Labels: `ux`, `ia`, `zones`, `map`.

| Task | Label | Depends on |
| --- | --- | --- |
| **TASK-160** URL filter contract — every cross-link carries its filter | `ux,ia` | — |
| **TASK-161** `GET /admin/overview` — SQL aggregates, one row per building | `ia,map` | — |
| **TASK-162** `Objektliste` on `/`, the ledger kept verbatim below it | `ux,ia,map` | 161 |
| **TASK-163** Objektpanel `/?location=<uuid>` — the building object surface | `ux,ia,map` | 160, 161, 162 |
| **TASK-155** *(updated)* map region + 9 degradation states + construct-once | `ux,web,map,ia` | 162, 163 |
| **TASK-164** Mitarbeiterpanel `/workers/?worker=<uuid>` | `ux,ia` | 160 |
| **TASK-165** Nav 12 → 9, three routes leave the sidebar and keep inbound links | `ux,ia` | 163 |
| **TASK-166** the new home on a phone (390px) | `ux,ia,map` | 155 |
| **TASK-167** zone block + tag truth in the Objektpanel | `ux,zones,map` | 158, 163 |
| **TASK-168** „Objekt einrichten" — D1 as one thread, four steps | `ux,ia` | 160, 158 |
| TASK-156/157/158/159 *(existing)* zones migration → server → admin → Android | `zones,db,android` | chain |

---

## 8 · What the owner must decide before implementation starts

Seven, and every one blocks something named above.

1. **Accept decision-37 (zones) as written?** No zone work starts until it is accepted. If the
   model changes — in particular if a shift ever becomes zone-level — MAP-HOME-SPEC §3.2/§4
   and TASK-167 change with it.
2. **Accept decision-38: the object surface is query parameters, not routes?** It forecloses
   `/workers/<id>` and `/objekte/<slug>` for as long as the admin is a static export. The
   alternative is a server-rendered admin, which is a different architecture and a different
   decision (16).
3. **Accept decision-39: nav 12 → 9?** `/contracts/`, `/analytics/` and `/inventory/` leave
   the sidebar and are reached from the objects that need them. This is taste; it is one file
   and it is reversible.
4. **The verification tap.** D1 step 9 — testing a tag creates a permanent, undeletable
   payroll row, and there is no `DELETE /admin/shifts/:id` anywhere. With zones that becomes
   N test shifts per building. Pick one: (a) a soft-void flag on a shift, admin-only, excluded
   and **named** in payroll like every other exclusion; (b) a read-only „Tag prüfen" mode in
   the app that reads the tag and does **not** re-enter through `ACTION_VIEW`; (c) accept it
   and tell the director in the admin copy to correct every test shift afterwards. Something
   must give before the fourth building.
5. **Google Cloud console, owner-only:** set a per-day Maps quota cap **and** a billing alert;
   decide whether to enable the Street View Static API. Today it is disabled, so the panel
   correctly renders „Keine Straßenansicht" and costs nothing.
6. **Offsite backup before the migration.** task-38 is open and the nightly dump sits on the
   same disk as the database. Either land it first, or waive it explicitly and take a verified
   off-box dump immediately before applying 006.
7. **Ship the Android clock-out fix as its own Play release now?** Recommended: yes. It is
   written, it is on nobody's phone, and INCIDENT 1 reproduces on every shift until it lands.
   Bundling it with the zone release delays the #1-ranked journey behind a schema migration.

---

## 9 · What this plan was forced to assume

Short and real.

- **Zero buildings have coordinates in production.** Taken from the briefing and from
  `geocode_state`'s definition; **not re-verified against the live database** — production is
  read-only for this work. If it is wrong, the map draws pins on day one and nothing else in
  the plan changes; the list is rendered on every path either way.
- **JOURNEYS §8's frequencies are estimates**, from the shape of the business and one field
  test, not from measurement. There is no analytics on worker behaviour and there should not
  be. The *order* of the top eight is robust; the exact scores are not.
- **decision-37 and decision-28 are proposed.** This plan is written as if both will be
  accepted, and says where each one is load-bearing.
- **The map PoC's zone shape is invented data** (its own README says so), and this plan
  departs from it: the PoC attaches a shift to a tag; decision-37 §3 rejects that.
- **No Maps price or free-tier volume is asserted.** Google changed the model in 2025.
- **TASK-140–154 (the redesign tasks) are still `To Do` in the tracker** although the redesign
  landed and was reviewed. Their status was not changed by this workflow.
- **The 2 → 37 cross-link count** uses the redesign probe's measure of a cross-link. The
  inventory's own map lists ~14 bare navigations. Under either measure, the number that
  matters is the same: **0 links carry state today.**

---

## 10 · What did NOT happen

- **No application code was written or changed.** Nothing under `web/`, `server/`, `android/`,
  `NFCTimeSheets/`, `sql/`, `ops/`.
- **Nothing was committed.** Another workflow is editing `web/messages`.
- **Production was not touched.** No SSH, no query, no deploy, no write of any kind.
- **No migration was applied**, not even to a scratch database.
- **No decision was accepted.** decision-38 and decision-39 were created with status
  `proposed`; the owner accepts decisions.
- **TASK-155 was updated, not duplicated.**

---

## §9 · Owner answers, 2026-08-18

The five open questions in §8, answered. These supersede §8 where they conflict.

**1 · decisions 37 / 38 / 39 — ACCEPTED.** Status flipped in `backlog/decisions/`.
Zones are places under a building, the tag URI id space is shared, and a shift stays
building-level (37). The object surface is query parameters on existing routes, every
cross-link carrying its filter (38). The map is the landing surface, the ledger stays on the
same route, three object-scoped routes leave the sidebar (39).

**2 · The verification tap — DEFERRED, with a trigger.**
Owner's words: "this is actually a JTBD that is not designed properly."
The problem is real: a tap is the only way to test a tag, a tap opens a real shift, and shifts
are never deleted — so testing a tag costs an undeletable payroll row, multiplied by the number
of zones. It is deferred because it is not yet designed, not because it is solved.
TRIGGER: revisit when tags are deployed in bulk (more than one building, or zones going in).
Do NOT design it before then; the shape depends on how tags actually get rolled out.
Options recorded so they are not rediscovered: (a) live with junk rows and correct by hand,
(b) void-with-reason flag, (c) a check mode that reads a tag and names its zone without posting
a shift. (c) was the standing recommendation — verifying a tag should not be indistinguishable
from starting work.

**3 · Map presentation — DECIDED, and cheaper than MAP-HOME-SPEC assumed.**
- NO Street View. Removes the per-building image cost and the privacy question of showing a
  customer's front door. The spec's Street View thumbnail is dropped, not deferred.
- Muted map in the dark palette, subordinate to our own content.
- Our own pins, readable without colour (state is never colour alone).
- Info boxes on the pin carrying the numbers AND the cross-links, expandable/collapsible.
This reduces Maps usage to map loads only. Quota cap still worth setting; Street View toggle is
now moot.

**4 · Offsite backup before migration 006 — DROPPED as a gate.**
Owner: "why is it important if customer didn't use the app yet?" Correct, and the gate was
over-applied. Production is 1 building, 0 workers, 0 shifts — there is nothing to lose, and a
failed migration is recreated in minutes.
BECOMES REAL when actual taps accumulate: the first month of real cleaning is when a lost
database stops being an inconvenience. task-38 stays open, unblocked from 006.

**5 · The Android clock-out fix — ALREADY SHIPPED, no action.**
The plan asked for its own Play release. Verified in the tree instead:
`ui/TimeSheetApp.kt:424` scan button on the idle screen, `:676` on ShiftRunningScreen — the
in-shift button whose absence stranded Balint mid-shift. Built into
`~/Desktop/NFCTimeSheets-v1.5-schimmer.apk`, which also carries the current host. Hand the
client v1.5. The planning agent flagged it because it could not see which APK existed.

**Correction to a plan assumption.** §8 assumed, without checking, that no building has
coordinates. Verified read-only against production: `locations` holds exactly one row, HOIV,
`lat NULL`, `lng NULL`, `geocode_status = 'no_key'` — created before the geocoding key was
installed. So the map's empty state is not an edge case, it is the state on day one. A backfill
re-geocoding `geocode_status = 'no_key'` rows is a prerequisite of the map, not a nicety. The
key works: Arsenalstraße 11 resolves to 48.1761151, 16.3953038.
