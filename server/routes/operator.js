// Operator-session action routes. `auth: "operator"` \u2014 X-App-Key AND a live ts_operator
// session (decision-45). OPERATOR-MODEL.md is explicit about the job: "he reads and writes
// tags". This file is that job's server half.
//
// STRUCTURAL, NOT A PROMISE: nothing in this file, and nothing reachable through an
// operator session anywhere in this codebase, opens or closes a shift. That absence is
// what makes "an operator does not clock in" true regardless of what any handler does or
// forgets to do \u2014 see check-api.js's own mutation-tested pin on that exact invariant.
import { all, one } from "../lib/db.js";
import { fail } from "../lib/http.js";
import * as v from "../lib/validate.js";

/**
 * POST /operator/tags {id} -> "this tag now exists and carries this id".
 *
 * Called once, right after the operator's phone WRITES a fresh NDEF URI tag. The id was
 * minted by that phone, client-side, before this call and before any zone or building
 * exists to claim it (server/db/migrations/008_reported_tags.sql explains why that is
 * safe: the id is never a credential, and it resolves to nothing until an admin
 * deliberately claims it).
 *
 * LANDS UNBOUND. This route creates exactly one row in `reported_tags` and nothing else \u2014
 * no zone, no building, no alias. Turning it into one of those is the admin's job
 * (POST /admin/tags/:id/resolve-*, routes/admin.js).
 *
 * IDEMPOTENT: `ON CONFLICT (id) DO NOTHING` plus a read-back, the SAME idiom
 * POST /shifts/open already uses for its own idempotency key. The same physical tag
 * reported twice \u2014 a retried request on flaky field wifi, or two operators who both
 * happened to write and report at the same site \u2014 lands exactly ONE row either way, and
 * the race is decided by Postgres's own conflict handling, not by a check-then-insert in
 * this process that two concurrent callers could both pass.
 *
 *   201 created                     a new tag, freshly landed unbound
 *   200 already reported            same id, unbound OR already resolved \u2014 either way,
 *                                    "somebody already told us about this tag" is true, and
 *                                    the caller has nothing useful to do but stop asking
 *   409 id_in_use                   this uuid already names a REAL location or zone. Only
 *                                    reachable by a UUIDv4 collision (vanishingly unlikely)
 *                                    \u2014 named explicitly so a report can never be silently
 *                                    swallowed against an id that already means something
 */
async function reportTag({ body, session }) {
  const tagId = v.uuid(body.id, "id");

  // Checked BEFORE the insert so a collision is a clean, explained refusal rather than a
  // report that silently landed a row next to an id that already means something. The
  // insert itself cannot collide with locations/zones \u2014 they are different tables \u2014 so
  // this is the only place such a collision could ever be caught.
  const clash = await one(
    "SELECT 1 AS hit FROM locations WHERE id = $1 UNION ALL SELECT 1 FROM zones WHERE id = $1",
    [tagId],
  );
  if (clash) fail(409, "id_in_use");

  const inserted = await one(
    `INSERT INTO reported_tags (id, reported_by_operator_id) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, reported_at, resolved_at`,
    [tagId, session.operatorId],
  );
  if (inserted) return { status: 201, body: { tag: inserted } };

  const existing = await one("SELECT id, reported_at, resolved_at FROM reported_tags WHERE id = $1", [tagId]);
  return { status: 200, body: { tag: existing } };
}

// ---- the test scan: a zone goes live when a human proved the card (decision-47) ------
//
// THE PROBLEM THESE TWO ROUTES SOLVE, and why the obvious answer was refused. Before this,
// a zone was a valid clock-in target the instant an admin typed its name — `zones.active`
// DEFAULTs true — with nobody ever having held the physical card to a phone and watched the
// real server name the real zone. The obvious fix, "tap it once and see", costs one
// PERMANENT payroll row every time: a tap opens a real shift and there is no
// DELETE /admin/shifts/:id anywhere in this codebase. So the test scan is READ-ONLY with
// respect to shifts, and that is what makes the gate affordable at all.
//
// IT CANNOT OPEN A SHIFT — STRUCTURALLY, NOT BY POLICY. Both routes are `auth: "operator"`,
// they live in this file (whose header states the invariant, mutation-tested in
// check-api.js), and the phone calls them through `operatorApi`, which carries `ts_operator`.
// NO route that touches a shift accepts that cookie. There is no credential here with which
// to open one.
//
// IT IS NOT A SECURITY CONTROL AND MUST NEVER BE HARDENED INTO ONE. An operator can post a
// zone id read off their own worklist; they can equally lie about „Tag angebracht", and they
// have physical access to the wall regardless (decision-15: a tag is not a credential). Its
// job is to catch an HONEST mistake — a card written but never mounted, mounted at the wrong
// door, or whose bytes do not resolve through the real chain.

/**
 * GET /operator/zones -> "which doors still need somebody to walk to them", plus the serial
 * map the phone needs to recognise an adopted, URL-less card.
 *
 * UNVERIFIED FIRST, because that is the worklist; verified rows stay in the list so a
 * re-scan (and a replacement card) has something to aim at.
 *
 * NO SERIAL TRAVELS TOWARDS THE SERVER — decision-44's pin survives this record byte for
 * byte. The serial travels OUTWARDS, exactly as it does in `/roster`, and the phone matches
 * a UID against it CLIENT-SIDE and posts the resolved zone uuid. `/roster` cannot be reused
 * for this: it is `auth: "worker"`, and an operator's phone has no worker cookie and never
 * will (decision-45).
 *
 * ENUMERATION: an operator is already entitled to know the buildings they mount cards at,
 * and this payload carries no area, rate, contract, client, worker or shift. Bounded by
 * `active` on both sides.
 *
 * LEFT JOIN, not INNER (decision-54 §1). A zone may now have NO building — a card written
 * at a door before anybody decided which object it belongs to — and that zone is exactly the
 * one with work left on it, so dropping it from the WORKLIST would hide the only screen from
 * which it can ever be bound. It comes back with `location_name: null`. The `l.active` half
 * of the filter moves INTO the join condition for the same reason: a NULL building is not an
 * inactive one, and left in the WHERE it would re-exclude every unbound row.
 */
async function listZones() {
  const zones = await all(
    `SELECT z.id, z.location_id, l.name AS location_name, z.name, z.tag_serial,
            z.tag_deployed_at, z.verified_at
       FROM zones z
       LEFT JOIN locations l ON l.id = z.location_id AND l.active
      WHERE z.active AND (z.location_id IS NULL OR l.id IS NOT NULL)
      ORDER BY (z.verified_at IS NOT NULL), l.name NULLS FIRST, z.name`,
  );
  return { status: 200, body: { zones } };
}

/**
 * POST /operator/zones/:id/verify {place_uuid} -> this card resolves to this zone; the zone
 * is now a clock-in target.
 *
 * THE MIDDLE LINE IS THE WHOLE POINT. `v.activePlace` is THE REAL PRODUCTION PATH — the same
 * function, the same SQL, that POST /shifts/open calls — so what is proved here is what a
 * cleaner's tap will do, not a re-implementation that could drift from it. Then the resolved
 * place must BE the zone the operator picked: "stamp whatever was scanned" would happily
 * bless a card mounted on the wrong door, which is the single most likely honest mistake on
 * a field visit.
 *
 *   200 verified            {zone, already_verified}
 *   404 unknown_zone        :id is not an ACTIVE zone of an ACTIVE building
 *   422 zone_mismatch       the card resolved to another zone, or to a BUILDING
 *   422 tag_unbound         the card was reported but no admin has resolved it yet
 *   422 unknown_location    the card is not ours, or its zone/building is inactive
 *
 * The last two are `activePlace`'s own codes, raised by `activePlace` itself and deliberately
 * not renamed: the operator's phone should say the same thing about a card as a cleaner's
 * phone would.
 *
 * IDEMPOTENT. A second scan of an already-verified zone is a harmless 200 that stamps
 * nothing: `verified_at IS NULL` in the WHERE, then a read-back — the same CTE-free idiom
 * POST /operator/tags uses for "the same card reported twice". `verified_at` is never moved
 * and never cleared, by this route or any other: it is a historical fact.
 */
async function verifyZone({ params, body, session }) {
  const zoneId = v.uuid(params.id, "id");
  // Checked BEFORE the card is resolved so "that zone is not one of ours" cannot be reported
  // as a mismatch, which would send an operator hunting for a wrong card that does not exist.
  const target = await one(
    `SELECT z.id, z.name, z.location_id, l.name AS location_name, z.verified_at
       FROM zones z JOIN locations l ON l.id = z.location_id
      WHERE z.id = $1 AND z.active AND l.active`,
    [zoneId],
  );
  if (!target) fail(404, "unknown_zone");

  const place = await v.activePlace(body.place_uuid, "place_uuid");
  // `place.zone_id` is NULL for a BUILDING uuid, so a building card can never verify a zone:
  // null is not the zone id, and the comparison says so without a special case.
  if (place.zone_id !== zoneId) fail(422, "zone_mismatch");

  const stamped = await one(
    `UPDATE zones SET verified_at = now(), verified_by_operator_id = $2
      WHERE id = $1 AND active AND verified_at IS NULL
      RETURNING id, name, location_id, verified_at`,
    [zoneId, session.operatorId],
  );
  if (stamped) {
    return {
      status: 200,
      body: {
        zone: { ...stamped, location_name: target.location_name, already_verified: false },
      },
    };
  }

  // Already verified — by an earlier scan, or by a colleague who got there first while this
  // request was in flight. Either way the answer is the same and nothing moved.
  const existing = await one(
    "SELECT id, name, location_id, verified_at FROM zones WHERE id = $1",
    [zoneId],
  );
  return {
    status: 200,
    body: { zone: { ...existing, location_name: target.location_name, already_verified: true } },
  };
}

// ---- zone creation, binding and unbinding: the operator's job now (decision-54) ------
//
// A zone used to be born at a DESK: an operator wrote a card in the field, reported it, and
// days later an admin decided what it was (POST /admin/tags/:id/resolve-zone). decision-54
// moves that to the person standing at the door, because they are the only one who knows
// which door it is — and lets them defer the BUILDING question, which is the half they often
// cannot answer on the spot (migration 013).
//
// STILL NO SHIFT ANYWHERE. Everything below writes `zones` and `reported_tags` and nothing
// else; this file's header invariant is untouched by all four routes.

// The zone shape every route in this file returns. Not admin.js's ZONE_COLS: that one
// carries `note`, `area_sqm` and `active`, which are the DIRECTOR's fields, and an operator
// screen has nothing to do with them.
const OP_ZONE_COLS = "id, location_id, name, tag_serial, tag_deployed_at, verified_at";

// A resolve is refused the same way whether the tag was NEVER reported (404) or was reported
// and ALREADY resolved (409) — told apart by one extra read, so the phone can say "that isn't
// a card we know of" differently from "somebody already decided this one".
//
// DUPLICATED from routes/admin.js's `resolvedOrUnknown` on purpose, six lines of it. This
// codebase has no shared module for route-local logic, and inventing one so two files can
// share a two-statement helper buys a cross-file import in exchange for nothing — the admin
// copy is on its way out anyway (decision-54 §2 deletes its only remaining caller).
async function resolvedOrUnknown(tagId) {
  const reported = await one("SELECT resolved_at FROM reported_tags WHERE id = $1", [tagId]);
  fail(reported ? 409 : 404, reported ? "already_resolved" : "unknown_reported_tag");
}

/**
 * POST /operator/tags/:id/resolve-zone {name, location_id?} -> the card just written at this
 * door becomes a zone, with or without a building.
 *
 * REPLACES POST /admin/tags/:id/resolve-zone clause for clause — same CTE, same 404/409, same
 * `tag_deployed_at` taken from the REPORT rather than from now(). One thing differs, and it is
 * the whole decision: `location_id` is OPTIONAL. Omitted, the zone lands UNBOUND and is
 * unreachable by any tap until somebody binds it (013 explains why the database, not this
 * handler, is what makes that true).
 *
 * NOT VERIFIED BY THIS ROUTE, deliberately. Creating a zone and PROVING its card are two
 * separate facts (decision-47); the operator's next action is the test scan, and an unbound
 * zone cannot be test-scanned at all because `activePlace` cannot resolve it.
 *
 *   201 created                     {zone}
 *   404 unknown_reported_tag        :id was never reported
 *   409 already_resolved            somebody already made this card into something
 *   409 duplicate_zone_name         a live zone of that building already has that name
 *   409 id_in_use                   UUIDv4 collision on the id itself (vanishingly unlikely)
 *   422 unknown_location            a location_id was given and names no building
 */
async function resolveTagToZone({ params, body }) {
  const tagId = v.uuid(params.id, "id");
  // `optionalUuid` and not `uuid`: an absent building is a legitimate, permanent-until-bound
  // state here, and the phone's picker posts nothing at all when the operator skips it.
  const locationId = v.optionalUuid(body.location_id, "location_id");
  // Existence only, no `active` filter — the same posture POST /admin/zones takes. Whether a
  // zone RESOLVES is `activePlace`'s call, made fresh on every tap.
  if (locationId !== null && !(await one("SELECT id FROM locations WHERE id = $1", [locationId]))) {
    fail(422, "unknown_location");
  }
  const name = v.str(body.name, "name", { max: 120 });

  let row;
  try {
    row = await one(
      `WITH stamp AS (
         UPDATE reported_tags SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL
         RETURNING id, reported_at
       )
       INSERT INTO zones (id, location_id, name, tag_deployed_at)
         SELECT id, $2, $3, reported_at FROM stamp
       RETURNING ${OP_ZONE_COLS}`,
      [tagId, locationId, name],
    );
  } catch (err) {
    // Only two constraints can fire: a name clash within the building, or a collision on the
    // id. tag_serial is never set here, so zones_tag_serial_idx cannot be the cause. An
    // UNBOUND insert cannot clash on the name either — zones_one_live_name_idx is keyed on
    // (location_id, lower(btrim(name))) and a NULL location_id is distinct from every other
    // row in a unique index, including from other NULLs.
    if (err?.code === "23505") fail(409, err?.constraint === "zones_pkey" ? "id_in_use" : "duplicate_zone_name");
    throw err;
  }
  if (!row) await resolvedOrUnknown(tagId);
  return { status: 201, body: { zone: row } };
}

/**
 * POST /operator/zones/:id/bind {location_id} -> this zone is in this building.
 *
 * REFUSES A ZONE THAT ALREADY HAS ONE (409). Rebinding is unbind-then-bind and never a
 * silent move (decision-54 §3): moving a zone between buildings strands every shift that
 * names it, and the unbind half is where the database gets to say so.
 *
 * CLEARS `verified_at`, and this is the one place in the codebase that does — 010's "never
 * cleared, by any route, ever" was written when a zone's building could not change, and
 * decision-54 §3 names this exception explicitly. The proof was taken against a DIFFERENT
 * context (a zone with no building, which `activePlace` cannot resolve at all), so carrying
 * it over would mark a door tappable on the strength of a scan that never resolved to this
 * building. `verified_by_operator_id` goes with it: a stamp with no timestamp is a fact
 * about nothing.
 *
 *   200 bound                {zone}
 *   404 unknown_zone         :id is not an active zone
 *   409 already_bound        it has a building; unbind first
 *   409 duplicate_zone_name  a live zone in the TARGET building already has that name
 *   409 serial_taken         (backstop) the adopted serial is claimed elsewhere
 *   422 unknown_location     no such building
 */
async function bindZone({ params, body }) {
  const zoneId = v.uuid(params.id, "id");
  const locationId = v.uuid(body.location_id, "location_id");
  if (!(await one("SELECT id FROM locations WHERE id = $1", [locationId]))) fail(422, "unknown_location");

  let row;
  try {
    // `location_id IS NULL` in the WHERE is what makes this safe under two operators binding
    // the same zone at once: the second UPDATE matches nothing and is answered 409, rather
    // than silently overwriting the first one's building.
    row = await one(
      `UPDATE zones SET location_id = $2, verified_at = NULL, verified_by_operator_id = NULL
        WHERE id = $1 AND location_id IS NULL
        RETURNING ${OP_ZONE_COLS}`,
      [zoneId, locationId],
    );
  } catch (err) {
    // Now that the row HAS a building, both partial unique indexes become reachable: a name
    // that was unique-by-being-NULL can collide with a live zone in the target building.
    // Same mapping as POST /admin/zones, by constraint name.
    if (err?.code === "23505") {
      fail(409, err?.constraint === "zones_tag_serial_idx" ? "serial_taken" : "duplicate_zone_name");
    }
    throw err;
  }
  if (row) return { status: 200, body: { zone: row } };

  // Nothing updated — one read to tell "no such zone" from "already has a building", because
  // the operator's next action differs completely (pick another zone vs unbind this one).
  const existing = await one("SELECT location_id FROM zones WHERE id = $1", [zoneId]);
  fail(existing ? 409 : 404, existing ? "already_bound" : "unknown_zone");
}

/**
 * POST /operator/zones/:id/unbind {} -> this zone has no building again.
 *
 * THE REFUSAL IS THE DATABASE'S, NOT THIS FUNCTION'S. `shifts_start_zone_fk` /
 * `shifts_end_zone_fk` are composite FKs on (zone_id, location_id) with a NOT NULL
 * `shifts.location_id`, so clearing the building under a zone that any shift references
 * raises 23503 and the UPDATE never happens (migration 013 spells out the MATCH SIMPLE
 * arithmetic). This handler only renames that error. A SELECT-then-decide would be a race
 * — a tap landing between the check and the update — and would need integrity code that
 * decision-43's constraint already provides.
 *
 * `verified_at` is NOT cleared here. It stays true of what was proved, and binding — the
 * step that changes the context a card was proved in — is what clears it.
 *
 *   200 unbound            {zone}
 *   404 unknown_zone       no such zone
 *   409 already_unbound    it has no building already
 *   409 zone_has_shifts    a shift was tapped here; the building cannot be taken away
 */
async function unbindZone({ params }) {
  const zoneId = v.uuid(params.id, "id");

  let row;
  try {
    row = await one(
      `UPDATE zones SET location_id = NULL
        WHERE id = $1 AND location_id IS NOT NULL
        RETURNING ${OP_ZONE_COLS}`,
      [zoneId],
    );
  } catch (err) {
    // Both constraint names mean the same thing to an operator: somebody has clocked in
    // here, so this zone's history is nailed to its building.
    if (err?.code === "23503") fail(409, "zone_has_shifts");
    throw err;
  }
  if (row) return { status: 200, body: { zone: row } };

  const existing = await one("SELECT location_id FROM zones WHERE id = $1", [zoneId]);
  fail(existing ? 409 : 404, existing ? "already_unbound" : "unknown_zone");
}

/**
 * GET /operator/zones/:id -> the state the zone page branches on: bound or not, verified or
 * not (decision-54 §7).
 *
 * `location_id` and `location_name` are both NULLABLE and that is the branch: an unbound zone
 * gets the building picker, a bound one gets the test scan and its month of shifts. LEFT JOIN
 * for the same reason listZones uses one — an INNER JOIN would turn "unbound" into "404",
 * which is the one answer the caller cannot act on.
 *
 * Same minimal disclosure as GET /operator/zones: a name and a status. No area, no rate, no
 * contract, no client.
 *
 *   404 unknown_zone   no such zone, or it is deactivated (an inactive zone is not a place an
 *                      operator has any field work at)
 */
async function getZone({ params }) {
  const zoneId = v.uuid(params.id, "id");
  const zone = await one(
    `SELECT z.id, z.name, z.location_id, l.name AS location_name, z.verified_at
       FROM zones z
       LEFT JOIN locations l ON l.id = z.location_id
      WHERE z.id = $1 AND z.active`,
    [zoneId],
  );
  if (!zone) fail(404, "unknown_zone");
  return { status: 200, body: { zone } };
}

/**
 * GET /operator/tags/:id -> "what IS this card", for a human holding it (decision-55 §1).
 *
 * READ-ONLY, NO SIDE EFFECT OF ANY KIND. It stamps nothing, creates nothing and resolves
 * nothing; scanning a card must be as free as looking at it, or an operator will hesitate to
 * scan the odd card in the drawer — which is the whole case this route exists for.
 *
 * *** NOT BUILT ON `activePlace`, AND MUST NEVER BE. *** That function is THE TAP PATH
 * (server/lib/validate.js) and its header forbids exactly the branch this route needs: an
 * UNBOUND zone must keep collapsing into `unknown_location` there, because a real cleaner's
 * tap against a buildingless zone has to fail exactly like a tap against nothing. Here the
 * question is different — "what does this id mean, for somebody who can act on the answer" —
 * so it earns its own small query rather than bending the one tap resolution depends on
 * (decision-55 §1, and its Consequences: a maintainer extending one of the two must not
 * assume it also changes the other).
 *
 * FIVE KINDS, checked IN THIS ORDER, and the order is what makes each answer unambiguous:
 *
 *   {kind: "zone", zone}   an ACTIVE zone, bound OR not — the SAME body shape
 *                          GET /operator/zones/:id returns, so the client feeds it straight
 *                          into the existing zone page (decision-54 §7: bound shows the
 *                          building card, unbound shows the building picker). No new UI
 *                          concept, only a new way to arrive at the one that exists.
 *   {kind: "building"}     an ACTIVE building — the grandfathered HOIV-style building card
 *                          (decision-47). There is no building-level operator screen and none
 *                          is added here; this is told apart from "unknown" ONLY so the phone
 *                          can say "that is a building card, not a zone".
 *   {kind: "retired"}      an INACTIVE zone — precisely what a reassignment (§3 below) leaves
 *                          behind. An honest answer for a card that very much used to be
 *                          ours beats "not ours".
 *   {kind: "tag_reported"} a `reported_tags` row that never became anything. Written, known,
 *                          undecided. NO ACTION IS OFFERED FROM THIS SCREEN — turning a
 *                          report into a zone stays POST /operator/tags/:id/resolve-zone,
 *                          reached the way it always was.
 *   {kind: "unknown"}      a stranger's tag, a typo, a torn-off sticker — and also an
 *                          INACTIVE building, which decision-55 does not name a kind for and
 *                          which no operator action can address.
 *
 * `tag_aliases` IS DELIBERATELY NOT RESOLVED (decision-55 §1, named there as a real cost
 * with a small blast radius). That id space names an existing zone through a different table
 * and is an admin concern in practice — the HOIV grandfather is effectively its only
 * occupant. An alias id answers `unknown` here, ON PURPOSE. Widening this route to cover it
 * is a decision record, not a patch.
 *
 *   200  always, for every one of the five kinds. There is no 404: "I do not know this card"
 *        IS the answer, and a 404 would make the phone show a transport error instead of it.
 *   400  the :id is not a uuid at all — `v.uuid`'s own refusal, before any query runs.
 */
async function classifyTag({ params }) {
  const tagId = v.uuid(params.id, "id");

  // FIRST, because an active zone is the only kind with an action behind it. LEFT JOIN and
  // not INNER for the same reason getZone uses one: an UNBOUND zone must come back as a
  // zone with a null building, never as "not found" — it is the state with work left on it.
  const zone = await one(
    `SELECT z.id, z.name, z.location_id, l.name AS location_name, z.verified_at
       FROM zones z
       LEFT JOIN locations l ON l.id = z.location_id
      WHERE z.id = $1 AND z.active`,
    [tagId],
  );
  if (zone) return { status: 200, body: { kind: "zone", zone } };

  // `active` and nothing else decides whether a BUILDING card means something — the same
  // rule `activePlace`'s load-bearing second branch states, and for the same reason: the
  // card physically on the wall at HOIV carries a building uuid and that building has zero
  // zones. No zone predicate belongs here either.
  if (await one("SELECT 1 AS hit FROM locations WHERE id = $1 AND active", [tagId])) {
    return { status: 200, body: { kind: "building" } };
  }

  // Reached only when the id is NOT an active zone, so no `active` filter is needed on the
  // way in: any zones row still standing here is an inactive one.
  if (await one("SELECT 1 AS hit FROM zones WHERE id = $1", [tagId])) {
    return { status: 200, body: { kind: "retired" } };
  }

  // Likewise no `resolved_at IS NULL` filter: the two checks above already proved no zone
  // row of ANY state carries this id, so a report reaching this line has nothing behind it
  // whatever its stamp says. Filtering on the stamp as well would answer `unknown` for a
  // report whose resolution left no zone — a state nothing creates today, and "unknown"
  // would be the wrong word for it if anything ever did.
  if (await one("SELECT 1 AS hit FROM reported_tags WHERE id = $1", [tagId])) {
    return { status: 200, body: { kind: "tag_reported" } };
  }

  return { status: 200, body: { kind: "unknown" } };
}

/**
 * POST /operator/zones/:id/reassign-building {new_tag_id, location_id} -> this door now
 * belongs to a different building: retire the old zone, mint a fresh one on the rewritten
 * card (decision-55 §3).
 *
 * IT DOES NOT `UPDATE zones SET location_id`, and could not if it wanted to. A zone with any
 * shift history structurally CANNOT have its building changed in place —
 * `shifts_start_zone_fk` / `shifts_end_zone_fk` are composite FKs on (zone_id, location_id)
 * with a NOT NULL `shifts.location_id` (migration 013 does the MATCH SIMPLE arithmetic), so
 * Postgres itself refuses to retarget a referenced row. decision-55 declines to special-case
 * "but if it has no shifts yet, just update it": that buys one extra, less-tested path for
 * the rare zone reassigned before its first tap, and leaves it with a stale
 * `tag_deployed_at` and no requirement to prove the card again in its new context — the very
 * gap bindZone already closes by clearing `verified_at`.
 *
 * THE OLD ZONE IS SOFT-DEACTIVATED, exactly as DELETE /admin/zones/:id already does when a
 * tag comes off a wall. `verified_at`, `location_id` and every shift that ever named it are
 * UNTOUCHED and stay queryable under its own id for ever. No new shift can reference it (an
 * inactive zone is unresolvable by `activePlace`), and a future scan of the dead card reports
 * `kind: "retired"` through the route above.
 *
 * THE NEW ZONE is keyed by `new_tag_id` — an id the OPERATOR'S PHONE minted and WROTE to the
 * physical card BEFORE this call, through the unchanged POST /operator/tags. It carries the
 * old zone's `name` and `note` forward (same door, same physical description; only the
 * building changed), takes `tag_deployed_at` from the REPORT rather than from now() — the
 * same rule resolveTagToZone follows — and starts `verified_at NULL` with zero shifts: a
 * fresh worklist entry that needs its own test scan before it can open a shift.
 *
 * *** NO PARTIAL APPLICATION, AND THAT IS WHAT THE CTE SHAPE IS FOR (decision-55 §3). ***
 * ONE statement, four CTEs, each gated on the previous one by EXISTS/derivation:
 *   old     the zone, read ONLY if it is ACTIVE and BOUND — no row here and nothing below
 *           can produce one either. FOR UPDATE, and that clause is load-bearing (TASK-285):
 *           without it two overlapping reassigns of the SAME zone into DIFFERENT buildings
 *           both see it live in their own READ COMMITTED snapshots and BOTH mint, leaving
 *           one door with two live zones in two buildings. With the lock the second
 *           statement blocks here, re-reads after the winner commits, sees active = false,
 *           produces no row, and the whole chain collapses to a clean 404 unknown_zone with
 *           nothing written. The tempting alternative — re-predicating the `retired` UPDATE
 *           with `AND active` — is WORSE than the defect: the loser's claim and mint have
 *           already committed by then, so it would produce exactly the partial application
 *           decision-55 §3 forbids. Do not.
 *   claim   stamps `reported_tags.resolved_at`, gated `EXISTS (SELECT 1 FROM old)`: a card
 *           is never consumed against a zone that was not live and bound at that instant.
 *   minted  the new zone, SELECTed from claim CROSS JOIN old: it exists only if BOTH did.
 *   retired the deactivation, gated `EXISTS (SELECT 1 FROM minted)`: the old zone is only
 *           retired if the new tag was actually claimed and the new row actually landed.
 * A unique-index violation anywhere aborts the WHOLE statement, so there is no reachable
 * state in which a door loses its zone without gaining a replacement, or a freshly written
 * tag is silently discarded. A SELECT-then-write sequence could not promise either.
 *
 *   201 reassigned              {zone, retired_zone_id}
 *   404 unknown_zone            :id is not an active zone
 *   409 zone_unbound            it has no building — there is nothing to reassign; bind it
 *   404 unknown_reported_tag    new_tag_id was never reported (resolvedOrUnknown)
 *   409 already_resolved        new_tag_id is already something (resolvedOrUnknown)
 *   409 duplicate_zone_name     the TARGET building already has a live zone by that name
 *   409 id_in_use               UUIDv4 collision on new_tag_id itself (vanishingly unlikely)
 *   422 unknown_location        no such building, or it is deactivated
 */
/**
 * The one statement, exported ONLY so check-api.js can race the REAL text on two real
 * connections instead of a copy that could drift away from it (TASK-285 AC#2/#3). Nothing
 * else imports it; the route is still the only caller in the server.
 */
export const REASSIGN_ZONE_SQL = `WITH old AS (
     SELECT id, name, note FROM zones WHERE id = $1 AND active AND location_id IS NOT NULL
     FOR UPDATE
   ),
   claim AS (
     UPDATE reported_tags SET resolved_at = now()
      WHERE id = $2 AND resolved_at IS NULL AND EXISTS (SELECT 1 FROM old)
     RETURNING id, reported_at
   ),
   minted AS (
     INSERT INTO zones (id, location_id, name, note, tag_deployed_at)
       SELECT c.id, $3, o.name, o.note, c.reported_at FROM claim c CROSS JOIN old o
     RETURNING ${OP_ZONE_COLS}
   ),
   retired AS (
     UPDATE zones SET active = false WHERE id = $1 AND EXISTS (SELECT 1 FROM minted)
     RETURNING id
   )
   SELECT m.*, r.id AS retired_zone_id FROM minted m JOIN retired r ON true`;

async function reassignZoneBuilding({ params, body }) {
  const zoneId = v.uuid(params.id, "id");
  const newTagId = v.uuid(body.new_tag_id, "new_tag_id");
  const locationId = v.uuid(body.location_id, "location_id");

  // ACTIVE, unlike bindZone's existence-only check: this route is reached from a screen that
  // just offered a picker of ACTIVE buildings (GET /operator/locations), so an inactive id
  // here is a stale phone, and moving a door into a building nobody cleans any more is not a
  // thing to accept quietly.
  if (!(await one("SELECT id FROM locations WHERE id = $1 AND active", [locationId]))) {
    fail(422, "unknown_location");
  }

  let row;
  try {
    row = await one(REASSIGN_ZONE_SQL, [zoneId, newTagId, locationId]);
  } catch (err) {
    // Two indexes are reachable. `zones_one_live_name_idx` on (location_id,
    // lower(btrim(name))) fires when the TARGET building already has a live zone by the
    // carried-forward name — the same index resolveTagToZone and bindZone map. `zones_pkey`
    // fires only on a uuid collision against new_tag_id. `zones_tag_serial_idx` cannot: the
    // new row's serial is left NULL, because the serial belongs to the physical card and the
    // card was just rewritten.
    if (err?.code === "23505") fail(409, err?.constraint === "zones_pkey" ? "id_in_use" : "duplicate_zone_name");
    throw err;
  }
  if (row) {
    const { retired_zone_id, ...zone } = row;
    return { status: 201, body: { zone, retired_zone_id } };
  }

  // Nothing happened — and by the CTE gating above, NOTHING happened, not "some of it". One
  // read to say which end was at fault, because the operator's next move differs completely:
  // pick another zone, bind this one first, or write a fresh card.
  const existing = await one("SELECT location_id FROM zones WHERE id = $1 AND active", [zoneId]);
  if (!existing) fail(404, "unknown_zone");
  if (existing.location_id === null) fail(409, "zone_unbound");
  // The old zone was fine, so the tag is what refused: 404 never reported, 409 already
  // something. Same two-way split every other resolve in this file uses.
  await resolvedOrUnknown(newTagId);
}

// 50 rows, fixed, not a client-supplied `limit`. The operator screen is a phone showing one
// month at one door; there is no caller with a reason to ask for a different page size, and
// a parameter nobody sets is a parameter nobody validates.
const ZONE_SHIFT_PAGE = 50;

/**
 * GET /operator/zones/:id/shifts?month=YYYY-MM&page=N -> who worked at this door this month,
 * and for how long.
 *
 * WHAT IS DELIBERATELY ABSENT, and it is a hard line (decision-54 §7, decision-6/42/43): no
 * rate, no euro figure of any kind, no client name. A zone is not a costing unit and an
 * operator is not on the payroll screen. Adding any of those columns here is a decision
 * record, not a patch.
 *
 * DURATION IS COMPUTED IN SQL, from the same COALESCE(end_time, now()) an open shift needs,
 * so a running shift shows the time so far rather than a blank — and so the phone never does
 * date arithmetic on two timestamps and a timezone.
 *
 * `month` DEFAULTS IN SQL (`date_trunc('month', CURRENT_DATE)`) and never in JS: this
 * codebase does not compute today's date in the process for business logic — one clock, the
 * database's, or the boundary moves depending on which machine answered.
 * ponytail: CURRENT_DATE is the SERVER's date, so on the first/last hour of a month a
 * UTC-configured box names the neighbouring month. The ceiling is one hour a month on a
 * screen with no money on it; the fix, if it ever matters, is the same Vienna conversion
 * v.isoMonth already does for revenue.
 *
 * A SECOND QUERY FOR THE TOTAL, not a sum of this page. Summing in the phone would total
 * whatever 50 rows it happens to be holding and label it "the month" — the same class of lie
 * `shift_outside_count` exists to prevent in the admin log.
 */
async function listZoneShifts({ params, query }) {
  const zoneId = v.uuid(params.id, "id");
  const rawMonth = query.get("month");
  // NULL means "whatever month it is", decided by the SQL below.
  const month = rawMonth === null || rawMonth === "" ? null : v.isoMonth(rawMonth, "month");
  // 1-based on the wire, because that is what the screen shows. `optionalCount` rejects 0 and
  // anything non-integer, which is exactly the page-number contract.
  const page = v.optionalCount(query.get("page"), "page") ?? 1;
  const offset = (page - 1) * ZONE_SHIFT_PAGE;

  if (!(await one("SELECT id FROM zones WHERE id = $1 AND active", [zoneId]))) fail(404, "unknown_zone");

  // ONE predicate, written once and passed to both queries, so the page and the total can
  // never disagree about which rows the month contains. Cast on the parameter because an
  // untyped NULL has no type of its own (42P08) — the same note adminData carries.
  const inMonth =
    `(s.start_zone_id = $1 OR s.end_zone_id = $1)
       AND s.start_time >= COALESCE($2::date, date_trunc('month', CURRENT_DATE)::date)
       AND s.start_time <  COALESCE($2::date, date_trunc('month', CURRENT_DATE)::date) + INTERVAL '1 month'`;

  const [shifts, totals] = await Promise.all([
    all(
      `SELECT s.worker_id, w.name AS worker_name, s.start_time, s.end_time,
              EXTRACT(EPOCH FROM (COALESCE(s.end_time, now()) - s.start_time)) / 60 AS duration_minutes
         FROM shifts s
         JOIN workers w ON w.id = s.worker_id
        WHERE ${inMonth}
        ORDER BY s.start_time DESC NULLS LAST, s.id DESC
        LIMIT $3 OFFSET $4`,
      // `s.id DESC` is not cosmetic: without an id tiebreak, OFFSET paging over rows that tie
      // on start_time silently DROPS and DUPLICATES rows across pages — Postgres is free to
      // order ties differently per query, and it does. Two cleaners tapping the same door at
      // shift change is exactly that tie.
      [zoneId, month, ZONE_SHIFT_PAGE, offset],
    ),
    // Same WHERE, whole month, NOT paginated. COALESCE so an empty month is 0 and not null.
    one(
      `SELECT count(*)::int AS n,
              COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(s.end_time, now()) - s.start_time)) / 60), 0) AS total_minutes
         FROM shifts s WHERE ${inMonth}`,
      [zoneId, month],
    ),
  ]);

  return {
    status: 200,
    // `month` echoed so a paged screen can prove which window it is on rather than assume its
    // own — it may well be a month this request did not name.
    body: {
      shifts,
      page,
      page_size: ZONE_SHIFT_PAGE,
      matching: totals.n,
      total_minutes: totals.total_minutes,
      month: month ?? null,
    },
  };
}

/**
 * GET /operator/locations -> the building picker behind bind and resolve-zone.
 *
 * TWO COLUMNS, and the list stops there. Same minimal-disclosure posture GET /operator/zones
 * documents for itself: an operator is already entitled to know the buildings they mount
 * cards at, and nothing about picking one requires a rate, a contract, a client, an address
 * or a coordinate. ACTIVE ONLY — binding a zone into a building nobody cleans any more is a
 * mistake the picker should not offer in the first place.
 */
async function listLocations() {
  const locations = await all("SELECT id, name FROM locations WHERE active ORDER BY name");
  return { status: 200, body: { locations } };
}

export const operatorRoutes = [
  { method: "POST", path: "/operator/tags", auth: "operator", handler: reportTag },
  { method: "POST", path: "/operator/tags/:id/resolve-zone", auth: "operator", handler: resolveTagToZone },
  { method: "GET", path: "/operator/tags/:id", auth: "operator", handler: classifyTag },
  { method: "POST", path: "/operator/zones/:id/reassign-building", auth: "operator", handler: reassignZoneBuilding },
  { method: "GET", path: "/operator/locations", auth: "operator", handler: listLocations },
  { method: "GET", path: "/operator/zones", auth: "operator", handler: listZones },
  { method: "GET", path: "/operator/zones/:id", auth: "operator", handler: getZone },
  { method: "GET", path: "/operator/zones/:id/shifts", auth: "operator", handler: listZoneShifts },
  { method: "POST", path: "/operator/zones/:id/bind", auth: "operator", handler: bindZone },
  { method: "POST", path: "/operator/zones/:id/unbind", auth: "operator", handler: unbindZone },
  { method: "POST", path: "/operator/zones/:id/verify", auth: "operator", handler: verifyZone },
];
