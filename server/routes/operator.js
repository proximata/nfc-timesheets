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
 */
async function listZones() {
  const zones = await all(
    `SELECT z.id, z.location_id, l.name AS location_name, z.name, z.tag_serial,
            z.tag_deployed_at, z.verified_at
       FROM zones z
       JOIN locations l ON l.id = z.location_id
      WHERE z.active AND l.active
      ORDER BY (z.verified_at IS NOT NULL), l.name, z.name`,
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

export const operatorRoutes = [
  { method: "POST", path: "/operator/tags", auth: "operator", handler: reportTag },
  { method: "GET", path: "/operator/zones", auth: "operator", handler: listZones },
  { method: "POST", path: "/operator/zones/:id/verify", auth: "operator", handler: verifyZone },
];
