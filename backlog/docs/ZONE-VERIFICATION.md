# ZONE-VERIFICATION — a zone goes live when a human proves the card, not when an admin types a name

Status: **the SERVER half is BUILT, DEPLOYED and PROVED on the live box (2026-08-22). The
admin screens and the Android build are NOT.** §4.1's SQL stopped being a sketch: it is
`server/db/migrations/010_zone_verification.sql`, applied to production after the leftover
`test` zone was deleted (backup `nfc-20260822T125655Z.sql.gz`, restore-tested first).

```
DONE   §1 the leftover 'test' zone      deleted; production is 1 building, 0 zones, 0 shifts
DONE   §2 resolve-building              route, handler, web caller and radio all DELETED
DONE   §4 migration 010                 applied; zero rows created, zero updated
DONE   §3 the gate                      422 zone_unverified, OPEN only, never CLOSE
DONE   §6 the test scan                 GET /operator/zones + POST /operator/zones/:id/verify
DONE   §6.3 the /roster CASE            row published, serial NULLed until verified
DONE   §5 the HOIV grandfather          5 mutants RED in ops/check-hoiv-survives-006.mjs
DONE   §8 C1-C13, C15(server side)      + a live proof, ops/prove-zone-verification.sh

TODO   §6.4 the phone: MODE_VERIFY      no APK built; NFC never works on an emulator
TODO   §7.1 err_zone_unverified         de/en strings + zone_unverified made RETRYABLE
                                        (an OLD APK degrades to err_rejected today: a
                                        sentence, still no shift, but TERMINAL for a queued
                                        offline tap — see the warning in §9)
TODO   §7.2 the director's screens      „Wartet auf Testscan", the Zonen-cell counts, and
                                        deleting `zonesTestTapWarning`, which stopped being
                                        true the moment the test scan shipped
TODO   §8 C14, C16, C17                 the phone's retryability, the rendered admin state,
                                        the release artefact
```

⚠ **§9's warning is now the live operational rule**: the server is at step 3 and the phone is
not at step 5, so **do not create a zone at a building where anyone is working** until the APK
ships. Production has zero workers, so nothing is at risk today.

Normative record: `backlog/decisions/decision-47`. That record is what is binding; this
document is the design it points at — the state machine, the wire shapes, every check and
its seeded RED case.

Read, not assumed, in producing this: `backlog/decisions/decision-43`, `decision-44`,
`decision-45`; `server/db/migrations/006_zones_revenue_rates.sql` and `008_reported_tags.sql`
(headers in full); `server/db/README.md`; `server/lib/validate.js` (`activeLocation`,
`activePlace` and its comment); `server/lib/reporting.js` (`areaByLocation`, `ZONE_STATE`);
`server/routes/admin.js` (`upsertZone`, `deleteZone`, `resolveTagToBuilding`,
`resolveTagToZone`, `resolveTagToExistingZone`, `upsertLocation`, `/admin/data`);
`server/routes/app.js` (`roster`, `openShift`, `closeShift`); `server/routes/operator.js`;
`web/app/tags/page.tsx`; `web/app/locations/page.tsx` (the tag-disclosure block);
`web/lib/api.ts`; `web/messages/de.json`; `android/…/nfc/ScanActivity.kt`,
`WriteTagActivity.kt`, `KnownTags.kt`; `android/…/core/ApiFailure.kt`, `Zones.kt`,
`SyncPlan.kt`; `android/…/data/ShiftStore.kt`, `ShiftSync.kt`;
`backlog/docs/CORE-FLOW.md`; `backlog/docs/ZONES-MODEL.md` §3–§5.

---

## 0 · One screen

```
TODAY                                       AFTER
a reported card can become a NEW BUILDING   it cannot. Buildings are created tag-free,
  (a second direct-tap surface, for ever)     then the card becomes their FIRST ZONE
a zone is LIVE the moment it is typed       a zone is live when an OPERATOR, in the field,
                                              with the card in hand, has test-scanned it
a test tap costs one undeletable shift      a test scan posts NO shift and cannot: it runs
                                              on an operator session, and no shift route
                                              accepts one
HOIV's building card                        UNCHANGED. FOR EVER. Not deprecated.
```

Four things, and only the first three change any behaviour:

```
1  RETIRE minting a NEW building-level tag       delete POST /admin/tags/:id/resolve-building
2  THE GATE                                      zones.verified_at + one refusal at clock-in
3  THE TEST SCAN                                 GET /operator/zones + POST /operator/zones/:id/verify
4  GRANDFATHER HOIV                              by doing nothing to the building branch — §5
```

---

## 1 · What production actually is, read this run

```
$ ssh schimmer-glanz.exe.xyz  sudo -u postgres psql -d nfc …           2026-08-22

locations  c3c37d4a-ca0a-42c5-b248-9704b9907ec7 | HOIV | active = t
zones      c9d4036d-bf75-4cde-bde8-200a046843ef | HOIV | 'test' | active = t
                                       tag_serial NULL · tag_deployed_at NULL
                                       created 2026-08-21 15:21:35+00
shifts 0 · workers 0 · reported_tags 0 · tag_aliases 0 · operators 0
schema_migrations  001 … 009_phone_pending.sql            -> next free number is 010
```

Two facts do the work in every section below.

**a. That `test` zone is the defect, standing up, in production.** `active = true`,
`verified_at` does not exist yet, so it is *already a valid clock-in target* — and its uuid is
on no wall anywhere. Nothing proved it, nothing could have. It is a previous run's test litter.
**It is deleted before 010 is applied**, as an ops step, not by the migration: a migration does
not get to delete somebody's rows any more than 006 got to invent somebody's wage.

**b. Zero real zones exist. ∴ there is no backfill dilemma and 010 must not invent one.** No
`UPDATE zones SET verified_at = …`, no guard, no exemption, no "grandfather existing zones"
clause. The column lands NULL everywhere and nothing anywhere is stranded, because there is
nothing to strand.

---

## 2 · Retiring the NEW building-level tag

### 2.1 What exists today, and why it must stop

`POST /admin/tags/:id/resolve-building` (`server/routes/admin.js`) takes a card an operator
wrote in the field and makes it a **building** whose primary key IS the card's id. From that
moment the card is a direct tap surface for a whole building, for ever, and no zone was ever
created. `web/app/tags/page.tsx` offers it as the first of three radios („Neues Gebäude"), on a
screen its own header calls "DELIBERATELY THE PLAINEST POSSIBLE SCREEN … It exists to prove the
WRITE → REPORT → RESOLVE flow end to end on a real admin session, not to be a finished screen."

The owner's sentence — "there should be building as an entity where zones can be created" —
retires exactly this, and nothing else.

### 2.2 The replacement, and the confirmation that it already works

**`POST /admin/locations` is genuinely tag-free today. Confirmed by reading it, not assumed:**
`upsertLocation` takes `slug, name, address, lat, lng, active, client_id, contact_id,
monthly_contract_cents, target_minutes_per_month`. The row's `id` is generated by the database
(`INSERT INTO locations (slug, name, …)` — the id is not in the column list), so, in that
route's own words, *"it is never chosen by the caller, so a location cannot be given a
guessable identifier by hand."* No tag, no tag URI, no NDEF anything on that path. `/locations/`
already renders the building-level URI only inside a collapsed, read-only
„**Gebäude-Tag (Bestand)**" disclosure (decision-43 §7), which stays exactly as it is.

```
FIELD VISIT discovers a building nobody has in the system
  1  operator writes a card and reports it              (unchanged)
  2  admin creates the BUILDING                POST /admin/locations           TAG-FREE
  3  admin resolves the reported card into
     that building's FIRST ZONE                POST /admin/tags/:id/resolve-zone
                                               -> zone, id = the card's id, UNVERIFIED
  4  operator test-scans the card in the field -> the zone is live
```

Step 3 is `resolveTagToZone`, which already exists and already stamps `tag_deployed_at` from the
REPORT time rather than from the admin's desk time. Nothing new is built for the replacement.

### 2.3 DELETE, not "importable-only"

**Deleted:** the handler `resolveTagToBuilding`, its entry in `adminRoutes`,
`resolveTagToBuilding` in `web/lib/api.ts`, the „Neues Gebäude" radio and its `name`/`slug`
fields in `web/app/tags/page.tsx`, and the `'building'` arm of that screen's `Action` union.

**Why not keep it importable for a future need.** There is no future need:

- The one thing it produces — a building whose id is a card's id — is precisely what is being
  retired.
- The one building-level tap that must keep working needs **no route at all**. Its row already
  exists; `activePlace`'s building branch already answers it; deleting a *creation* route
  cannot touch a *resolution* path. (§5 proves this rather than asserting it.)
- A retired handler that still compiles is a handler a later reader finds, assumes is
  supported, and re-wires. The id space is shared, so that re-wiring is invisible until a card
  is on a wall, and then it is permanent.

If it ever comes back, it comes back through a decision record.

**What replaces the radio on `/tags/`** — nothing true is deleted, the capability is named where
it now lives:

```
Aktion:  ( ) Neue Zone in bestehendem Gebäude
         ( ) Bestehende Zone (zweiter Tag)

  Ein NEUES Gebäude wird zuerst unter „Objekte" angelegt — ohne Tag.
  Danach kann dieser Tag hier als erste Zone darin zugeordnet werden.
```

### 2.4 Nothing on a phone changes for this part

`/usr/bin/grep -rn "resolve-building" android/` → no hits. The Android and operator sides never
called this route. No APK is needed for §2.

---

## 3 · The state machines, exactly

### 3.1 The physical card

```
    (nothing)
        │  operator: WriteTagActivity mints a UUIDv4 on the phone, writes the NDEF URI,
        │  reads it back and compares byte for byte.        [existing, UNCHANGED]
        ▼
   ┌──────────┐
   │ WRITTEN  │  on the card only. The server has never heard of this id.
   └────┬─────┘
        │  POST /operator/tags {id}                          [existing, UNCHANGED]
        ▼
   ┌──────────────────┐   a cleaner's tap here -> 422 tag_unbound, NO shift, its own German
   │ REPORTED/UNBOUND │   sentence. (existing, UNCHANGED — CORE-FLOW.md §4 step 7)
   └────┬─────────────┘
        │
        ├─ POST /admin/tags/:id/resolve-zone           -> a NEW zone, id = the card's id
        ├─ POST /admin/tags/:id/resolve-existing-zone  -> tag_aliases row onto an existing zone
        └─ POST /admin/tags/:id/resolve-building       ✗ DELETED (decision-47)
        ▼
   ┌──────────┐
   │ RESOLVED │  reported_tags.resolved_at stamped. The card now names a ZONE.
   └────┬─────┘   Continue in §3.2.
        │
        └─ every one of these transitions is UNCHANGED from 008 except the deleted arrow.
```

### 3.2 The zone — the new machine

```
                  admin: POST /admin/zones            admin: POST /admin/tags/:id/resolve-zone
                  (typed by hand, no card yet)        (a card exists and was reported)
                             │                                     │
                             └──────────────┬──────────────────────┘
                                            ▼
                    ┌───────────────────────────────────────────────┐
                    │  CREATED                                      │
                    │    active      = true      (006 default)      │
                    │    verified_at = NULL      (010, no default)  │
                    │                                               │
                    │  ── NOT a clock-in target ──                  │
                    │  a tap  -> 422 zone_unverified, NO shift row  │
                    │  a CLOSE tap of an already-open shift at this │
                    │    building -> CLOSES NORMALLY (never gated)  │
                    │  in /roster: the ROW is published,            │
                    │              tag_serial is NULLed             │
                    │  in the admin: „Wartet auf Testscan"          │
                    └───────────────┬───────────────────────────────┘
                                    │
                                    │  OPERATOR, IN THE BUILDING, CARD IN HAND
                                    │    GET  /operator/zones                (the worklist)
                                    │    scan the card -> place_uuid
                                    │    POST /operator/zones/:id/verify {place_uuid}
                                    │      server: v.activePlace(place_uuid)  ← THE REAL PATH
                                    │      require place.zone_id === :id
                                    │
                                    │  refused, and NOTHING is stamped, when:
                                    │    the card names another zone   -> 422 zone_mismatch
                                    │    the card names a BUILDING     -> 422 zone_mismatch
                                    │    the card is unresolved        -> 422 tag_unbound
                                    │    the card is not ours          -> 422 unknown_location
                                    ▼
                    ┌───────────────────────────────────────────────┐
                    │  VERIFIED                                     │
                    │    active      = true                         │
                    │    verified_at = <when>                       │
                    │    verified_by_operator_id = <who>            │
                    │                                               │
                    │  ── a live clock-in target ──                 │
                    │  a re-scan is IDEMPOTENT: it answers what the │
                    │  card resolved to and stamps nothing new      │
                    └───────────────┬───────────────────────────────┘
                                    │  DELETE /admin/zones/:id   (soft, existing)
                                    │  or the building is deactivated
                                    ▼
                    ┌───────────────────────────────────────────────┐
                    │  RETIRED                                      │
                    │    active = false · verified_at KEPT          │
                    │  not a clock-in target (activePlace needs     │
                    │  z.active — unchanged)                        │
                    └───────────────┬───────────────────────────────┘
                                    │  POST /admin/zones {id, active: true}
                                    ▼   back to VERIFIED. verified_at is NOT cleared.
```

**`verified_at` is never cleared, by any route, ever.** It is a historical fact. Clearing it on
reactivation would silently make a working door untappable, which nobody asked for. *ponytail:*
CEILING — "this zone's card was replaced and the new card is unproven" is not expressible.
UPGRADE PATH — per-tag verification (`tag_aliases.verified_at` + the zone's own), the day a zone
routinely carries two cards. In practice a replacement card mints a NEW uuid and arrives as an
alias, so nothing is stranded in the meantime.

**All four (active × verified) combinations are meaningful, which is why this is not a third
value on `active`:**

| `active` | `verified_at` | means | the director's next action |
| --- | --- | --- | --- |
| t | NULL | created, card never proven | test-scan it (or write a card for it) |
| t | set | live | none |
| f | NULL | stood down before it was ever proven | none, or delete the plan |
| f | set | retired; it worked once | reactivate, and it works again |

### 3.3 The tap — where the gate is, and where it is not

```
POST /shifts/open { client_uuid, location_uuid: X, start_time }        auth: "worker"
  │
  ├─ 1. v.activePlace(X)      SQL UNCHANGED. Three branches, three WHERE clauses,
  │        │                  byte for byte as today; ONE added SELECT expression.
  │        ├─ BUILDING  l.id = X AND l.active
  │        │     -> { location_id, zone_id: NULL, zone_verified_at: NULL }   ← literals
  │        ├─ ZONE      z.id = X AND z.active AND l.active
  │        │     -> { location_id, zone_id, zone_verified_at: z.verified_at }
  │        ├─ ALIAS     ta.id = X AND z.active AND l.active
  │        │     -> { location_id, zone_id, zone_verified_at: z.verified_at }
  │        ├─ >1 row  -> 422 unknown_location                (unchanged)
  │        └─ 0 rows  -> 422 tag_unbound | 422 unknown_location (unchanged)
  │
  ├─ 2. v.requireVerifiedPlace(place)      ← THE GATE. Two lines. openShift ONLY.
  │        if (place.zone_id === null) return place;              // BUILDING TAP. No gate.
  │        if (place.zone_verified_at === null) fail(422, "zone_unverified");
  │
  └─ 3. INSERT INTO shifts …               (unchanged)

POST /shifts/close                                                    auth: "worker"
  └─ v.activePlace(…) as today. THE GATE IS NOT APPLIED. A worker who is clocked in must
     always be able to clock out (INCIDENT 1). end_zone_id records an unverified zone
     happily: it is a tap FACT, never an input to money (decision-43 §4).
```

---

## 4 · The columns, and the complete list of everything that reads them

### 4.1 Migration `010_zone_verification.sql` (sketch)

```sql
-- 010_zone_verification.sql — a zone is not a clock-in target until a human proved the card.
--
-- decision-47, which AMENDS decision-43 for tags created from this point forward and
-- GRANDFATHERS the building card mounted at HOIV by name. That card carries a BUILDING uuid,
-- it has no zone, and NOTHING in this file can reach it: the gate is a ZONE-only concept and
-- the building branch of activePlace does not read this table at all.
--
-- ADDITIVE ONLY. 001-009 are applied on the live box and are not editable (db/README.md).
-- No column is dropped, no column changes type, both added columns are NULLable.
-- NO BEGIN/COMMIT — migrate.js already runs each file with `psql -1`.
--
-- ZERO ROWS CREATED, ZERO ROWS UPDATED, AND NO BACKFILL — and that is a measured claim, not a
-- convenience. Production on 2026-08-22: 1 building (HOIV), 0 shifts, 0 workers, and exactly
-- ONE zone — a leftover row named 'test' with no serial and no tag_deployed_at, left by a
-- previous run's own testing, DELETED as an ops step before this file is applied. There is no
-- real zone anywhere to backfill, so this file invents no verification for anyone, exactly as
-- 006 refused to invent a wage.
--
-- NO DEFAULT ON verified_at, deliberately. `DEFAULT now()` would silently land a VERIFIED zone
-- on every INSERT that omits the column — the identical failure `NOT NULL DEFAULT 0` produced
-- for workers.hourly_rate_cents, which 006 §1 exists to undo. Without a default, a seed or a
-- fixture that forgets it reproduces the production refusal instead of hiding it.

ALTER TABLE zones ADD COLUMN verified_at             TIMESTAMPTZ;

-- WHO proved it, for the same reason reported_tags keeps reported_by_operator_id: this fact is
-- created in the field by a person, and "who was at that door" is worth keeping.
-- ON DELETE SET NULL, never CASCADE: a deactivated operator's past verifications are not
-- deleted history, and a zone must never lose its live status because a person left.
ALTER TABLE zones ADD COLUMN verified_by_operator_id BIGINT REFERENCES operators(id) ON DELETE SET NULL;

-- "which zones still need somebody to walk to a door" — the operator's worklist and the
-- admin's badge, one WHERE clause, and the only index this needs.
CREATE INDEX zones_unverified_idx ON zones (location_id) WHERE verified_at IS NULL AND active;
```

### 4.2 Every existing reader of `zones.active` keeps reading `zones.active` and nothing else

This is the answer to "many places read the active boolean, not a fourth state — do not
silently break them". They are enumerated, and none of them changes:

| site | today | after |
| --- | --- | --- |
| `validate.js` `activePlace` zone branch | `z.active AND l.active` | **unchanged** + one selected column |
| `validate.js` `activePlace` alias branch | `z.active AND l.active` | **unchanged** + one selected column |
| `app.js` `roster` | `WHERE z.active AND l.active` | **unchanged**; `tag_serial` narrowed — §6.3 |
| `reporting.js` `areaByLocation` | `WHERE z.active` | **unchanged** — area is about the PLACE |
| `reporting.js` `ZONE_STATE` | `EXISTS(… z.active)` | **unchanged** — decision-43 §3 is untouched |
| `admin.js` `/admin/data` zones | all zones, active or not | **unchanged** + `verified_at`, `verified_by_operator_name` |
| `admin.js` `resolveTagToExistingZone` | `z.active` | **unchanged** — either card may verify the zone |
| `admin.js` `deleteZone` | sets `active = false` | **unchanged** |
| `admin.js` `upsertZone` | writes `active` | **unchanged**, and it must REFUSE `verified_at` from the body |

**The whole design in one sentence: verification is about the CARD, never about the PLACE.** A
zone whose card is unproven is still a real room with a real area; its m² still counts, the pin
stays the colour it was, the P&L and the portal see nothing new. Only the *tap* is gated.

### 4.3 `verified_at` is read in exactly three places

```
1  lib/validate.js  requireVerifiedPlace()     the gate            (openShift only)
2  routes/operator.js  the verify handler      stamps it, idempotently
3  the ADMIN's read paths                      /admin/data + /roster's tag_serial CASE
```

Pinned by a check (§8, C7): a grep-level assertion that `verified_at` appears nowhere in
payroll, the P&L, `reporting.js`'s money, the portal, or `activePlace`'s WHERE clauses. RED case:
add it to any one of them.

---

## 5 · THE HOIV GRANDFATHER — structurally true, not asserted

The card mounted on the wall at HOIV carries:

```
https://timesheets.exe.xyz/t?l=c3c37d4a-ca0a-42c5-b248-9704b9907ec7
                              ^^^^^^^^ a BUILDING uuid. HOIV has no real zone.
```

`server/lib/validate.js` already carries the reason it must never acquire a zone predicate, and
that comment stays, verbatim, with one sentence added pointing at decision-47:

> *** THE SECOND LINE IS LOAD-BEARING AND MUST NOT ACQUIRE A ZONE PREDICATE. ***

The proof that the verification gate cannot reach it is four steps and every one of them is a
property of the code rather than a promise:

```
1  verified_at is a COLUMN ON `zones`.
2  activePlace's BUILDING branch does not reference the `zones` table at all. It reads
   `FROM locations l WHERE l.id = $1 AND l.active`, and it emits `NULL::uuid AS zone_id` and
   `NULL::timestamptz AS zone_verified_at` as SQL LITERALS — exactly as it already emits
   NULL::uuid today. There is no row it could read a verified_at from.
3  requireVerifiedPlace's FIRST statement returns unconditionally when `zone_id === null`.
   A building tap's zone_id is a literal NULL from step 2, not a join result, so it can never
   be anything else.
4  ∴ no value of zones.verified_at, for any row, in any state, can change what a BUILDING uuid
   resolves to or whether its tap opens a shift. There is no query path between them.
```

Two more things that make the same point from the other side:

- **Deleting `resolve-building` cannot touch it.** That route CREATES buildings. HOIV's row
  already exists. A deleted creation route has no relationship to a resolution path.
- **`zone_state` is untouched.** HOIV renders as `unzoned`, grey pin, „Noch keine Zone angelegt ·
  der Tag dieses Objekts startet trotzdem eine Schicht." — decision-43 §3 and §7, unchanged, and
  that sentence stays TRUE after this change because the gate never sees a building tap.

### The check, with its RED case seeded (extends `ops/check-hoiv-survives-006.mjs`)

```
seed    the production dump, restored: HOIV active, pinned, ZERO zones
tap     POST /shifts/open { location_uuid: c3c37d4a-… }
GREEN   201 · shift.location_id = HOIV · start_zone_id NULL · zone_state 'unzoned' · active true

seed 2  the same, PLUS one zone under HOIV with verified_at NULL   (the new shape)
tap     the same BUILDING uuid
GREEN   201, unchanged — an unverified zone next door changes nothing about the wall card

RED 1   delete `if (place.zone_id === null) return place;` from requireVerifiedPlace
          -> HOIV's tap 422s. The check goes red.
RED 2   add `AND EXISTS (SELECT 1 FROM zones z WHERE z.location_id = l.id
                         AND z.verified_at IS NOT NULL)` to activePlace's building branch
          -> HOIV's tap 422s. The check goes red.
RED 3   apply the gate in closeShift as well
          -> the "clock out at an unverified zone" case goes red (§8, C4)
```

Every one of those mutants must be RUN and shown failing. `decision-43`'s own mutant (adding
`AND EXISTS (SELECT 1 FROM zones …)`) is kept and still runs.

---

## 6 · The test scan

### 6.1 What it is NOT

It is **not** `POST /shifts/open`. That is the failure this project has already hit: a test tap
creates a permanent, undeletable payroll row, there is no `DELETE /admin/shifts/:id` anywhere in
the codebase, and `ZONES-MODEL.md` §12.1 row 5 records the owner accepting that defect with the
workaround written into the UI (`zonesTestTapWarning` in `web/messages/de.json`). This design
takes option (c) — the read-only mode — which is what makes the gate affordable at all. **The
`zonesTestTapWarning` string is deleted, because it stops being true**, and is replaced by the
sentence in §7.2.

It is also **not a security control**, and it must never be hardened into one. An operator can
post a zone id read off their own worklist. So can they lie about „Tag angebracht", and they
have physical access to the wall regardless (decision-15: a tag is not a credential). Its job is
to catch an HONEST mistake: a card written but never mounted, mounted at the wrong door, or
whose bytes do not resolve through the real chain.

### 6.2 Two routes, in the file whose header already forbids opening a shift

```
GET /operator/zones                                                  auth: "operator"
  -> { zones: [ { id, location_id, location_name, name, tag_serial,
                  tag_deployed_at, verified_at } ] }
     WHERE z.active AND l.active
     ORDER BY (z.verified_at IS NOT NULL), l.name, z.name      -- unverified first

POST /operator/zones/:id/verify   { place_uuid }                     auth: "operator"
  200 { zone: { id, name, location_id, location_name, verified_at, already_verified } }
  422 zone_mismatch        the card resolved to a different zone, to a BUILDING, or to nothing
  422 tag_unbound          the card is reported but no admin has resolved it yet
  422 unknown_location     the card is not ours, or its zone/building is inactive
  404 unknown_zone         :id is not an active zone
```

Handler shape, and the middle line is the whole point:

```js
async function verifyZone({ params, body, session }) {
  const zoneId = v.uuid(params.id, "id");
  const place  = await v.activePlace(body.place_uuid, "place_uuid");   // THE REAL PATH
  if (place.zone_id !== zoneId) fail(422, "zone_mismatch");
  // Idempotent: `verified_at IS NULL` in the WHERE, then a read-back, the same CTE-free
  // idiom POST /operator/tags already uses for "report the same card twice".
  …UPDATE zones SET verified_at = now(), verified_by_operator_id = $2
     WHERE id = $1 AND active AND verified_at IS NULL…
}
```

**Climbing the ladder before adding routes**, the habit decision-44 §2 set:

1. *Needed at all?* The operator's phone must know **which** zone it is proving (the equality
   check is the check), and, for an adopted URL-less card, it must resolve a UID with no server
   round trip available at the wall. It holds an operator session, and `/roster` is
   `auth: "worker"` — an operator's phone has no worker cookie and never will (decision-45).
2. *Already-installed mechanism?* `routes/operator.js` has exactly ONE route,
   `POST /operator/tags`. There is no operator read surface at all. Nothing to reuse.

∴ two routes, both `auth: "operator"`, both in that file. Nothing else is built.

**Why it cannot open a shift — structurally, per decision-45:**

```
routes/operator.js header:  "nothing in this file, and nothing reachable through an operator
session anywhere in this codebase, opens or closes a shift"  — already mutation-tested in
check-api.js.
The phone calls both routes through TimeSheetsApplication.operatorApi, which carries the
`ts_operator` cookie. NO route that touches a shift accepts that cookie.
∴ the verify path has no credential with which to open a shift. It is unreachable, not refused.
```

**Trust boundary, answered the way decision-44 §3 answers it:**

| question | answer |
| --- | --- |
| boundary | `auth: "operator"` — X-App-Key **and** a live `ts_operator` session. Identical to `POST /operator/tags`. **No new boundary.** |
| does a serial travel to the server? | **No.** decision-44's pin — *no route accepts a serial as input* — holds byte for byte. The UID is matched CLIENT-SIDE against `GET /operator/zones`, exactly `/roster`'s idiom, and the phone posts the resolved zone uuid. |
| enumeration | An operator is already entitled to know the buildings they mount cards at. The payload has no area, rate, contract, client, worker or shift. Bounded by `active` on both sides. |
| rate limit | None added. No credential is presented for guessing. `checkLoginRate` in `lib/auth.js` is the named upgrade path if one is ever wanted. |
| can an admin verify from a desk? | **No, and not by policy — by absence.** No `/admin/*` route writes `verified_at`, and `POST /admin/zones` must reject it in the body. Pinned, RED case = accepting it. |

### 6.3 `/roster`: the row stays, the serial goes — and both halves are load-bearing

```sql
-- app.js roster(), zones array
SELECT z.id, z.location_id, z.name,
       CASE WHEN z.verified_at IS NULL THEN NULL ELSE z.tag_serial END AS tag_serial
  FROM zones z JOIN locations l ON l.id = z.location_id
 WHERE z.active AND l.active                       -- UNCHANGED
```

**The ROW must stay published even when unverified.** `Zones.buildingIdOf()` uses the roster to
decide whether a tapped place belongs to the building the worker is already clocked into. Drop
the row and an ordinary clock-out at an unverified zone looks to the phone like a *different
building*, so it would post `auto_closed = true` plus a new open — a flood of unresolved, unpaid
shifts, which is the exact failure decision-43's deployment order exists to prevent.

**The SERIAL must be NULLed until verified**, and this one protects the client's only working
tap. HOIV's mounted card is a foreign NXP Ultralight with **no URL**; it resolves today only
through `KnownTags.kt`'s compiled table, to the **building** id, and it works. The moment a zone
carries that serial and `/roster` publishes it, `Zones.zonePlaceIdForSerial` takes priority over
the compiled fallback (`ScanActivity.onTag`, by design), the phone posts a **zone** id, and an
unverified zone would refuse it — breaking the one tap that works, at the only live building.
One `CASE` expression turns a sequencing rule nobody would remember into something the database
enforces.

∴ **decision-44 step 5 gains a clause**: delete `KnownTags.kt` only after a zone carries the
HOIV serial **and that zone is VERIFIED**.

Stale-cache behaviour degrades correctly in both directions: a phone whose roster predates
verification falls back to `KnownTags` → building id → 201 at building level, i.e. exactly
today's behaviour.

### 6.4 The phone: one mode flag on the screen that already exists

`ScanActivity` is already the manual-scan surface, already runs reader mode, and already resolves
a card three ways (URL → roster serial → compiled table). It gains a mode:

```
MODE_TAP     (default, UNCHANGED)   the worker's path. Converges into ACTION_VIEW -> TapInbox
                                    -> POST /shifts/open. Not touched by this design.
MODE_VERIFY  (operator only)        started ONLY from the operator's „Tag prüfen" entry, gated
                                    on the stored ts_operator cookie EXACTLY as WriteTagActivity
                                    gates the write (from DISK, never from a request — the
                                    operator is in a stairwell).
                                    It NEVER starts an ACTION_VIEW intent. It POSTs to
                                    /operator/zones/:id/verify through operatorApi and renders
                                    the answer.
```

The operator flow on the phone:

```
„Tag prüfen"  ->  GET /operator/zones     (cached; the list is small and the stairwell has no signal)
              ->  pick the building, pick the zone         <- THIS is the "did it name the zone
                                                              that was just created" check
              ->  hold the card
                   card has a URL      -> TagLink parses it -> place_uuid
                   card has no URL     -> UID matched against this list's tag_serial -> zone id
              ->  POST /operator/zones/:id/verify { place_uuid }
              ->  ✓ „Zone freigeschaltet. Reinigungskräfte können hier jetzt einstempeln."
                  ✗ „Diese Karte gehört zu einer anderen Zone: <name>, <Objekt>." (zone_mismatch)
                  ✗ „Diese Karte ist dem Büro noch nicht zugeordnet."               (tag_unbound)
```

Zone pre-selection is required and is not ceremony. "Stamp whatever was scanned" would bless a
card mounted on the wrong door — the single most likely honest mistake on a field visit — and a
URL-less adopted card cannot be resolved at all without the list.

**NFC never works on an emulator.** Any Android proof of MODE_VERIFY goes through the existing
DEBUG-only mock hook, and the release artefact must be shown not to contain it — the same bar
`android/checks/release-artefact.sh` already holds `WriteSimulation` to, not a reading of the
Kotlin.

---

## 7 · What a cleaner sees, and what the director sees

### 7.1 The cleaner — a named refusal, in German, never a code and never a 500

```
POST /shifts/open on an UNVERIFIED zone
  -> 422 { error: "zone_unverified" }        NO shift row is created
  -> err_zone_unverified
```

| | |
| --- | --- |
| de | „Dieser Tag ist noch nicht freigeschaltet. Es wurde keine Schicht gestartet. Bitte bei der Verwaltung melden." |
| en | "This tag hasn't been activated yet. No shift was started. Ask your admin." |

de/en **exact key parity**, and `android/checks/core-check.kt` already asserts every key
`ApiFailure.messageKey` can return exists in `res/values/strings.xml`, so a new code cannot ship
as a blank line.

**On the APK already in the field** the unknown code falls through `ApiFailure.messageKey`'s
`else` branch to `err_rejected` — a sentence, not a crash, and still no shift row. The same safe
degrade `tag_unbound` had before its own string shipped.

**`zone_unverified` IS RETRYABLE, and this is the single most dangerous line in the design to get
wrong.**

```
SyncPlan.blocksRow(failure) = !failure.isRetryable
ShiftSync -> store.markFailed(clientUuid, key, blocked = true)
a blocked row is NEVER planned again — nothing clears sync_blocked except markOpenSynced /
markCloseSynced, and those are unreachable for a row that is never planned.
ShiftStore.startShift writes a LOCAL row before the sync attempt, so the hours exist locally.
```

∴ a tap taken offline in a stairwell, queued, and pushed after the operator verified the zone
would be **hours a cleaner worked that the phone would never send** — the identical payroll
data-loss class `ApiFailure`'s own comment documents for 401. `zone_unverified` is a temporary
state of the SERVER's configuration, not a defect in the payload: the identical bytes succeed the
moment the zone goes live. It joins `shift_already_open` and non-`invalid_code` 401s as a
retryable 4xx. It cannot spin: the queue drains only on tap, on pull-to-refresh, and when the log
screen appears.

**A pre-existing sibling defect, found here and NOT fixed here:** `tag_unbound` is today
non-retryable and has exactly the same shape — a card mounted before the office resolves it
(CORE-FLOW §4 step 7 calls that routine traffic) strands a queued shift for ever once the admin
resolves the tag. Same cost, same fix. Filed as its own task rather than smuggled into this one.

### 7.2 The director — visibly different, never merely filtered out

The word first, colour always the second signal (decision-43 §3's rule, applied unchanged). 390 px
must work. Nothing true is deleted to lighten the screen.

**On the zone row** (`/locations/?zones=<id>`):

```
Haupteingang · 120 m² · Karte geschrieben 19.08.        ● Wartet auf Testscan
  Ein Betreiber muss die Karte vor Ort einmal prüfen. Erst danach kann hier
  eingestempelt werden.
```

verified rows read `Freigeschaltet 19.08. von Max M.` (from `verified_by_operator_id`, joined in
`/admin/data`).

**On the building row, in the Zonen cell** (beside the existing area sentence, never merged into
the operational Status cell):

```
2 von 3 Zonen freigeschaltet · 1 wartet auf Testscan
```

ICU plurals, real Austrian business German, de/en exact key parity, e.g.

```
"zonesVerifiedCount": "{total, plural, one {# Zone} other {# von {verified} Zonen}} freigeschaltet"
"zonesAwaitingScan":  "{count, plural, one {# Zone wartet auf Testscan} other {# Zonen warten auf Testscan}}"
```

**Which of the two things the director must do is DERIVED, never stored:**

```
tag_deployed_at set   · verified_at NULL · recent    -> the operator simply has not scanned yet
tag_deployed_at set   · verified_at NULL · >7 days   -> send the operator back
tag_deployed_at NULL  · verified_at NULL             -> no card has ever been written for this zone
```

**A building with zones but NONE verified** gets its own sentence, because it has no tappable
surface at all unless it also carries a grandfathered building card:

```
„Keine freigeschaltete Zone – hier kann noch niemand einstempeln."
```

and for HOIV specifically that sentence must NOT appear, because its building card works: the
condition is `zones exist AND none verified AND the building has no working building-level tap`.
Simplest honest form, and the one to implement: show it, and keep the existing
`zonesNoneStillWorks` reassurance next to it where it is true.

**`zone_state` is NOT touched.** The map pin, the P&L, payroll and the portal see exactly what
they see today (decision-43 §3).

---

## 8 · The checks. Every one has a seeded RED case, and the RED must be RUN

A check whose negative case cannot fail is not a check. The last run found a green check that had
never once rendered the screen it claimed to cover — so every item below names the mutation that
turns it red, and the mutation is executed and shown failing before the check is trusted.

| # | asserts | GREEN | RED case (mutate, show it fail, restore) |
| --- | --- | --- | --- |
| C1 | **HOIV's building tap is untouched** | restore the prod dump, apply 010, tap `c3c37d4a-…` → 201, `start_zone_id` NULL | drop `if (zone_id === null) return place` → 422 |
| C2 | **…even with an unverified zone under it** | seed one unverified zone under HOIV, tap the BUILDING uuid → 201 | add `AND EXISTS(… zones … verified_at IS NOT NULL)` to the building branch → 422 |
| C3 | **the gate refuses and creates nothing** | unverified zone, tap → 422 `zone_unverified` **and** `SELECT count(*) FROM shifts` is unchanged | delete the gate → 201 **and** a shift row appears |
| C4 | **a clock-OUT is never gated** | open a shift at the building, tap an UNVERIFIED zone of it → shift CLOSES, `auto_closed = false` | apply the gate in `closeShift` → the close 422s |
| C5 | **the test scan posts no shift** | count shifts before and after a full verify → equal, and the row's `verified_at` is set | point the verify handler at `POST /shifts/open` → the count moves |
| C6 | **no admin path can verify** | `POST /admin/zones` with `verified_at` in the body → the column stays NULL; an admin session on `/operator/zones/:id/verify` → 401/403 | accept `verified_at` in `upsertZone` → the column is set |
| C7 | **`verified_at` never reaches money** | it appears in no payroll / P&L / portal / `reporting.js` query and in no `activePlace` WHERE clause | add it to any one of them |
| C8 | **`resolve-building` is gone** | `POST /admin/tags/<id>/resolve-building` → 404, and no route-table entry matches | restore the route entry → 201 |
| C9 | **a mismatched card stamps nothing** | verify zone A with zone B's card → 422 `zone_mismatch`, A still NULL | drop the `place.zone_id !== zoneId` check → A is verified by B's card |
| C10 | **a BUILDING uuid can never verify a zone** | verify with HOIV's building uuid → 422 `zone_mismatch` | the same mutation as C9 |
| C11 | **verify is idempotent** | verify twice → 200 both times, one timestamp, unchanged on the second | drop `AND verified_at IS NULL` → the timestamp moves |
| C12 | **`/roster` publishes the ROW but not the serial** | unverified zone with a serial → present in `zones[]`, `tag_serial` null | drop the `CASE` → the serial appears and shadows `KnownTags` |
| C13 | **no route accepts a serial as input** | decision-44's existing check, unchanged, still green | unchanged: adding one |
| C14 | **`zone_unverified` is retryable on the phone** | `ApiFailure("zone_unverified").isRetryable == true`; `SyncPlan.blocksRow` false | flip it → a queued offline tap is stranded |
| C15 | **de/en exact key parity** | every new key exists in both, no orphans, ICU plurals parse | remove one key from `en.json` |
| C16 | **the admin actually RENDERS the unverified state** | a real screenshot, via `demo/cdp.mjs`, of `/locations/?zones=…` against a seeded unverified zone, with the words present in the DOM | seed the zone as VERIFIED → the assertion on „Wartet auf Testscan" must go red |
| C17 | **the release artefact has no verify mock** | the DEBUG-only hook is absent from the release dex | the same bar `release-artefact.sh` already applies |

C16 is written the way it is on purpose: the last run's green check had never rendered its
screen. The assertion is on the rendered DOM at 390 px and at desktop width, not on a source
file, and its RED case is seeding the opposite state rather than deleting the assertion.

Also re-run unchanged and expected green: `ops/check-hoiv-survives-006.mjs` (+3 mutants),
`server/db/check-prod-restore.mjs` extended to `006 → 007 → 008 → 009 → 010`,
`server/db/check-field-wire.mjs`, `server/check-api.js`, `android/checks/run.sh`,
`ops/prove-live.sh` (its `resolve-building` assertions are removed with the route; a verify step
takes their place), `ops/check-prove-live-mutants.sh`, `demo/check-guards.sh`,
`ops/check-media-pii.sh`.

---

## 9 · Deployment order

```
0  BACKUP + restore-test on the box                            (db/README.md procedure)
1  DELETE the leftover 'test' zone on production               it is test litter, not data
2  apply 010                                                    zero rows touched
3  server: the gate · 2 operator routes · the /roster CASE ·
   resolve-building DELETED · /admin/data + verified_by join
4  admin: the unverified state everywhere it belongs; the
   „Neues Gebäude" radio removed and REPLACED by a sentence;
   zonesTestTapWarning deleted (it stops being true)
5  Android: MODE_VERIFY · err_zone_unverified · zone_unverified
   made RETRYABLE                                    -> new APK, adb install -r, confirm build id
6  ONLY NOW create a zone that anyone expects to be tappable
```

**Step 6 before step 5** is survivable but ugly: the field build renders `err_rejected` instead of
the named sentence and, worse, treats the refusal as terminal, so an offline tap on a zone that
goes live an hour later is stranded. Until step 5 is confirmed on the field phone, do not create a
zone at a building where anyone is working.

**Step 1 before step 2** is not required by the migration — 010 has no guard and would apply over
the `test` row happily, leaving it `active, verified_at NULL`, i.e. harmlessly untappable. It is
first because the row is litter and the brief is to clean up and prove it.

---

## 10 · What this design deliberately does NOT do

- **It does not make the test scan atomic with writing the card.** The admin resolves at a desk,
  usually after the operator has left the building. The scan is a standing worklist item,
  re-attemptable on any later visit by whoever holds an operator phone.
- **It does not verify per CARD.** A second card aliased onto an already-verified zone is live
  without having been scanned. Upgrade path named: `tag_aliases.verified_at`.
- **It does not let an admin verify from a desk, ever.** That is the whole value of the record,
  and granting it later deletes that value — so it is a new decision record, not a flag.
- **It does not touch `zone_state`, the map, payroll, the P&L or the portal.**
- **It does not touch iOS.** `NFCTimeSheets/` and `project.pbxproj` are out of scope.
- **It does not add an npm dependency** (server stays `pg` + `@sentry/node`), a table, a systemd
  unit, a session mechanism or a rate limiter.
- **It does not fix `tag_unbound`'s retryability**, though it found the defect. Separate task,
  separate blast radius.

## 11 · What did NOT happen — kept, and updated after the server build

**In producing this document (2026-08-22, design):** nothing was built, production was read
only, no check in §8 had been run, no screenshot was taken and no APK was built. The claim in
§2.4 was a grep result and not an audit of the dex.

**After the server build, the same list, honestly:**

- **Built and deployed:** 010, the gate, the two operator routes, the `/roster` CASE, the
  deletion of `resolve-building` and of every caller.
- **Run, with their RED cases executed first, not asserted:** C1-C13 and the server half of
  C15; `check-migrate`, `check-api`, `check-prod-restore` (+3 mutants),
  `check-field-wire` (+9 mutants), `check-hoiv-survives-006` (+5 mutants),
  `demo/check-tags-screen.mjs` against a real rendered browser, and
  `ops/prove-zone-verification.sh` against the LIVE box and the real HOIV row.
- **NOT run, and not claimed:** C14 (`ApiFailure.isRetryable` on the phone), C16 (the
  director's rendered zone row — the SCREEN does not carry „Wartet auf Testscan" yet, so
  there is nothing to render), C17 (the release artefact). **No APK was built.** Android is
  untouched by this run: `err_zone_unverified` does not exist and `zone_unverified` is NOT
  retryable yet, so a tap queued offline against an unverified zone is still stranded — the
  same defect TASK-240 files for `tag_unbound`.
- **Still a grep and not a dex audit:** §2.4.
- Production was written to, deliberately and reversibly: the `test` zone deleted, 010
  applied, and one throwaway worker/operator/zone created and deleted again by
  `ops/prove-zone-verification.sh`, which counts the rows afterwards to prove it.
