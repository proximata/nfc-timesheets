// Operator-session action routes. `auth: "operator"` \u2014 X-App-Key AND a live ts_operator
// session (decision-45). OPERATOR-MODEL.md is explicit about the job: "he reads and writes
// tags". This file is that job's server half.
//
// STRUCTURAL, NOT A PROMISE: nothing in this file, and nothing reachable through an
// operator session anywhere in this codebase, opens or closes a shift. That absence is
// what makes "an operator does not clock in" true regardless of what any handler does or
// forgets to do \u2014 see check-api.js's own mutation-tested pin on that exact invariant.
import { one } from "../lib/db.js";
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

export const operatorRoutes = [{ method: "POST", path: "/operator/tags", auth: "operator", handler: reportTag }];
