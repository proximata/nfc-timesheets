---
id: decision-47
title: >-
  A zone is not a clock-in target until an operator test-scans its card; minting
  a NEW building-level tag is retired
date: '2026-08-22 12:47'
status: accepted
---
**ACCEPTED 2026-08-22 by the owner**, on the owner's own words (Context below). Full design,
the exact state machine, the wire shapes, every check and its seeded RED case:
`backlog/docs/ZONE-VERIFICATION.md`.

## **AMENDS decision-43** — for tags created FROM THIS POINT FORWARD ONLY

decision-43 keeps `status: accepted` and is not superseded. Two of its clauses are amended
and the rest stands verbatim:

| decision-43 | amended to |
| --- | --- |
| §2 "an ACTIVE zone of an ACTIVE building → (location_id, zone_id)" | unchanged in SQL. A zone that has never been test-scanned still RESOLVES; the refusal is named at the clock-in site, not hidden in the resolver — see Decision 3 |
| §7 the tag walkthrough moves onto the zone | still true, and it now has a SECOND half: writing the card is not the end of it. A zone is live only after an operator has test-scanned the card in the field |

Everything else in decision-43 is untouched: `zone_state` stays presentation-only, a shift
stays building-level, the area stays derived, the portal payload is unchanged, and §9's
"zero backfill, zero invented rows" is re-affirmed rather than weakened.

## What is retired is minting a NEW building-level tap

```
NEW building-level tap         POST /admin/tags/:id/resolve-building   DELETED
```

> **2026-08-30 UPDATE (decision-69):** this record originally kept ONE exception alive —
> a single physical card, grandfathered by name, that would keep resolving as a direct
> building-level tap for ever because it was believed to be mounted on a real wall and
> unreachable from Vienna. The owner has since confirmed that card was never actually
> deployed in the field. decision-69 therefore deletes the exception outright rather than
> narrowing it: **no building, grandfathered or not, resolves a clock-in tap on its own uuid
> any more.** Everything below in this record that described that one exception has been
> removed rather than left to describe something that no longer exists; everything else in
> this record — the zone-only verification gate, `zones.verified_at`, the retirement of
> `resolve-building`, the operator test-scan mechanism — stands exactly as written.

Structurally, not as an assertion: the verification gate is a **ZONE-only** concept. It
reads `zones.verified_at`, applied by `POST /shifts/open`'s `requireVerifiedPlace` and by
nothing else — a clock-OUT is never gated (INCIDENT 1).

Relates to decision-5 (the id is in the URI), decision-10 (auto-close + resolution),
decision-15 (tags are unlocked; a tag is not a credential), decision-19 (the server is
authoritative for open shifts), decision-21 (the UUID, never the slug), decision-22
(identity from the session), decision-40 (the tag host is permanent), decision-41 (a rate
is required — untouched), decision-42 (revenue stays on the building — untouched),
decision-44 (`zones.tag_serial`; **its pin "no route accepts a serial as input" survives
this record byte for byte** — Decision 5), decision-45 (operator identity; the operator
role is reused, not extended), decision-69 (deletes this record's one grandfather exception
outright). **Supersedes nothing.**

## Context

The owner, verbatim:

> "the system still supports building tags and zone tags, while there should be building as
> an entity where zones can be created. to create a zone one needs to generate tag url,
> write it and perform a test scan to activate zone."

Two defects in the tree answer to that sentence.

**1 · A second building-level tag can still be minted.**
`POST /admin/tags/:id/resolve-building` turns a freshly field-written card into a NEW
building whose id IS the card's id — a second direct-tap building surface, going forward.
It is wired into `web/app/tags/page.tsx` as the „Neues Gebäude" radio, on a screen whose own
file header says it exists "to prove the WRITE → REPORT → RESOLVE flow end to end … not to
be a finished screen".

**2 · A zone is live the instant it is typed, and nothing has ever proven the card.**
`zones.active` DEFAULTs `true` (006 §3). The moment an admin resolves a reported tag into a
zone, that zone is a valid clock-in target — with nobody having held the physical card to a
phone and watched the real server name the real zone. Measured on production this run:

```
zones: c9d4036d-…46843ef  'test'  location HOIV  active = TRUE
       tag_serial NULL · tag_deployed_at NULL · created 2026-08-21
```

A live clock-in target whose id is on **no wall at all**, left behind by a previous run's own
testing. That row is deleted, not migrated (Decision 4).

**3 · The obvious fix has already been refused once, for a good reason.** Verifying a wall
tag by tapping it opens a REAL shift, and there is no `DELETE /admin/shifts/:id` anywhere:
`ZONES-MODEL.md` §5 and IA-PLAN §8.4 both name it, and §12.1 row 5 records the owner
choosing "(a), i.e. the defect stays". This record chooses **(c)**: a read-only test scan
that posts no shift. That is what makes the gate affordable — without it, every zone costs
one undeletable payroll row.

## Decision

**1 · `POST /admin/tags/:id/resolve-building` is DELETED. Not unrouted, not commented out,
not kept importable — deleted.**

Handler, route-table entry, `resolveTagToBuilding` in `web/lib/api.ts`, the „Neues Gebäude"
radio and its two form fields all go. A new building discovered on a field visit becomes:

```
1  admin creates the building        POST /admin/locations     ← already TAG-FREE today
                                     (confirmed: the id is generated by the DATABASE and is
                                      never chosen by the caller; no tag is involved and no
                                      tag URI is produced on this path)
2  admin resolves the reported tag   POST /admin/tags/:id/resolve-zone {location_id, name}
   into that building's FIRST ZONE   → a zone, UNVERIFIED
3  operator test-scans the card      → the zone goes live
```

**Why deletion and not "importable-only for a future need".** There is no future need. The
"need" it would serve is a building whose id is a card's id, which is exactly the thing being
retired; the one building-level tap that must keep working needs **no route at all**, because
its row already exists and `activePlace` already answers it. And a retired handler that still
compiles is a handler that gets re-wired by a later reader who finds it and assumes it is
supported — the id space is shared, so that re-wiring is silent and permanent the moment one
card is mounted. If it ever comes back it comes back through a decision record, not through an
import. Pinned by a check: `POST /admin/tags/<id>/resolve-building` answers **404**, and its
RED case is putting the route entry back.

The operator/Android side calls this route from nowhere (grep: no hits), so nothing on a phone
changes for this part, and no APK is needed for it.

**2 · Two nullable columns on `zones`. `active` keeps its meaning byte for byte.**

```sql
-- 010_zone_verification.sql — ADDITIVE, no BEGIN/COMMIT, ZERO rows created or updated
ALTER TABLE zones ADD COLUMN verified_at             TIMESTAMPTZ;
ALTER TABLE zones ADD COLUMN verified_by_operator_id BIGINT REFERENCES operators(id) ON DELETE SET NULL;
CREATE INDEX zones_unverified_idx ON zones (location_id) WHERE verified_at IS NULL AND active;
```

**NO DEFAULT, deliberately.** `DEFAULT now()` would silently land a *verified* zone on every
INSERT that omits the column — the identical failure `NOT NULL DEFAULT 0` produced for
`workers.hourly_rate_cents`, which 006 §1 exists to undo. Without a default, a fixture or a
seed that forgets it reproduces the production refusal instead of hiding it.

**NOT a fourth value on `active`, and not `active DEFAULT false`.** `active` is the
ADMINISTRATIVE word ("this tag came off the wall"); `verified_at` is the FIELD word ("a human
proved this card"). Merging them makes two different director actions — *reactivate it* and
*send the operator back* — indistinguishable, and it would silently change the meaning of every
query that already reads `z.active`. **Every existing consumer of `zones.active` keeps reading
exactly `zones.active` and nothing else**: `activePlace`'s zone and alias branches, `/roster`,
`areaByLocation`, `ZONE_STATE`, `resolveTagToExistingZone`, `deleteZone`. `verified_at` is read
in exactly three places, enumerated and pinned in `ZONE-VERIFICATION.md` §4.

A timestamp and not a boolean, same idiom as `tag_deployed_at` / `resolved_at` / `corrected_at`:
"verified in March, before the renovation" is a question the director will ask.

**`verified_at` is NEVER cleared, by any route.** It is a historical fact. Clearing it on
reactivation would make a working door untappable without anyone asking for that. *ponytail:*
CEILING — "this zone's card was replaced and the new one is unproven" is not expressible.
UPGRADE PATH: per-tag verification (`tag_aliases.verified_at` plus the zone's own), the day a
zone routinely carries two cards. In practice a replacement card mints a NEW uuid and arrives as
an alias, so nothing is stranded meanwhile.

**3 · The gate is a named refusal at the clock-in site, never a predicate in the resolver.**

`activePlace`'s SQL keeps all three branches and all three WHERE clauses byte for byte, and
gains one selected expression: `z.verified_at AS zone_verified_at` in the zone and alias
branches, `NULL::timestamptz` in the building branch. Then, in `POST /shifts/open` and nowhere
else:

```js
// lib/validate.js — the ONLY reader of zone_verified_at in the tap path.
export function requireVerifiedPlace(place) {
  if (place.zone_id === null) return place;                 // BUILDING TAP. No zone, no gate.
  if (place.zone_verified_at === null) fail(422, "zone_unverified");
  return place;
}
```

A predicate inside the resolver was rejected: it would collapse "not yet proven" into
`unknown_location`, so the cleaner would be told the building was removed, and the verify route
itself could no longer resolve the zone it is about to prove.

- **`zone_unverified` is a NEW 422 code.** German, for a cleaner, saying what happened and what
  to do — never a code, never a 500, and **no shift row is created**: „Dieser Tag ist noch nicht
  freigeschaltet. Es wurde keine Schicht gestartet. Bitte bei der Verwaltung melden."
  de/en exact key parity (`err_zone_unverified`).
- **On the APK already in the field** the new code falls through `ApiFailure.messageKey`'s
  `else` to `err_rejected` — a sentence, not a crash, and still no shift. Same safe degrade
  `tag_unbound` had before its own string shipped.
- **`zone_unverified` IS RETRYABLE** (`ApiFailure.isRetryable`), and that is load-bearing, not a
  detail. `SyncPlan.blocksRow = !isRetryable`, and a blocked row is never planned again by
  anything — a tap taken offline in a stairwell, queued, and pushed after the zone goes live
  would otherwise be **hours a cleaner worked that the phone would never send**. It is a
  temporary state of the server's configuration, not a defect in the payload: the identical
  bytes succeed the moment the operator test-scans. The queue is drained only on tap, on
  pull-to-refresh and when the log screen appears, so this cannot spin.
- **THE GATE IS APPLIED ON OPEN ONLY, NEVER ON CLOSE.** A worker who is clocked in must always
  be able to clock out (INCIDENT 1, the worst failure this system has had). A tap on an
  unverified zone of the building a worker is already clocked into CLOSES the shift, records
  `end_zone_id`, and is not gated.

**4 · There is NO backfill dilemma, and the migration must not invent one.** Production, read
off the box on 2026-08-22: **1 building (HOIV, active, pinned), 1 zone (the leftover `test` row
above), 0 shifts, 0 workers, 0 reported tags, 0 aliases, 0 operators.** The one zone is deleted
as an ops step before 010 is applied — it is a previous run's test litter, not client data, and
deleting it is not a migration's business any more than inventing a wage was (006 §1). **Zero
real zones exist**, so 010 creates zero rows, updates zero rows, and carries no backfill, no
guard and no `UPDATE … SET verified_at`. In a DEV or DEMO database every existing zone becomes
unverified on contact with 010; that is correct, and every seed and fixture that expects a
tappable zone must stamp `verified_at` explicitly.

**5 · The test scan reuses the operator role and the manual-scan surface. It is TWO routes and
no new mechanism.**

```
GET  /operator/zones                     auth: "operator"   the worklist + the serial map
POST /operator/zones/:id/verify          auth: "operator"   {place_uuid} -> stamps verified_at
     { place_uuid }
```

- **WHO: the operator who wrote the card, from the phone, in the field — with the card in hand.
  Not an admin at a desk.** Enforced structurally, not by a screen: both routes are
  `auth: "operator"` (X-App-Key **and** a live `ts_operator` session, decision-45), no admin
  session is accepted on any `/operator/*` route, and **no `/admin/*` route writes
  `zones.verified_at`** — `POST /admin/zones` must reject the field from the body, pinned with a
  RED case. There is no desk path, because there is no route.
- **IT CANNOT OPEN A SHIFT, structurally.** Both routes live in `routes/operator.js`, whose file
  header states the invariant and whose absence of any shift route is already mutation-tested by
  `check-api.js`. The phone calls them through `operatorApi`, which carries `ts_operator`, and
  **no route that touches a shift accepts that cookie**. The verify path has no worker credential
  to open a shift with, so "it must not post a shift" is a property of the wiring rather than a
  rule someone must remember.
- **IT RESOLVES THROUGH THE REAL PRODUCTION PATH.** The handler calls `v.activePlace(place_uuid)`
  — the same function, the same SQL, that `POST /shifts/open` calls — and then requires
  `place.zone_id === :id`. A card that resolves to a different zone, to a building, to nothing,
  or to an unresolved report is refused with a named reason and stamps nothing. That equality
  check is the point: "stamp whatever was scanned" would happily bless a card mounted on the
  wrong door, which is the single most likely honest mistake on a field visit.
- **NO SERIAL TRAVELS TOWARDS THE SERVER — decision-44's pin is untouched.** For an adopted,
  URL-less card the phone matches the UID against the serial map in `GET /operator/zones`
  (client-side, exactly `/roster`'s idiom) and posts the resolved **zone uuid**. No route in this
  codebase accepts a serial as input, before or after this record, and that check's RED case is
  unchanged.
- **`/roster` publishes an unverified zone's ROW but NULLs its `tag_serial`.** The row must stay,
  or `buildingOf()` cannot tell that an unverified zone belongs to the building the worker is
  already clocked into, and an ordinary clock-out would become an `auto_closed` cross-building
  jump. The serial must go, or an unverified zone carrying HOIV's foreign Ultralight serial would
  shadow `KnownTags.kt`'s compiled fallback and **break the one working tap at the only live
  building**. One `CASE` expression, and it turns a sequencing rule nobody would remember into
  something the database enforces.
- **The test scan is NOT a security control, and must never be hardened into one.** An operator
  can post a zone id they read off their own worklist. So can they lie about „Tag angebracht",
  and they have physical access to the wall regardless. Its job is to catch an HONEST mistake —
  a card written but never mounted, mounted at the wrong door, or whose bytes do not resolve.

**6 · The write→verify order is FOUR steps and the last one is SEPARATE, later, and
re-attemptable by whoever has the phone next.**

```
1 operator  mint id · write · read back      WriteTagActivity + TagWriter      unchanged
2 operator  report to the office             POST /operator/tags               unchanged
3 admin     resolve into a zone              resolve-zone / resolve-existing-zone
            (at a desk, hours or days later) -> the zone lands UNVERIFIED
4 operator  TEST SCAN, in the building       POST /operator/zones/:id/verify   -> LIVE
```

**Step 3 realistically cannot happen while the operator is still on site**, so step 4 is NOT
part of the write flow and is NOT an atomic in-field step. It is a standing worklist —
`GET /operator/zones` — reachable at any time by any signed-in operator, for any zone that is
unverified. The operator who wrote the card is usually but not necessarily the one who returns.
A zone can sit unverified across days and visits without anything decaying, and a re-scan of an
already-verified zone is idempotent: it answers what the card resolved to and stamps nothing.

**7 · An unverified zone is VISIBLY different in the admin, never merely filtered out.** The word
comes first and colour is always the second signal (decision-43 §3's rule, unchanged). The
director sees, on the zone row: „**Wartet auf Testscan**", and on the building's Zonen cell
„2 von 3 Zonen freigeschaltet · 1 wartet auf Testscan" (ICU plurals, real Austrian business
German, de/en exact key parity, 390 px). Nothing is hidden and no default filter removes it.

Which of the two things the director must do is derived, never stored:

```
tag_deployed_at set, verified_at NULL, recent   -> the operator has simply not test-scanned yet
tag_deployed_at set, verified_at NULL, > 7 days -> send the operator back
tag_deployed_at NULL, verified_at NULL          -> no card has ever been written for this zone
```

A building with zones but **none** verified gains its own derived sentence, because it has no
tappable surface at all — a building's own uuid never had one either (decision-69). `zone_state`
itself is NOT touched: it stays derived from `active` alone (decision-43 §3), so the map, the
P&L, payroll and the portal see exactly what they see today.

## Consequences

**Deployment order, and one line of it is load-bearing.**

```
1  delete the leftover 'test' zone on production          (before 010; it is test litter)
2  apply 010                                              zero rows touched
3  server: gate + 2 operator routes + /roster CASE + resolve-building DELETED
4  admin: the unverified state, the 'Neues Gebäude' radio removed and REPLACED by a sentence
5  Android: verify mode + err_zone_unverified + zone_unverified made RETRYABLE  -> new APK
6  ONLY NOW may a zone be created that anyone expects to be tappable
```

Step 6 before step 5 is survivable but ugly: the field build shows `err_rejected` instead of the
named sentence and, worse, treats the refusal as terminal, so an offline tap on a zone that is
verified an hour later is stranded. **Until step 5 is confirmed on the field phone, do not create
a zone at a building where anyone is working.**

- **`zones.tag_serial` and `verified_at` interact, and the /roster `CASE` is what makes that
  safe.** decision-44 step 5 ("delete `KnownTags.kt` only AFTER a zone carries the serial")
  stands, and now has a second clause: **and only after that zone is VERIFIED**. Deleting the
  compiled fallback while HOIV's serial sits on an unverified zone strands the mounted card.
- **A pre-existing sibling defect, found by this design and NOT fixed by it:** `tag_unbound` is
  today non-retryable, so a tap on a card the office has not yet resolved strands a queued shift
  for ever, exactly as described above. Same shape, same payroll cost, filed as its own task.
- `ops/prove-live.sh` loses its resolve-building assertions and gains a verify step; every seed
  and fixture that expects a tappable zone must stamp `verified_at`.
- **Accepted loss:** a zone cannot be verified from a desk at all, ever. A building whose only
  operator has left the country has no path to a live zone but a visit. That is the point of the
  record and it is not a bug to be worked around later.
- **Accepted loss:** verification is per ZONE, not per CARD. A second card aliased onto an
  already-verified zone is live without ever having been scanned. Upgrade path named in
  Decision 2.
- No new npm dependency (server stays `pg` + `@sentry/node`), no new table, no new systemd unit,
  no new session mechanism, no new rate limiter, no new error code on any existing route.
- iOS is untouched and out of scope.

**Revisit trigger:** the first zone that carries two physical cards (promotes per-tag
verification from an upgrade path to a task), or the first time an operator cannot return to a
building and the director asks for a desk override — which is a new decision record, because
granting it deletes the only thing this one buys.
