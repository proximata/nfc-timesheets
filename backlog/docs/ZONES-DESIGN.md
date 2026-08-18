# ZONES — a building holds several cleanable areas, each able to carry its own tag

Status: **design, nothing built, nothing applied.** The migration below is a sketch in this
document and not a file under `server/db/migrations/`. No production access was used.

Input: `backlog/docs/JOURNEYS.md` (the party × journey map), `.poc-map/dashboard-map.html`
(the map PoC — its multi-tag shape is marked `INVENTED` by its own README), the applied
migrations `001`–`005`, `server/routes/app.js`, `server/lib/validate.js`,
`android/core/TagLink.kt`, `android/nfc/KnownTags.kt`, `android/ui/TimeSheetViewModel.kt`.

Two owner decisions are settled and not re-argued: **the map replaces the home screen**
(TASK-155) and **zones are real**. This document decides only *how*.

The accompanying decision record is `decision-29`, status **proposed**. The owner accepts
decisions; this document does not.

---

## 0 · The six answers, in one screen

```
1  data model      zones child of locations.  NO tags table:  a zone row IS the tag record.
                   zones.tag_serial covers adopted hardware.  0 changes to 5 admin screens.
2  tag URI         /t?l=<uuid> UNCHANGED.  `l` stops meaning "location" and means
                   "the place that was tapped".  Server accepts a zone UUID OR a location
                   UUID, for ever.  The deployed HOIV tag needs NO action and NO APK.
3  a shift         attaches to the BUILDING, as today.  location_id stays NOT NULL.
                   start_zone_id / end_zone_id are nullable tap facts, never a cost split.
                   Any zone of the same building closes the shift.  NEVER one shift per zone.
4  properties      name, note, active, tag_serial, tag_deployed_at.  NO m², NO floor.
5  history         zero backfill, zero invented rows.  Payroll / P&L / analytics / portal
                   SQL is unchanged byte for byte — every one already groups by location_id.
6  admin           add a zone -> its tag URI is rendered verbatim, same control as today.
                   In-app tag writing is NOT a prerequisite.  Adoption-by-serial is, and it
                   is one column.
```

⚠ **The one landmine is deployment order, not schema.** A second active zone in a building,
deployed before the zone-aware APK is on every phone, turns every intra-building zone tap
into `auto_closed = true` + a new shift. See §10.

---

## 1 · The data model

### Decided

```
locations ──1:N──> zones ──0:N──> shifts.start_zone_id / .end_zone_id   (nullable)
                    │
                    └── tag_serial   the ADOPTED-hardware exception, one nullable column
```

`zones` is a child of `locations`. There is **no `tags` table**.

**Why a zone row is also the tag record.** decision-5 already made hardware identity-free:
"if a tag is replaced, just write the same URI to the new tag — location ID is in the URL,
not the hardware." For a tag we wrote, the sticker has no identity worth a row: peeling it
off and writing an identical URI on a fresh NTAG213 changes nothing anywhere. A separate
`tags` table would therefore hold one row per zone, always, carrying no fact that the zone
does not already carry — the exact shape `001_init.sql` refuses ("a second column stating a
fact the first one already implies is a column that can drift out of agreement with it").

The one case where hardware *does* have identity is the adopted foreign tag, whose only
stable handle is its serial. That is one nullable column, not a table.

| Rejected | Why |
| --- | --- |
| **`tags` table under `zones`** | 1 row per zone forever, carrying nothing the zone lacks. Buys "two doors into one Stiege" and "this tag was replaced in March" — neither is asked for by any journey in `JOURNEYS.md`. Named as the upgrade path below rather than built now. |
| **Self-referencing `locations` tree (`parent_id`)** | Corrupts every per-building aggregate at once (`JOURNEYS.md` §7). A room would inherit `slug UNIQUE` globally, `lat/lng`, `client_id`, `monthly_contract_cents`, `target_minutes_per_month`, `geocode_status` and — worst — could be handed a `portal_grant`, i.e. a client link to a stairwell. Every existing `WHERE active` over `locations` would silently start returning rooms: `/roster`, the P&L building list, the map pin list, the buildings screen, the location select on the shift-correction drawer. Five screens break in a way that looks like data, not like an error. |
| **`tags` table INSTEAD of `zones`** (name the row after the hardware) | Removing a broken sticker would delete the place, and `shifts.start_zone_id` would dangle. A zone must exist before its tag is written (the director creates "Tiefgarage" in the drawer, *then* writes the sticker) — a `tags` table cannot hold a zone with no tag. |
| **Zone as a free-text column on `shifts`** | No list to render, no way to say "the Tiefgarage tag has not been tapped in 6 weeks", and typos become new zones. |

**ponytail:** no `tags` table, no zone hierarchy, no `sort_order`. Ceiling: one adopted
serial per zone; zones cannot nest; the zone list orders by `name`, so "Büro 2. OG" sorts
before "Eingang" rather than in walking order. Upgrade path, in order: (1) `sort_order
SMALLINT` when a director complains about the order — one column, one `ORDER BY`; (2) a
`tags` child table when a zone genuinely needs two serials or a replacement history.

### What happens to the five screens and every `shifts.location_id` query

**Nothing.** `shifts.location_id` stays `NOT NULL` and keeps its meaning. Measured against
the code, not assumed:

| Consumer | File | Change |
| --- | --- | --- |
| payroll + `/admin/data` | `lib/reporting.js:115-126` `GROUP BY s.location_id, s.worker_id` | none |
| P&L revenue | `lib/reporting.js:76-86` `GROUP BY c.location_id` | none |
| analytics trend | `lib/reporting.js:365-375` `GROUP BY l.id, b.month_start` | none |
| client portal | `routes/portal.js:110` `WHERE s.location_id = $1` | none — and a check must **pin** that zone never enters this payload (C2) |
| autoclose timer | `ops/sql/autoclose.sql` | none — it touches `end_time` / `auto_closed` only |
| shifts list | `routes/admin.js:265` `JOIN locations l ON l.id = s.location_id` | additive `LEFT JOIN zones` for a label |
| `/locations/`, `/clients/`, `/contracts/`, `/inventory/`, `/payroll/`, `/pl/`, `/analytics/`, `/shifts/` | `web/app/**` | additive only: a zone list on the building surface |

That is the argument for this shape in one line: **money never learns about zones.**

---

## 2 · What the tag URI carries

### Decided

The URI stays, byte for byte:

```
https://schimmer-glanz.exe.xyz/t?l=<uuid>
```

`l` stops meaning "location id" and means **"the id of the place that was tapped"**. From
now on that is a **zone** UUID. A **location** UUID stays valid for ever, because tags are
already on walls and a wall is a site visit.

Resolution is one query, and it returns exactly one row or refuses:

```sql
-- lib/validate.js: activeLocation() becomes activePlace()
SELECT z.id AS zone_id, z.name AS zone_name, l.id AS location_id, l.slug, l.name
  FROM zones z JOIN locations l ON l.id = z.location_id
 WHERE z.id = $1 AND z.active AND l.active
UNION ALL
SELECT NULL, NULL, l.id, l.slug, l.name
  FROM locations l
 WHERE l.id = $1 AND l.active;
```

- 0 rows → `422 unknown_location`. **Same error code as today**, deliberately: the shipped
  Android build maps `unknown_location` to `err_unknown_location`; a new code renders as
  "unknown status from a newer server" on every phone in the field.
- 1 row → the tap resolves to `(location_id, zone_id|NULL)`.
- \>1 row → refuse. Only reachable by a UUIDv4 collision across two tables. The branch is one
  line and it is the difference between a refusal and silently picking a building.

`zones.id` and `locations.id` are both `gen_random_uuid()`, so the two id spaces are disjoint
in practice and the query needs no type tag on the wire.

| Rejected | Why |
| --- | --- |
| **`/t?l=<location>&z=<zone>`** | +39 bytes (~64 B → ~103 B; NTAG213 has ~137 B usable, so it fits — that is not the objection). It encodes a fact the FK already holds, so a tag can be *internally inconsistent* — zone from building A, location from building B — on hardware that is deliberately unlocked and attacker-writable (decision-15). That is a new reconciliation branch at a trust boundary, bought for nothing. |
| **`/t?z=<zone>`, a new parameter** | Two parameters to parse, two code paths in `TagLink` on two platforms, and every already-written tag becomes the legacy path. The shipped APK would reject `?z=` outright (`queryValue(rawQuery, "l")` returns null → `locationId` null → not our tag), so no zone tag could be deployed until a Play release reached every phone. Keeping `l` means **a zone tag written tomorrow is accepted by the build already on the workers' phones.** |
| **Zone UUID replaces the location UUID everywhere** (location UUIDs stop resolving) | Every tag on a wall dies at the moment of the migration, including the one that pays the only live building. |

### Migration path for the ONE deployed tag

```
today   serial 04:A1:A8:52:AE:5C:80  (foreign, application/ase.mobile, NO URL, 46 B capacity)
        -> KnownTags.BY_SERIAL (compiled into the APK)
        -> location c3c37d4a-ca0a-42c5-b248-9704b9907ec7
        -> ScanActivity synthesises https://…/t?l=c3c37d4a-… -> ACTION_VIEW
after   IDENTICAL.  The synthesised URI carries a LOCATION uuid, branch 2 of the resolver
        matches it, the shift opens against HOIV with start_zone_id = NULL.
```

**Zero action at the wall. Zero Play releases. Zero rows created by the migration.** The
adopted tag keeps working unchanged, and `start_zone_id IS NULL` is the honest record of what
happened: a building-level tag was tapped and nobody knows which door it is on.

When the director later wants that tag to name a zone, they create the zone (e.g.
`Haupteingang`) and move the serial onto it via the admin panel — see §6. That is a fact a
human entered, not a fact a migration invented.

---

## 3 · What a shift attaches to

### Decided: the BUILDING. Zones are where the tap happened, never what the shift is billed to.

```sql
shifts.location_id    UUID NOT NULL   -- unchanged, authoritative, what payroll reads
shifts.start_zone_id  UUID NULL       -- the zone whose tag opened it   (tap fact)
shifts.end_zone_id    UUID NULL       -- the zone whose tag closed it   (tap fact)
```

Both nullable, both meaning *"a building-level tag was tapped, or this shift predates zones"*.
Neither is ever an input to money. Same standing as `material_requests.location_id`, which
`005` labels "context only, never a cost split" (decision-6).

### The tap rule

```
resolve tapped place -> (building B, zone Z|NULL)

no open shift                 -> open at B, start_zone_id = Z
open shift, same building B   -> CLOSE it, end_zone_id = Z, auto_closed = false
open shift, different building-> close old with auto_closed = true, open new  (unchanged, W6)
```

**Any zone of the same building closes the shift.** A cleaner who enters through Eingang and
leaves through the Tiefgarage taps whatever is nearest on the way out.

### Why not one shift per zone

Because it produces a payroll row per room, and three other things break with it:

- the client portal (C2) shows one row per cleaning: `{date, first name, minutes}`. Per-zone
  shifts turn one visit into five rows and quietly export our internal building structure to
  an outsider. The portal payload is fixed and must not grow.
- the 2000-row window (`SHIFT_PAGE_MAX`) shrinks by the zone factor — ~10 weeks of history
  becomes ~2 at five zones.
- it needs 2N taps per visit instead of 2. The #1 and #2 journeys by frequency×pain are clock
  out and clock in, and INCIDENT 1 was a worker who could not make his *second* tap. Any
  design that raises the required tap count is worse against the two journeys that matter
  most.

### The trade inside the tap rule, stated honestly

A zone tag *looks* like something you tap as you go. Under this rule, a worker who taps
`Stiege 1` mid-shift to "log" it **ends the shift**.

| | (i) any zone of the building closes — CHOSEN | (ii) only the opening zone closes |
| --- | --- | --- |
| mid-shift "log" tap | ⚠ ends the shift early | ✓ ignored / recorded |
| clocking out at a different door | ✓ works | ✗ must walk back to the opening tag |
| worst case | a short shift + a second shift; both visible, D corrects (D6) | **no reachable way out** — INCIDENT 1, an 8 h phantom shift + a hand correction |

The asymmetry decides it: an early close is a *recoverable* error with a full audit trail; an
unclockable-out worker is the highest-pain failure in the system. Chosen: (i).

Two obligations follow, and they are not optional:

1. the running screen must state, in words, what the next tap does — „Der nächste
   Tag-Kontakt in diesem Objekt – egal welcher – beendet die Schicht." de/en key parity.
2. **zones are opt-in per building.** A building with zero zones behaves exactly as today.
   Nobody gets a second tag on a wall until they have asked for one.

### Rejected: a `shift_zone_visits` child table (one row per zone tap, shift stays one row)

It is the only shape that yields honest per-zone *duration*, which is what D8 ("which part of
this building eats the hours") actually wants. Rejected because it requires the worker to tap
at every zone boundary, and it re-introduces the ambiguity the tap ritual exists to avoid: a
tap on the entry zone at the end of a visit is indistinguishable from a move back to it. We
would be guessing about paid time. Recorded as the upgrade path if per-zone duration is ever
worth the extra taps — the schema below does not block it.

∴ **D8 gets a diagnosis by tag activity, not by duration:** "the Tiefgarage tag has not been
tapped since 14 May" is answerable; "the Tiefgarage costs €180/month" is not, and this design
refuses to pretend otherwise.

---

## 4 · Optional properties per zone

| Column | Kept? | Which journey reads it |
| --- | --- | --- |
| `name` | ✓ required | D1 (create), D4/map panel (zone list), W4 (the running screen names the place), D2 |
| `active` | ✓ required | project rule: soft deactivation only, nothing destroys history |
| `note TEXT NULL` | ✓ | D2 + W10. Where the tag physically is — "hinter der Tür links, hüfthoch". Today that fact lives in a head, and "the tap did nothing" starts with "which wall is it on". Rendered on the zone-list sub-line in the building panel; a field nothing renders does not ship. |
| `tag_serial TEXT NULL` | ✓ | D2 Case B. Turns adopting a foreign tag from a Play release into an admin action (`KnownTags.kt`'s own stated upgrade path). |
| `tag_deployed_at TIMESTAMPTZ NULL` | ✓ | D2 + §9.6 of `JOURNEYS.md`. **Not derivable.** "A tag is on this wall but nobody has tapped it yet" and "there is no tag" are different states, and today's only proxy — "active building with zero recorded shifts" — conflates them. |
| `square_metres` | ✗ **rejected** | No journey. Worse: a per-zone area immediately invites a per-zone target and a per-zone cost, which §3 has just established this system cannot measure. Rejecting it is the load-bearing signal that a zone is not a costing unit. |
| `floor` | ✗ rejected | It is part of the name — "Büro 2. OG". Two columns for one label. |
| `sort_order` | ✗ rejected for now | `ORDER BY name` is deterministic and readable. Upgrade path named in §1. |
| `last_tapped_at` | ✗ rejected | Derivable: `MAX(start_time)` over `start_zone_id`/`end_zone_id`. `005` is explicit that derivable facts are not stored, because a stored copy drifts. |
| `is_default` | ✗ rejected | Only needed if the migration invents a zone per building. It does not (§5). |

---

## 5 · Backward compatibility — four months of zone-less history

**The migration creates zero rows and backfills nothing.**

```
existing shifts        start_zone_id = NULL, end_zone_id = NULL, location_id unchanged
existing locations     unchanged; a building with no zones behaves exactly as today
existing tag           resolves via branch 2 of the resolver; no action at the wall
payroll / P&L / analytics / portal / autoclose SQL     unchanged, byte for byte
```

`start_zone_id IS NULL` reads as **"a building-level tag, or before zones existed"** — one
predicate, no third flag, in the style `001` set for `unresolved ⇔ auto_closed AND
corrected_at IS NULL`.

**Rejected: backfill a "Hauptzone"/"Eingang" per building and point old shifts at it.** It
asserts a tap that never happened. Nobody knows which door the HOIV tag is on; a row that
says `Eingang` would be a fabricated measurement sitting in a payroll database, and the map
panel would then report "Eingang: 47 Reinigungen" about a zone that was invented by a
migration. `005_v2_features.sql` already refused the same move for contracts: it backfills
only buildings that carry a price, because "inventing a EUR 0 contract … would turn 'unknown'
into '100% loss'".

Where a zone label is absent, screens say so in words — `zoneNone` „Gebäude-Tag (keine Zone)"
— never a blank cell and never an invented name. Colour is the second signal.

---

## 6 · The admin journey: add a zone, get a tag onto that wall

```
building panel (map) ──> „Zone hinzufügen"  name + optional note
   │
   ├── OUR OWN TAG      the zone's URI rendered verbatim in a code-block + one-click copy
   │                    + the UUID printed underneath          ← identical control to today's
   │                    write it with NFC Tools, DO NOT LOCK (decision-15)
   │                    mark „Tag angebracht" -> tag_deployed_at
   │
   └── ADOPTED TAG      worker/director opens the app -> Scan -> holds phone to the tag
                        -> ScanActivity prints the UID -> type it into the zone form
                        -> zones.tag_serial -> /roster -> resolved on every phone
                        NO APK, NO Play release
```

The building-tag URI control on `/locations/` is described in `REDESIGN-INVENTORY.md` §5 as
"the single most load-bearing control on the screen". The zone control is **the same control,
repeated per zone** — same `tagExplainer`, same verbatim `code-block`, same copy button, same
`uuidLabel`. Not a new pattern.

### Is in-app tag writing a prerequisite for zones? **No.**

- A zone tag mis-written as *another zone of the same building* costs nothing measurable: the
  shift is billed to the building either way (§3). Only the label is wrong.
- A tag written with the **wrong building** is the expensive error, and it is exactly as
  expensive today as it is with zones. Zones do not raise the blast radius.
- Zones raise the **volume**: 1 URI per building becomes N. Hand-copying five 60-character
  URIs into NFC Tools per building is where a wrong sticker gets made.

∴ **not a blocker; strongly recommended before the 4th building**, and the cheaper half of
D2 — adoption by serial — is a single column and lands with this migration.

### Two things the admin surface must state, because zones make them worse

- **the verification tap is an undeletable payroll row** (D1 step 9). `ScanActivity.onTag`
  converges into `ACTION_VIEW`, so a successful diagnostic read *creates a shift*. With N
  zones that is N test shifts per building, and there is no `DELETE /admin/shifts/:id`
  anywhere. Either a read-only "verify this tag" mode lands first, or the admin copy tells
  the director that the test tap must be corrected afterwards. Do not let this be discovered.
- **adding a second active zone to a building is gated on the APK** (§10).

---

## 7 · Migration sketch — `server/db/migrations/006_zones.sql`, NOT APPLIED

Written here, not as a file. It obeys the house rules: additive only, every new column
NULLable or DEFAULTed, **no `BEGIN`/`COMMIT`** (`migrate.js` runs each file with `psql -1`),
`001`–`005` untouched.

```sql
-- 006_zones.sql — a building holds several cleanable areas, each able to carry its own tag.
--
-- WHAT A ZONE IS: a place inside a building that gets cleaned and can carry a tag —
-- Eingang, Stiege 1-3, Tiefgarage, Büro 2. OG.
-- WHAT A ZONE IS NOT: a costing unit. A shift is billed to the BUILDING (decision-29).
-- shifts.location_id keeps its meaning and stays NOT NULL; payroll, the P&L, the analytics
-- trend and the client portal do not learn about this table.
--
-- NO tags table. decision-5 already made our own tags identity-free: replacing a sticker
-- means writing the same URI to a new one. The only hardware with an identity worth storing
-- is an ADOPTED third-party tag, whose sole stable handle is its serial — one column below.
--
-- NO BACKFILL, ZERO ROWS CREATED. Every existing shift keeps start_zone_id NULL, which is
-- the honest record of "a building-level tag was tapped, or this predates zones". Inventing
-- a default zone would assert a tap that never happened (cf. 005's contract backfill, which
-- deliberately skips buildings with no price).
--
-- ADDITIVE ONLY. 001-005 are applied on the live box with real shifts in them and are not
-- editable (db/README.md). NO BEGIN/COMMIT — migrate.js runs each file with `psql -1`.

CREATE TABLE zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     UUID NOT NULL REFERENCES locations(id),
  name            TEXT NOT NULL CHECK (btrim(name) <> ''),
  note            TEXT,                    -- where the tag physically is. D2/W10 read it.

  -- ADOPTED HARDWARE ONLY. A tag we wrote has no row here: it carries this zone's id in its
  -- URL. This column exists because the tag at HOIV holds no URL at all and cannot be
  -- rewritten (46 B capacity, our URI needs ~64 B), so its serial is the only handle it has.
  -- A SERIAL IS NOT A CREDENTIAL (decision-15, KnownTags.kt): it is broadcast in the clear
  -- and is clonable. The server still resolves the place and still derives the worker from
  -- the session. Nothing may ever authenticate on this value.
  -- Format is the normalised form KnownTags already prints: uppercase hex, colon-separated.
  tag_serial      TEXT CHECK (tag_serial ~ '^[0-9A-F]{2}(:[0-9A-F]{2})+$'),

  -- NOT DERIVABLE, which is why it is stored. "a tag is on this wall, never yet tapped" and
  -- "there is no tag on this wall" are different states; today's only proxy is "active
  -- building with zero shifts", which conflates them. Last-tap time is NOT stored — that one
  -- IS derivable, from shifts.
  tag_deployed_at TIMESTAMPTZ,

  active          BOOLEAN NOT NULL DEFAULT true,   -- soft only; nothing destroys history
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "the zones of this building" — the building panel, the roster payload, and the only way
-- a deactivation guard can see what it is about to orphan.
CREATE INDEX zones_location_id_idx ON zones (location_id);

-- One live "Eingang" per building. Partial, so deactivated zones pile up freely as history
-- and a name can be reused after a zone is retired. Same shape as
-- portal_grants_one_live_idx and location_contracts_one_current_idx.
CREATE UNIQUE INDEX zones_one_live_name_idx
  ON zones (location_id, lower(btrim(name))) WHERE active;

-- A physical tag is in exactly one place. Two zones claiming one serial is a data error, not
-- a tie to be broken at tap time.
CREATE UNIQUE INDEX zones_tag_serial_idx ON zones (tag_serial) WHERE tag_serial IS NOT NULL;

-- Needed by the composite FKs below, so that a shift can never name a zone that belongs to
-- a different building. (id) is already unique; this pair is what the FK references.
ALTER TABLE zones ADD CONSTRAINT zones_id_location_key UNIQUE (id, location_id);

-- ---------------------------------------------------------------------------
-- shifts — two TAP FACTS, nullable, never an input to money.
--
--   start_zone_id  the zone whose tag opened this shift
--   end_zone_id    the zone whose tag closed it
--
-- NULL = a building-level tag was tapped, or the shift predates zones. One predicate, no
-- third flag (001's rule).
--
-- These are CONTEXT, exactly like material_requests.location_id under decision-6: they
-- answer "is the Tiefgarage tag alive", "which door do people actually use" and "did this
-- tap arrive at all". They do NOT carry duration and MUST NOT become a cost attribution —
-- per-zone duration would need a tap at every zone boundary, and that is a different
-- decision with a real cost at the door.
--
-- COMPOSITE FKs, MATCH SIMPLE: with location_id NOT NULL and the zone column NULLable, the
-- constraint is simply not checked while the zone is NULL, and is fully checked once it is
-- set. So the database itself guarantees a shift never names another building's zone.
-- CONSEQUENCE FOR PATCH /admin/shifts/:id: changing a shift's location_id must CLEAR both
-- zone columns in the same statement, or the update raises 23503. Clearing is also correct —
-- a human re-pointing the shift is saying the tap record was wrong.
-- ---------------------------------------------------------------------------
ALTER TABLE shifts
  ADD COLUMN start_zone_id UUID,
  ADD COLUMN end_zone_id   UUID,
  ADD CONSTRAINT shifts_start_zone_fk
    FOREIGN KEY (start_zone_id, location_id) REFERENCES zones (id, location_id),
  ADD CONSTRAINT shifts_end_zone_fk
    FOREIGN KEY (end_zone_id, location_id)   REFERENCES zones (id, location_id);

-- "when was this tag last tapped" — the zone list in the building panel, one row per zone.
-- Partial: the column is NULL for all existing history and for every building-level tag, so
-- the index stays the size of the zoned shifts and not the size of the table.
CREATE INDEX shifts_start_zone_idx ON shifts (start_zone_id, start_time DESC)
  WHERE start_zone_id IS NOT NULL;
```

Nothing else changes. No column is dropped, no column changes type, no existing index is
rebuilt. Applying this to a live database is an `ALTER TABLE … ADD COLUMN` with no default
and two `ADD CONSTRAINT`s that validate against zero matching rows — brief locks, no rewrite.

**Down-migration: none**, per `db/README.md`. Reversal is a new numbered file.

---

## 8 · API surface

### Worker-facing (`server/routes/app.js`) — the shipped APK must keep working

| Route | Change | Compatible with the build in the field? |
| --- | --- | --- |
| `GET /roster` | add a **flat** `zones: [{id, location_id, name, tag_serial}]` array beside `locations` | ✓ `Api.kt:82` reads `getJSONArray("locations")` and ignores everything else |
| `POST /shifts/open` | `location_uuid` **keeps its name**; its value may now be a zone UUID. Server resolves → stores `location_id` + `start_zone_id` | ✓ the field name is unchanged and the shipped app sends whatever the tag carried |
| `POST /shifts/close` | new **optional** `location_uuid` = the place that was tapped → `end_zone_id`. If it resolves to a different building → `422 wrong_building` | ✓ the shipped app never sends it, so it never sees the new code |
| `GET /shifts/open`, `/shifts/recent`, `/shifts/unresolved` | add `zone_name` (nullable) beside the existing `location_name` | ✓ additive |
| `POST /material-requests` | unchanged — stays building-level (decision-6) | ✓ |

`lib/validate.js: activeLocation()` becomes `activePlace()` and returns
`{location_id, zone_id|null, …}` (§2). Every existing caller that wants only a building keeps
reading `location_id`. **The error code stays `unknown_location`.**

**ponytail:** `location_uuid` now carries a zone id, so the field name is a lie. Ceiling
named: it is the cheapest correct thing while one APK is in the field and there is no way to
force an update. Upgrade path: accept `place_uuid` as the preferred name once both clients
send it, and keep `location_uuid` accepted for ever.

### Admin (`server/routes/admin.js`) — same patterns as `locations`

```
GET    /admin/data                zones[] joins the snapshot (+ last_tap_at, derived)
POST   /admin/zones               upsert {id?, location_id, name, note, tag_serial,
                                          tag_deployed_at}   409 on duplicate live name
                                                             409 on a serial already claimed
DELETE /admin/zones/:id           SOFT deactivate. Never deletes. History keeps its FK.
PATCH  /admin/shifts/:id          must CLEAR start_zone_id/end_zone_id when location_id
                                  changes (§7)
DELETE /admin/locations/:id       deactivating a building must also deactivate its zones —
                                  an active zone under an inactive building is unresolvable
                                  by the tap query and would look like a dead tag
```

### Portal (`server/routes/portal.js`) — **unchanged, and pinned**

The payload stays `{date, first name, minutes}`. A zone name is internal building structure
and an outsider has no business receiving it. This needs a *check*, not a promise — the same
posture as `check-api.js`'s redaction assertions.

### Android

The only behavioural change is the switch rule, and it is the reason for §10:

```kotlin
// TimeSheetViewModel.writeTap — today: running.locationId == locationId
// becomes:            buildingOf(tappedPlaceId) == running.locationId   -> close
// where buildingOf() reads the CACHED roster (zone -> location_id), because a stairwell
// has no signal and a cache miss may never block a clock-in.
```

`KnownTags.BY_SERIAL` stays as a compiled last-resort fallback for the one live tag — a fresh
install with no network must still work at HOIV — with roster-supplied serials taking
priority. Ceiling: the compiled entry is deleted once that zone carries the serial and every
phone has cached a roster.

---

## 9 · What breaks if we get this wrong

Ordered by cost of the mistake, worst first.

| # | Mistake | What it costs | Recoverable? |
| --- | --- | --- | --- |
| 1 | **A second active zone deployed before the zone-aware APK is on every phone** | the shipped build compares raw tag ids, so an intra-building zone tap reads as a *building switch*: `auto_closed = true`, a new shift, and the old one is `notPayable` until resolved. A five-zone building generates a flood of unresolved shifts and unpaid work — INCIDENT 7 at scale | yes, by hand, per shift. §10 is the mitigation |
| 2 | **The tag URI changes shape** (`?z=`, or dropping location-UUID resolution) | every tag on a wall is revisited. Today that is one building; from next week it is every client. `decision-15` calls the hostname the only irreversible choice in the architecture — the id space in `l` is the second | ✗ only by a site visit |
| 3 | **A shift per zone** | payroll becomes a row per room; the client portal exports our internal building structure; the 2000-row window shrinks by the zone factor; 2N taps per visit against the two highest-pain journeys | ✗ not without re-aggregating history |
| 4 | **`shifts.zone_id NOT NULL`** | four months of history cannot be represented without inventing which door was tapped. A fabricated measurement in a payroll database | ✗ the fake rows become indistinguishable from real ones |
| 5 | **Zone names reach the client portal** | an outsider learns the building's internal structure; C2's payload is `{date, first name, minutes}` and its minimality *is* the GDPR argument on the route | ✗ once sent, it is sent |
| 6 | **Per-zone m² / targets / cost split** | a P&L with per-zone numbers nobody can defend, derived from durations this system does not measure. Contradicts decision-6's reasoning about attribution | yes, but only after someone has already made a business decision on it |
| 7 | **Composite FK omitted** | a shift can name a zone in another building; the building panel then lists a zone from building B under building A, and it looks like data | yes, cheaply, if caught |
| 8 | **Zones deleted rather than deactivated** | `shifts.start_zone_id` dangles or history is destroyed. Violates the standing rule | ✗ |
| 9 | **`tag_serial` used to authenticate** | a serial is broadcast in the clear and clonable. decision-15 and `KnownTags.kt` both say so; a serial must never authenticate anything | — must never happen |
| 10 | **Buildings silently gain a default zone** | every building's panel claims a zone that nobody named and no tag exists for; "which walls have tags" gets *less* trustworthy, not more | yes, delete the rows — if noticed |
| 11 | **`last_tapped_at` stored on the zone** | a cached copy of a derivable fact, which drifts (the `needs_correction` lesson, `001`) | yes |

---

## 10 · Deployment order — the only hard sequencing constraint

```
1  apply 006_zones.sql                         zero rows created, nothing changes behaviour
2  server: activePlace() resolver + roster.zones + admin CRUD    zone tags now RESOLVE
3  admin: zone list + per-zone URI on the building panel         director can create zones
4  Android: buildingOf() switch rule + zone name on the running screen   -> PLAY RELEASE
5  CONFIRM every worker phone is on that build                   (P1: no way to force it)
6  ONLY NOW put a second physical tag in any building
```

Steps 1–3 are safe at any time: with zero zone rows, every code path is today's code path.
**Step 6 before step 5 is failure mode #1.** Until step 5 the admin surface must say so —
a building with one zone (or none) is safe on every build; a second zone is not.

`ops/`-side: no new systemd unit, no new timer, no new dependency (still `pg` +
`@sentry/node`).

---

## 11 · What this design deliberately does not do

- **no per-zone duration.** §3. "The Tiefgarage tag has not been tapped since 14 May" is
  answerable; "the Tiefgarage costs €180/month" is not.
- **no zone-level contract, target, revenue or margin.** Money stays at the building.
- **no worker↔zone assignment.** There is no worker↔building assignment either (`JOURNEYS.md`
  §6); zones do not create one and must not be mistaken for one.
- **no zone in the client portal.** Ever.
- **no nested zones.** A zone has exactly one parent building and no children.
- **no in-app tag writing.** §6 — related, valuable, separately tracked, not a prerequisite.
- **no change to the 8 h auto-close, the resolution flow or decision-10.** Zones are
  invisible to the timer.

---

## 12 · What did NOT happen in producing this document

- **Production was not touched.** No SSH, no query, no deploy, no write of any kind.
- **No application code changed.** Nothing under `web/`, `server/`, `android/`,
  `NFCTimeSheets/`, `ops/`. The migration in §7 exists only inside this file.
- **Nothing was committed.**
- **The migration was not run**, not even against `nfc_demo`. The SQL is unvalidated by
  execution; it is written to the conventions of `001`–`005` and read against them, and
  `psql -1 --dry-run` does not exist, so the first real check is applying it on a scratch DB.
- **The map PoC was not re-run.** Its multi-tag shape is `INVENTED` by its own README, and
  this design departs from it in one important way: the PoC attaches a *shift to a tag*
  (`shifts.tagId`), which §3 rejects.
- **decision-29 is PROPOSED, not accepted.** The owner accepts decisions.
