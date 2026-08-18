---
id: decision-39
title: >-
  The map is the landing surface the ledger stays on the same route and three
  object-scoped routes leave the sidebar
date: '2026-08-18 03:15'
status: accepted
---
**PROPOSED. Not accepted. The owner accepts decisions.**

Full specification: `backlog/docs/MAP-HOME-SPEC.md`. Plan: `backlog/docs/IA-PLAN.md`.
Journeys: `backlog/docs/JOURNEYS.md` (D4 rank 6, D5 rank 3, D8 rank 14).
Relates to: decision-28 (the admin works on a phone), decision-37 (zones), decision-16 (static
export, no new dependency), decision-38 (the parameter contract this screen consumes).
**Supersedes nothing.** Records an owner decision already taken, and binds what it may not cost.

## Context

The owner has decided that the map replaces the home screen and that a building pin is the
entry point into that building's work. Today `/` is an exceptions list that answers „muss ich
gerade etwas tun?" and answers „wo ist gerade jemand" as a list of names **with no geography**.

Three facts constrain how that decision is implemented:

- **zero buildings in production have coordinates.** The one live building predates the
  geocoding key (`lat IS NULL`, `geocode_state = 'never_attempted'`). On the day this ships the
  map draws **zero pins**. ∴ the list is not a fallback; the list is day one.
- `/analytics/` already carries the invariant `noteMapEquivalent` — *the table is primary, the
  map is optional* — and it is what makes the screen keyboard- and screen-reader-usable without
  a second implementation.
- every correctness property of today's `/` was bought with an incident: `asOf` (frozen elapsed
  times, not a ticking clock), `recentScope` („ohne Zeitraumfilter … hier wird nichts
  zusammengezählt"), `truncatedNote` with the literal 2000 limit, `overdueFlag` as a **word**,
  the **named** lists in the triage rows, and the standing refusal of an „hours this month"
  tile that reads 0,00 € on the 3rd.

## Decision

1. **`/` becomes: answer band (two cells) → map region (optional) → `Objektliste` (always) →
   today's ledger, verbatim.** Same route. Nothing moves to a new screen and nothing is
   deleted. Rejected: a new `/heute/` for the ledger — it adds a 15th screen and makes the
   daily check two clicks, which is the complaint this work exists to end.

2. **`Objektliste` renders on every path**, with the same buildings, the same numbers, the same
   states in words and the same action as the pins. The map is a region above it that may or
   may not appear. It inherits `noteMapEquivalent` from `/analytics/`, and `/analytics/` loses
   its map — two maps in one admin are two things that can disagree.

3. **The map is never `100vh`** (`min(52vh, 560px)`), and on a phone it is **collapsed by
   default** behind „Karte anzeigen" with `gestureHandling: 'cooperative'`.

4. **Nine named degradation states**, in words, in German. `gm_authFailure` **tears the map
   region down** rather than overlaying it. Quota exhaustion is not distinguishable from a
   rejected key in the browser and the screen must not invent the distinction.

5. **The ledger's correctness properties are carried verbatim** — `asOf`, `recentScope`,
   `truncatedNote`, `overdueFlag` as a word, the named triage lists, no hours tile.

6. **Three object-scoped routes leave the sidebar and keep their routes**: `/contracts/`,
   `/analytics/`, `/inventory/`. Nav goes 12 → 9. Each is reached from the object that needs
   it — the Objektpanel, `/pl/`, `/locations/`, `/material-requests/` — and a check asserts
   that every admin route outside `PRIMARY_NAV` has at least one inbound link in the built
   export.

7. **One pin per building, always.** A zone never gets its own pin (decision-37): zones share
   the building's single coordinate, and a zone is not a unit of business — the contract, the
   target, the portal grant and the margin are all per building.

## Consequences

- The screen is useful on day one with zero pins, and it says why in words with a per-row
  „Koordinaten holen" control. A design in which the list is a degraded state would ship an
  empty screen to the only building this company currently cleans.
- The panel's value depends entirely on decision-38. Shipping the map before the parameter
  contract produces a panel whose links land where today's land, and the complaint survives
  the fix for it.
- **Cost:** billing is per map load — one `new google.maps.Map(...)`. The map is constructed
  **once per mount** and held in a ref; a data refresh updates markers only; a theme switch
  calls `setOptions`, never a remount. The existing reconstruction loop on `/analytics/`
  (`useEffect` keyed on `[report, pinned]`) is fixed in the same change. No auto-refresh
  polling on `/`.
- **Accepted ceiling:** pins are `aria-hidden`, mouse and touch only; `Objektliste` is the only
  set of tab stops. Upgrade path: a roving tabindex over pins sorted north→south. Not built
  until someone asks.
- **Accepted ceiling:** above ~30 pins the label degrades to glyph + count; above ~60 the map
  is a heat blur and the list is the product. No clustering library — that is a dependency, and
  the budget is zero.
- **Risk:** three routes off the sidebar is a discoverability cost. It is one file
  (`web/lib/nav.ts`) and reversible; the inbound-link check is what stops it becoming a dead
  route.
