---
id: decision-43
title: >-
  Zones carry an area, the building's area is derived, an unzoned building is
  grey but never unresolvable
date: '2026-08-19 13:48'
status: accepted
---
**ACCEPTED 2026-08-19 by the owner.** Implemented by `006_zones_revenue_rates.sql` §3.

decision-37 now carries `status: superseded` and a banner at the top of its own file naming
the four contradictions, so a reader who opens it first is not misled.

§3 — the one with teeth — is proved against the REAL production row, not against a fixture:
`ops/check-hoiv-survives-006.mjs` restores the production dump into a scratch database, applies
006, and asserts that HOIV (active, 0 zones, its pin intact) still answers 201 to
`POST /shifts/open` and reports `zone_state = 'unzoned'` with `active = true`. Its RED case is
seeded: adding `AND EXISTS (SELECT 1 FROM zones …)` to the resolver turns it red.

## **SUPERSEDES decision-37** (accepted 2026-08-18, IA-PLAN §9.1)

decision-37 is retained in full where it is not contradicted; the contradictions are itemised
below so nobody has to diff two long records. Full design, migration sketch, API surface and
failure analysis: `backlog/docs/ZONES-MODEL.md` §3. The document it replaces is
`backlog/docs/ZONES-DESIGN.md`.

Relates to decision-5 (the id is in the URI, not the hardware UID), decision-6 (materials are
not attributed by a human), decision-10 (auto-close + resolution), decision-15 (tags unlocked;
a tag is not a credential), decision-19 (the server is authoritative for open shifts),
decision-21 (the UUID in the tag URI, never the slug), decision-39 (the map is the landing
surface), decision-40 (the tag host is permanent and separate from the API host),
decision-42 (revenue stays on the building), decision-44 (serials).

## Context

decision-37 settled the shape of zones. Since it was accepted, four things changed:

1. **The owner added an area.** A building's area is the sum of its zones' areas. decision-37
   explicitly *rejected* `square_metres`, on the ground that a per-zone area invites a
   per-zone cost this system cannot measure.
2. **The owner removed tag writing from building creation** and moved it onto zone creation,
   and declared that a building with a contract and a contact but no zones is a legitimate,
   **inactive**, grey-on-the-map state.
3. **The APK left Play.** decision-37's landmine #1 — "a second zone deployed before the
   zone-aware APK is on every phone, and there is no way to force an update" — is now one
   sideloaded `adb install -r` onto one phone, which preserves the worker session.
4. **The tag host came back.** `https://timesheets.exe.xyz/t?l=c3c37d4a-…` resolves again.
   That card carries a **building** UUID, and HOIV has **zero zones**.

Point 4 crossed with point 2 is the reason this record exists rather than an amendment. Read
naively, "a building with no zones is inactive" kills the card that was just resurrected, at
the moment migration 006 lands, with no site visit able to fix it.

## Decision

**1 · `zones` is a child of `locations`, and it carries an area.**

```sql
CREATE TABLE zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     UUID NOT NULL REFERENCES locations(id),
  name            TEXT NOT NULL CHECK (btrim(name) <> ''),
  note            TEXT,                                -- where the tag physically is
  area_sqm        NUMERIC(8,2) CHECK (area_sqm > 0),   -- NULL = nobody has measured it
  tag_serial      TEXT CHECK (tag_serial ~ '^[0-9A-F]{2}(:[0-9A-F]{2})+$'),   -- decision-44
  tag_deployed_at TIMESTAMPTZ,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Plus `zones_location_id_idx`, a partial unique live-name index per building, a partial unique
`tag_serial` index, and `UNIQUE (id, location_id)` for the composite FKs below.

`area_sqm` is **NULLable and that is the point.** A zone nobody has measured is real — "Stiege
3, there is no floor plan". A required area would be an invented one, and an invented m²
poisons the €/m² benchmark that is the only reason the column exists. NULL is not 0 here
either: the building total renders as „mindestens 420 m² (2 von 5 Zonen ohne Fläche)", never
as a total pretending completeness. `NUMERIC`, not float — exact decimal, same discipline as
money.

**The building stores no area.** `SUM(zones.area_sqm)` is derived at read time: 005's standing
rule that a derivable fact is not stored, because a stored copy drifts the first time a zone
is resized.

Retained unchanged from decision-37: no `tags` table; no self-referencing `locations` tree; no
`floor`; no `sort_order`; no `last_tapped_at`; no `is_default`.

**2 · The tag URI is unchanged, and a BUILDING UUID resolves to the BUILDING, for ever.**

`/t?l=<uuid>`. `l` means "the id of the place that was tapped". `activeLocation()` becomes
`activePlace()`, one query, exactly one row or a refusal:

```
an ACTIVE zone of an ACTIVE building  -> (location_id, zone_id)
an ACTIVE building                    -> (location_id, NULL)   <- THE CARD ON THE WALL,
                                                                  zoned or not, for ever
neither                               -> 422 unknown_location  (code UNCHANGED: the build in
                                                                the field renders any new code
                                                                as "unknown status")
more than one row                     -> refuse (UUIDv4 collision across two tables only)
```

A building UUID never resolves to "the first zone" or "a default zone": that fabricates a tap
location and silently changes meaning the day a second zone is added.

**3 · "Unzoned" is a PRESENTATION state and must never be wired to resolution.** Two words
kept apart, deliberately:

```
locations.active   OPERATIONAL, unchanged. A building tag resolves iff this is true.
zone_state         DERIVED, PRESENTATION ONLY.
                     'zoned'   >= 1 active zone
                     'unzoned' 0 active zones -> GREY pin, „Noch keine Zonen — Fläche unbekannt"
                   It NEVER touches tap resolution, payroll, the P&L or the portal.
```

Pinned by a check whose RED case is seeded: an active building with zero zones (exactly HOIV's
shape) must answer 201 to `POST /shifts/open`; adding `AND EXISTS (SELECT 1 FROM zones …)` to
the resolver must turn it red.

**4 · A shift attaches to the BUILDING.** `shifts.location_id` keeps its meaning and stays
`NOT NULL`. `start_zone_id` / `end_zone_id` are nullable **tap facts**, never a cost split —
the same standing as `material_requests.location_id` under decision-6. Composite FKs
`(zone_id, location_id) → zones(id, location_id)`, `MATCH SIMPLE`, so the database itself
makes it impossible for a shift to name another building's zone.

Two columns and not one: a single `zone_id` cannot answer "which door do people actually leave
by", which is the maintenance question the `note` column exists for.

Tap rule, unchanged from decision-37: no open shift → open; **any zone of the same building →
close** (`auto_closed = false`); a different building → close with `auto_closed = true` and
open the new one. The asymmetry that decides it is unchanged and still decisive: an early
close is recoverable with a full audit trail, an unclockable-out worker is the worst failure
this system has had (INCIDENT 1).

**5 · The contract and the revenue stay on the BUILDING** (decision-42). No zone-level
contract, target, revenue or margin.

**6 · Per-m² is possible AT THE BUILDING, and is refused at the zone.**

```
building_m2   = SUM(zones.area_sqm) WHERE active
EUR/m2/month  = revenue_cents / building_m2          numeric in SQL, rounded once
minutes/m2    = labour_minutes / building_m2
```

This is what makes zones worth having: it is the denominator the director needs to quote a new
building. Guard rails: any active zone with `area_sqm IS NULL` ⇒ every per-m² figure is NULL,
reason `area_incomplete`; an unzoned building ⇒ NULL, reason `no_zones`. Never 0.

**Per-zone cost is refused.** A shift is building-level, so no duration is attributable to a
zone. Splitting the building's labour by area share asserts that time is proportional to floor
area, which is false in the obvious direction — a Tiefgarage is fast per m², an office floor
is slow. That is the same failure decision-6 already refused for materials. What a zone can
answer is tag activity ("the Tiefgarage tag has not been tapped since 14 May") and area.

**7 · Building creation no longer walks through tag writing; adding a zone does.** The
building drawer gains an optional step 3, „Erste Zone anlegen"; skipping it saves an unzoned
building with a named next action. The tag walkthrough — the same verbatim code-block, copy
button and UUID line that `REDESIGN-INVENTORY` §5 calls the most load-bearing control on the
screen — moves onto the zone.

**The building keeps a collapsed, read-only „Gebäude-Tag (Bestand)" disclosure.** The card on
the wall carries a building UUID; without this the director cannot see what it says or
re-write it if it is lost. Collapsed and never the primary control, so no new building-level
tags get minted out of habit.

**8 · The client portal payload does not change, and gains no area.** `{date, first name,
minutes}`. A zone name is internal building structure; an area plus the contract value is our
price per square metre in the hands of the party negotiating it. A zone id must never be
grantable — `portal_grants` references `location_id` and must keep doing so. Pinned by a
check, not a promise.

**9 · Zero backfill, zero invented rows.** `start_zone_id IS NULL` reads as "a building-level
tag was tapped, or this predates zones". Payroll, the P&L, analytics, the portal and the
autoclose SQL are unchanged byte for byte. Production has 0 shifts; the rule is written for
the demo database and for the months after next week. Backfilling a default zone would assert
a tap that never happened — `005` refused the identical move for contracts.

## Consequences

**Deployment order is still the one hard constraint, but it is now cheap.**

```
1  apply 006                    zero zone rows, no behaviour change
2  server: activePlace() + roster.zones + admin CRUD
3  admin: zone list, per-zone tag URI, area
4  Android: buildingOf() switch rule + zone name on the running screen  -> new APK
5  adb install -r on THE ONE field phone; confirm the build             <- one action now
6  ONLY NOW a second physical tag in any building
```

Step 6 before step 5 still turns every intra-building tap into `auto_closed = true` plus a new
shift — a flood of unresolved, unpaid work. Until step 5 is confirmed the admin surface must
say so. **Zones stay opt-in per building; a building with no zones behaves exactly as today.**

- The running screen must state in words what the next tap does — „Der nächste Tag-Kontakt in
  diesem Objekt – egal welcher – beendet die Schicht." de/en key parity.
- `PATCH /admin/shifts/:id` must clear both zone columns when `location_id` changes, or the
  update raises `23503`. Clearing is also the correct semantics.
- Deactivating a building must deactivate its zones: an active zone under an inactive building
  is unresolvable and looks like a dead tag.
- `POST /shifts/open` keeps the field name `location_uuid` while its value may be a zone id.
  *ponytail:* the name is now a lie. CEILING: cheapest correct thing while an APK is in the
  field. UPGRADE PATH: accept `place_uuid` as preferred once both clients send it; keep
  `location_uuid` accepted for ever.
- **The verification tap gets worse and its trigger has fired.** IA-PLAN §9.2 deferred it
  "until tags are deployed in bulk — more than one building, or zones going in". Zones going
  in is that trigger. Each zone costs one undeletable payroll row to test, and there is no
  `DELETE /admin/shifts/:id`. Either the read-only „Tag prüfen" mode lands first, or the zone
  drawer says in words that the test tap creates a shift that must be corrected. It must not
  be discovered at the wall.
- **Accepted loss:** no per-zone duration. Upgrade path named and unblocked by the schema: a
  `shift_zone_visits` child table, which needs a tap at every zone boundary and is its own
  decision with a real cost at the door.
- **Accepted loss:** no worker↔zone assignment (there is no worker↔building assignment
  either), no nested zones, one adopted serial per zone (decision-44).
- No new npm dependency, no new systemd unit. Server deps stay `pg` + `@sentry/node`
  (decision-23). Tag URIs are built by `web/lib/tag.ts` on the permanent tag host
  (decision-40) — one place, already gated by a format check.

**Revisit trigger:** the first time a director asks what one *zone* costs. This model answers
that with tag activity and area, not with money, and changing that is a decision record and
not a query.
