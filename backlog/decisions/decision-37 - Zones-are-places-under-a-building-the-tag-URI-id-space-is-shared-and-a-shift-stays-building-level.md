---
id: decision-37
title: >-
  Zones are places under a building; the tag URI id space is shared and a shift
  stays building-level
date: '2026-08-18 03:04'
status: superseded
---
## ⚠ SUPERSEDED by decision-43 (accepted 2026-08-19). READ THAT ONE.

This record was accepted on 2026-08-18 and superseded the next day, before any of it was
built. **Nothing here shipped.** What shipped is decision-43, and `006_zones_revenue_rates.sql`
implements decision-43, not this. The design document this record points at,
`backlog/docs/ZONES-DESIGN.md`, is replaced by `backlog/docs/ZONES-MODEL.md` §3.

What decision-43 CONTRADICTS here — the only four things — so nobody has to diff two long
records:

| this record said | decision-43 says |
|---|---|
| **no `square_metres`** on a zone, explicitly rejected | `zones.area_sqm NUMERIC(8,2)`, NULLable; the building's area is `SUM()` at read time |
| tag writing lives in the **building** creation walkthrough | it moves onto the **zone**; the building keeps a collapsed read-only „Gebäude-Tag (Bestand)" |
| landmine #1: a second zone before the zone-aware APK is on every phone, **unfixable** (Play internal track) | the APK left Play — one `adb install -r` on one phone (decision-27 is no longer the delivery path) |
| „a building with no zones is **inactive**" (as later worded by the owner against this model) | **`zone_state` is PRESENTATION ONLY.** Grey pin, never `locations.active`, never tap resolution. An unzoned building clocks workers in exactly as before. |

That last row is the dangerous one, and it is why this banner is at the TOP of the file: read
naively, this record's rule kills the one card physically mounted on a wall at HOIV, which
carries a **building** UUID and has zero zones. Under decision-43 that card resolves for ever.
Pinned by `server/check-api.js` „zone_state is a GREY PIN, and locations.active is the tag —
they never merge" and by `ops/check-hoiv-survives-006.mjs`, both of which are seeded RED.

Everything else below — the `zones` child table itself, no `tags` table, no self-referencing
`locations` tree, the unchanged `/t?l=<uuid>` URI, the building-level shift, the tap rule, no
backfill — is **retained by decision-43 unchanged**.

---

Full design, migration sketch, API surface and failure analysis: `backlog/docs/ZONES-DESIGN.md`.
Journey map it falls out of: `backlog/docs/JOURNEYS.md`.

Relates to: decision-5 (id in the URI, not the hardware UID), decision-6 (materials are not
attributed per building by a human), decision-10 (auto-close + resolution), decision-15
(tags unlocked, a tag is not a credential), decision-19 (server authoritative for open
shifts), decision-21 (UUID in the tag URI, never the slug). **Supersedes nothing.**

## Context

A building holds several cleanable areas — Eingang, Stiege 1–3, Tiefgarage, Büro 2. OG —
each of which can carry its own tag. The schema cannot express that: `locations` has no child
table, and one building means one tag. The owner has settled that zones are real; this record
decides the shape, because it touches the one thing in the system that is physically
expensive to get wrong.

The physical reality that constrains it:

- exactly **one** tag is deployed, at HOIV Arsenalstraße 11. It is **not ours** — a foreign
  NXP Mifare Ultralight EV1, serial `04:A1:A8:52:AE:5C:80`, holding an `application/ase.mobile`
  record with **no URL**, 46 B capacity against our ~64 B URI, so it physically cannot carry
  our link. `android/nfc/KnownTags.kt` hardcodes serial → **location** UUID and
  `ScanActivity` synthesises the URL.
- adopting another tag currently needs a new APK and a Play release (decision-27, internal
  track, no way to force an update).
- the only live worker journey is `tap → POST /shifts/open → … → tap → close`, and the
  highest-pain incident on record is a worker who could not make his second tap.
- four months of shifts exist, all with `location_id` and no zone. Payroll, the P&L, the
  analytics trend and the client portal all aggregate by `location_id`.

## Decision

**1 · Data model.** A `zones` table, child of `locations`. **No `tags` table** — a zone row
*is* the tag record. `zones.tag_serial` (nullable, unique) carries the adopted-hardware
exception; a tag we wrote has no row, because decision-5 already made our own tags
identity-free. Columns: `id UUID`, `location_id`, `name`, `note`, `tag_serial`,
`tag_deployed_at`, `active`, `created_at`. No `square_metres`, no `floor`, no `sort_order`,
no `last_tapped_at` (derivable), no `is_default`.

*Rejected:* a self-referencing `locations` tree — a room would inherit `slug`, `lat/lng`,
`client_id`, contract price, target minutes and could be handed a `portal_grant`, and every
existing `WHERE active` over `locations` would start returning rooms. *Rejected:* naming the
row after the hardware — peeling off a broken sticker would delete the place.

**2 · The tag URI is unchanged: `/t?l=<uuid>`.** `l` stops meaning "location id" and means
"the id of the place that was tapped". New tags carry a **zone** UUID; a **location** UUID
stays valid **for ever**, because a wall is a site visit. One resolver query returns exactly
one row (zone-of-an-active-building, or active building with `zone_id NULL`) or refuses; the
error code stays `422 unknown_location`, because the build in the field renders any new code
as "unknown". *Rejected:* `&z=` in addition (a tag could then be internally inconsistent, on
hardware that is deliberately attacker-writable) and a new `?z=` parameter (the shipped APK
rejects it, so no zone tag could be deployed until a release reached every phone).

*Migration path for the one deployed tag:* **none needed.** The synthesised URI carries a
location UUID, which keeps resolving. Zero action at the wall, zero Play releases, zero rows
created by the migration.

**3 · A shift attaches to the BUILDING.** `shifts.location_id` keeps its meaning and stays
`NOT NULL`. `start_zone_id` / `end_zone_id` are nullable **tap facts**, never a cost split —
the same standing as `material_requests.location_id` under decision-6. Composite FKs
`(zone_id, location_id) → zones(id, location_id)` make it impossible for a shift to name
another building's zone.

Tap rule: no open shift → open; **any zone of the same building → close** (`auto_closed =
false`); a different building → close with `auto_closed = true` and open the new one
(unchanged, decision-10). *Rejected:* one shift per zone — a payroll row per room, the client
portal exporting our internal building structure, the 2000-row window divided by the zone
count, and 2N taps per visit against the two highest-frequency journeys. *Rejected:* "only
the opening zone closes" — it protects a mid-shift log-tap but leaves a worker who left by
another door with no reachable way out, which is the worst failure this system has had.

**4 · Backward compatibility: zero backfill, zero invented rows.** `start_zone_id IS NULL`
reads as "a building-level tag, or before zones existed". Payroll, P&L, analytics, portal and
autoclose SQL are unchanged byte for byte. *Rejected:* backfilling a default zone per
building — nobody knows which door the HOIV tag is on, and a row saying `Eingang` would be a
fabricated measurement in a payroll database (`005` refused the same move for contracts).

**5 · The client portal payload does not change.** `{date, first name, minutes}`. A zone name
is internal building structure. Pinned by a check, not by a promise.

**6 · In-app tag writing is NOT a prerequisite.** A zone tag mis-written as another zone of
the *same* building costs nothing measurable; the wrong-building error is exactly as
expensive as it is today. Zones raise the volume of writes, not the blast radius. Adoption by
serial — the cheaper and more useful half — is one column and lands with this migration.

## Consequences

**The one hard sequencing constraint.** The build in the field compares raw tag ids, so it
reads an intra-building zone tap as a *building switch*. Order is therefore:

```
1 apply the migration      zero rows, no behaviour change
2 server resolver + roster.zones + admin CRUD
3 admin zone list + per-zone tag URI
4 Android switch rule -> PLAY RELEASE
5 confirm every phone is on that build      (no way to force it)
6 ONLY NOW a second physical tag in any building
```

Step 6 before step 5 produces `auto_closed = true` plus a new shift on every intra-building
tap: a flood of unresolved, unpaid shifts. Until step 5, the admin surface must say so.
**Zones are opt-in per building; a building with no zones behaves exactly as today.**

- The running screen must state in words what the next tap does („Der nächste Tag-Kontakt in
  diesem Objekt – egal welcher – beendet die Schicht"), de/en key parity.
- `PATCH /admin/shifts/:id` must clear both zone columns when `location_id` changes, or the
  composite FK raises `23503`. Clearing is also the correct semantics.
- Deactivating a building must deactivate its zones; an active zone under an inactive
  building is unresolvable and looks like a dead tag.
- `POST /shifts/open` keeps the field name `location_uuid` while its value may be a zone id.
  `ponytail:` the name is now a lie. Ceiling: cheapest correct thing while one APK is in the
  field. Upgrade path: accept `place_uuid` as preferred once both clients send it, keep
  `location_uuid` accepted for ever.
- `KnownTags.BY_SERIAL` stays as a compiled last-resort fallback (a fresh install with no
  network must still work at HOIV), with roster-supplied serials taking priority. Deleted
  once that zone carries the serial and every phone has cached a roster.
- **Accepted loss:** no per-zone duration. "The Tiefgarage tag has not been tapped since
  14 May" is answerable; "the Tiefgarage costs €180/month" is not. Per-zone duration needs a
  tap at every zone boundary and is a separate decision with a real cost at the door. The
  schema does not block it: a `shift_zone_visits` child table is the named upgrade path.
- **Accepted loss:** no zone-level contract, target, revenue or margin, and no worker↔zone
  assignment. Money stays at the building.
- **Not new but made worse:** the verification tap is an undeletable payroll row (there is no
  `DELETE /admin/shifts/:id`), and with N zones it is N test shifts per building.
- No new npm dependency, no new systemd unit. Server deps stay `pg` + `@sentry/node`
  (decision-23).

**Revisit trigger:** the first time a director asks what one zone costs. That is the question
this model answers with tag activity and not with money, and the answer is a decision record,
not a query.

