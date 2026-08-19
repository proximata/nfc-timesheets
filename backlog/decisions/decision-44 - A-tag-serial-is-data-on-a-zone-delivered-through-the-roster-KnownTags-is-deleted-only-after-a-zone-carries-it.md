---
id: decision-44
title: >-
  A tag serial is data on a zone, delivered through the roster; KnownTags is
  deleted only after a zone carries it
date: '2026-08-19 13:48'
status: proposed
---
**PROPOSED. Not accepted. The owner accepts decisions.**

Full design and sequencing: `backlog/docs/ZONES-MODEL.md` §4.

Depends on decision-43 (zones; `zones.tag_serial` is declared there). Relates to decision-5
(the id is in the URI, not the hardware UID), decision-15 (tags are unlocked; a tag is not a
credential), decision-22 (identity comes from the session, never the body), decision-26
(enrolment codes), decision-27 (Play internal track — no longer the delivery path).
**Supersedes nothing.**

## Context

```
NXP Mifare Ultralight EV1   serial 04:A1:A8:52:AE:5C:80   mounted at HOIV by someone else
one application/ase.mobile record, payload = the byte 0x31, NO URL
NDEF capacity 46 B, our URI needs ~64 B   ∴ it CANNOT be rewritten to carry ours
```

`android/nfc/KnownTags.kt` hardcodes serial → location UUID and `ScanActivity:147` synthesises
the URL. Adopting a second foreign tag therefore means a new APK on every phone. The file's
own comment: *"acceptable for one tag and absurd for twenty"*, with the stated upgrade path
being a serial table served with the roster.

The owner intends to keep using URL-less foreign tags. So the map moves into the database and
the hardcode goes.

One property of this hardware is permanent and is not a bug to be fixed: **a tag with no URL
cannot wake a closed app.** There is no universal link for the OS to match. An adopted tag
only ever works through the in-app Scan screen, so the passive "hold the phone to the wall"
flow — the entire appeal of the product — does not apply to it.

## Decision

**1 · The map is `zones.tag_serial`: one nullable, format-checked, uniquely-indexed column.**
Not a table. There is exactly one adopted tag in the world.

*ponytail:* one adopted serial per zone. CEILING: a zone with two doors and two foreign tags
cannot be expressed, and neither can "this tag was replaced in March". UPGRADE PATH: a
`zone_tag_serials` child table — the `tag_serials`-beside-`locations` path `KnownTags.kt`
itself names.

A serial maps to a **zone**, not to a building. That forces HOIV's first zone to be created by
a human who knows which door the card is on — a fact a person enters, never one a migration
invents.

**2 · NO new endpoint. The serial reaches the phone inside `GET /roster`.**

The brief asked for a lookup endpoint. Climbing the ladder before writing one:

1. *Needed at all?* An adopted tag has no URL ⇒ the only path is the in-app Scan screen ⇒ the
   app is already open and already authenticated when a serial is read. It can refresh the
   roster right there.
2. *Already-installed mechanism?* `GET /roster` exists, is `auth: "worker"`, is fetched by
   `ShiftSync` on launch, and its result is persisted to SQLite by
   `ShiftStore.replaceLocations` — so it already works offline on a cold launch, which a
   stairwell requires.

∴ `/roster` gains one additive array and nothing else is built:

```json
"zones": [ { "id": "…", "location_id": "…", "name": "Haupteingang",
             "tag_serial": "04:A1:A8:52:AE:5C:80" } ]
```

Additive and safe for the build in the field: `Api.kt:92` reads
`get("/roster").getJSONArray("locations")` and ignores everything else.

**3 · The trust boundary, answered about `/roster`.**

| Question | Answer |
| --- | --- |
| trust boundary | `auth: "worker"` — X-App-Key **and** a valid worker session cookie. A stranger cannot call it. No new boundary is created. |
| a serial never authenticates | **The serial never reaches the server.** The phone matches it against the cached roster and sends the resolved *place UUID* to `POST /shifts/open`, which resolves it server-side against `zones`/`locations` and takes the worker from `session.workerId` (decision-22). A cloned serial buys a clock-in at that building **as yourself** — exactly what a cloned URL tag already buys (decision-15). **No new attack surface.** |
| rate limit | None added, because no route is added. If one is ever needed, `checkLoginRate` / `recordLoginFailure` in `lib/auth.js` is the existing bucketed limiter the portal already reuses as `portal:<ip>`. |
| unknown serial | It is simply absent from the array. The Scan screen shows „Unbekannter Tag" plus the serial in copyable form and posts **nothing** — the same terminal state `KnownTags.locationIdFor` returning null reaches today. |
| cannot enumerate zones | Enumeration is moot: a signed-in worker is already entitled to the active building list, and their own workplaces' zone names are strictly less than that. The payload is bounded by `WHERE active` and contains no area, rate, contract or client. |

Pinned by a check: **no route accepts a serial as input.** Its RED case is adding one.

*ponytail:* the roster grows linearly with zones — ~50 buildings × 6 zones ≈ 300 rows ≈ 30 KB
per launch. CEILING: at a few hundred buildings this becomes a real payload. UPGRADE PATH: a
targeted `GET /tags/:serial`, session-gated, `checkLoginRate`-bucketed, 404 with no detail on
a miss — the endpoint the brief described, built the day the roster crosses ~100 KB.

**This is a deviation from an explicit instruction.** The component asked for is designed
above as the named upgrade path; what is proposed is that it not be built yet. The owner may
overrule it, and the design is ready if they do.

**4 · `KnownTags.kt` is DELETED — and deleting it without the row STRANDS the mounted tag.**

```
delete KnownTags.kt   AND   no zone carries 04:A1:A8:52:AE:5C:80
  -> ScanActivity resolves nothing
  -> the only working tap at the only live building STOPS WORKING
  -> no site visit fixes it; only a new APK or a database row does
```

The order is not negotiable:

```
1  migration 006 (zones + tag_serial)
2  server: /roster carries zones[]
3  admin: create HOIV's first zone; type 04:A1:A8:52:AE:5C:80 onto it
4  VERIFY ON THE WIRE: GET /roster contains that serial -> that zone -> HOIV   <- THE GATE
5  Android: resolve from the cached roster; DELETE KnownTags.kt, checks/known-tags-check.kt
   and its block in checks/run.sh; new APK (versionCode 4)
6  adb install -r on the field phone; tap the mounted tag once to confirm
```

Steps 1–4 are safe at any time — the compiled fallback still resolves while they land.
**Step 5 before step 4 is the stranding.**

## Consequences

- **One residual hole, small and real.** `ShiftSync` swallows a roster fetch failure silently,
  so a fresh install whose *very first* roster fetch failed would have an empty zone cache and
  no compiled fallback. Enrolment itself requires the network, so the window is narrow but not
  empty. Mitigation, and it belongs in the same task: fetch the roster as part of enrolment
  redemption and retry on every foreground, so "signed in but has never seen a roster" is not
  a reachable resting state.
- **The admin surface must state the hardware limitation.** Next to the serial field:
  „Ein übernommener Tag ohne URL kann die App nicht von selbst öffnen. Er funktioniert nur
  über ‚Scannen' in der App." A worker must not discover this at a door.
- `409` when a serial is already claimed by another zone, naming that zone. The unique partial
  index is the backstop; the route is the gate.
- Serial input is normalised on the way in (uppercase hex, colon-separated — the form
  `KnownTags.locationIdFor` already produces), so any casing or separator style pastes cleanly
  and the `CHECK` never fires on a human.
- **Adoption becomes an admin action.** D2 Case B stops being "measure the serial, edit Kotlin,
  build, sign, distribute" and becomes "type it into the zone form". That is the whole point
  of the change and it is what makes foreign tags viable past one building.
- The passive-tap loss is unchanged and permanent for URL-less tags. The only thing that
  restores it is replacing the hardware with an NTAG213 during a normal cleaning round, which
  stays the better long-term answer and needs no code at all.
- No new npm dependency, no new route, no new rate limiter, no new systemd unit.

**Revisit trigger:** the second building that arrives with a foreign tag already on the wall,
or a zone that needs two serials. The first exercises this design; the second exhausts it and
promotes `zone_tag_serials` from an upgrade path to a task.
