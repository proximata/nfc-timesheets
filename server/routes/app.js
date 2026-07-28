// App routes. Consumed by the iOS client.
// Handlers are pure(ish): (ctx) -> { status, body }. No node:http types leak in here,
// so a later move to Hono/Edge is a re-wiring job, not a rewrite (decision-16).
//
// decision-22 — WHO THE CALLER IS COMES FROM `session`, NEVER FROM `body`.
// Every route below is `auth: "worker"`: X-App-Key proves "our app" and the ts_worker
// cookie proves "this person". `body.worker_id` is GONE from POST /shifts/open and
// `?worker=` is gone from the two GETs — they were a caller-supplied identity, which
// meant anyone with the app key could file, read or resolve hours as anyone else.
// If you are about to read a worker id out of a request, you are reintroducing that
// hole; read it from `session.workerId` instead.
//
// decision-19 — a shift has TWO halves, not one POST:
//   tap in  -> POST /shifts/open   creates the row with end_time NULL
//   tap out -> POST /shifts/close  fills end_time in
// The server is therefore authoritative for "who is clocked in right now", and every
// running shift is visible to the 8h auto-close timer while it is still running. Under
// the old single-POST-on-completion design the timer, the partial index, /unresolved
// and /resolve were all unreachable machinery: end_time was never NULL server-side.
//
// Both halves are idempotent on client_uuid. The phone retries on flaky network and a
// double tap at the door must not produce two rows or two invoices.
import { all, one } from "../lib/db.js";
import { fail } from "../lib/http.js";
import * as v from "../lib/validate.js";

// Every shift response has the same shape. `auto_closed` + `corrected_at` are the two
// decision-10 facts; the client derives "needs resolution" as
// `auto_closed && corrected_at === null`. No third flag exists to disagree with them.
const SHIFT_FIELDS = [
  "id",
  "worker_id",
  "location_id",
  "start_time",
  "end_time",
  "auto_closed",
  "corrected_at",
  "client_uuid",
];
const SHIFT_COLS = SHIFT_FIELDS.join(", ");
const S_SHIFT_COLS = SHIFT_FIELDS.map((c) => `s.${c}`).join(", "); // for the joined queries

// Unique/exclusion violations. `ON CONFLICT DO NOTHING` swallows these on the insert
// path, so this is a belt-and-braces map: whatever raises them, the caller gets a 409
// with a reason, never a 500 with a Postgres error string.
const CONFLICT_CODES = new Set(["23505", "23P01"]);

/**
 * GET /roster -> who I am + the locations that resolve. One round trip on launch.
 *
 * The `workers` array is GONE (decision-22). It existed to populate the Settings
 * Picker, and that picker WAS the vulnerability. Shipping the full staff roster to
 * anyone holding the app key is now a pointless disclosure: the app never needs to
 * name a worker, because the server already knows which one is calling.
 */
async function roster({ session }) {
  // `id` is the UUID the tag carries (decision-21). `slug` rides along for display
  // and log lines only and must never be put back into a tag URI.
  const locations = await all(
    "SELECT id, slug, name, address, lat, lng FROM locations WHERE active ORDER BY name",
  );
  // hourly_rate_cents deliberately omitted: pay data is admin-only.
  return { status: 200, body: { worker: { id: session.workerId, name: session.name }, locations } };
}

/**
 * POST /shifts/open {client_uuid, location_uuid, start_time}
 * -> creates an OPEN shift (end_time NULL) FOR THE SIGNED-IN WORKER.
 *
 * `worker_id` is not in that list and is not read even if a client sends one. It used
 * to be the only statement of who was clocking in, and it was unauthenticated: the
 * whole point of decision-22 is that this line now comes from the session.
 *
 * No `activeWorkerById` lookup either — requireWorkerSession already joined `workers`
 * and enforced `active`, so re-checking would be a second round trip to learn something
 * we were just told.
 *
 * 201 new / 200 duplicate (same client_uuid, first write wins) /
 * 409 shift_already_open (this worker is already clocked in under a different key).
 */
async function openShift({ body, session }) {
  const clientUuid = v.clientUuid(body.client_uuid);
  const workerId = session.workerId;
  const location = await v.activeLocation(body.location_uuid);
  const start = v.timestamp(body.start_time, "start_time");

  // No conflict TARGET on purpose. Two unique indexes can fire here — client_uuid and
  // shifts_one_open_per_worker_idx — and a plain retry trips BOTH. Naming one arbiter
  // would leave the other to raise 23505 and surface as a 500, and which index
  // Postgres reaches first is not ours to decide. Bare DO NOTHING absorbs either, and
  // the two lookups below tell them apart with certainty.
  let inserted;
  try {
    inserted = await one(
      `INSERT INTO shifts (worker_id, location_id, start_time, client_uuid)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING ${SHIFT_COLS}`,
      [workerId, location.id, start, clientUuid],
    );
  } catch (err) {
    if (!CONFLICT_CODES.has(err?.code)) throw err;
    inserted = null;
  }
  if (inserted) return { status: 201, body: { shift: inserted, duplicate: false } };

  // Same client_uuid => this is a retry of a request that already landed. Return the
  // stored row unchanged; the first write wins and the phone converges on it.
  const existing = await one(`SELECT ${SHIFT_COLS} FROM shifts WHERE client_uuid = $1`, [clientUuid]);
  if (existing) return { status: 200, body: { shift: existing, duplicate: true } };

  // Different client_uuid => the worker is clocked in somewhere already. Say so, with
  // the offending shift, so the app can offer "close that one first" instead of
  // showing an opaque error.
  const open = await one(`SELECT ${SHIFT_COLS} FROM shifts WHERE worker_id = $1 AND end_time IS NULL`, [
    workerId,
  ]);
  if (open) return { status: 409, body: { error: "shift_already_open", shift: open } };

  // Raced a concurrent close/delete: neither row is there any more. Retrying works.
  fail(409, "conflict");
}

/**
 * POST /shifts/close {client_uuid, end_time, auto_closed?} -> fills in end_time.
 *
 * NO duration ceiling here. The old 422 shift_too_long rejected exactly the case the
 * safety net was built for — the worker who forgets to tap out — and left them unable
 * to close the shift at all. The 8h timer owns that case now (decision-10).
 *
 * `auto_closed` (default false) is set by the APP when it closes a shift the worker did
 * not deliberately end — today that means: they tapped a different building without
 * tapping out here first. The end time is then the moment they arrived somewhere ELSE,
 * so the walk between sites is billed to this building and no human ever confirmed it.
 * Flagging it routes the shift through the same resolution screen as an 8h timeout, so
 * the invariant holds: no shift reaches payroll with an end time nobody confirmed.
 * A normal tap-out omits the field and stays a clean, already-confirmed close.
 */
async function closeShift({ body, session }) {
  const clientUuid = v.clientUuid(body.client_uuid);
  const autoClosed = v.bool(body.auto_closed, "auto_closed");

  // Scoped to the session's worker. client_uuid is a random UUID and so not practically
  // guessable, but "hard to guess" is not authorisation — one worker must not be able to
  // clock another one out. 404 rather than 403 for someone else's shift: an existence
  // oracle is not worth the marginally better error message.
  const current = await one(`SELECT ${SHIFT_COLS} FROM shifts WHERE client_uuid = $1 AND worker_id = $2`, [
    clientUuid,
    session.workerId,
  ]);
  if (!current) fail(404, "unknown_shift");

  // Already closed: either a retry of this same call, or the 8h timer got there first.
  // Idempotent, so answer 200 with the row as it stands. When it was the timer, the
  // row carries auto_closed=true and corrected_at=null and the app routes the worker
  // to the resolution screen — closing does NOT silently resolve it.
  if (current.end_time !== null) {
    return { status: 200, body: { shift: current, duplicate: true } };
  }

  const { end } = v.shiftWindow(current.start_time, body.end_time);

  // auto_closed is only ever raised, never cleared: a client that omits the flag must not
  // silently downgrade a shift the 8h timer already flagged.
  const updated = await one(
    `UPDATE shifts SET end_time = $2, auto_closed = auto_closed OR $3
      WHERE client_uuid = $1 AND worker_id = $4 AND end_time IS NULL RETURNING ${SHIFT_COLS}`,
    [clientUuid, end, autoClosed, session.workerId],
  );
  if (updated) return { status: 200, body: { shift: updated, duplicate: false } };

  // Lost the race with a concurrent close (or the timer) between the SELECT and the
  // UPDATE. Re-read and report the winner rather than erroring: the shift IS closed,
  // which is what the caller asked for.
  const raced = await one(`SELECT ${SHIFT_COLS} FROM shifts WHERE client_uuid = $1 AND worker_id = $2`, [
    clientUuid,
    session.workerId,
  ]);
  if (!raced) fail(404, "unknown_shift");
  return { status: 200, body: { shift: raced, duplicate: true } };
}

/**
 * GET /shifts/open -> MY currently open shift, or null.
 * The phone asks the server rather than trusting local state (decision-19): an app
 * reinstall, a second device or a background NFC tap must not lose a running shift.
 * The `?worker=` parameter is gone — it let any app-key holder watch any worker.
 */
async function currentOpenShift({ session }) {
  const shift = await one(
    `SELECT ${S_SHIFT_COLS}, l.slug AS location_slug, l.name AS location_name
       FROM shifts s
       JOIN locations l ON l.id = s.location_id
      WHERE s.worker_id = $1 AND s.end_time IS NULL`,
    [session.workerId],
  );
  return { status: 200, body: { shift: shift ?? null } };
}

/**
 * GET /shifts/unresolved -> shifts I must correct (decision-10).
 * "Unresolved" is derived, not stored: the timer closed it AND no human has fixed it.
 * Scoped to the session, so this can no longer be used to read another worker's history.
 */
async function unresolvedShifts({ session }) {
  const shifts = await all(
    `SELECT ${S_SHIFT_COLS}, l.slug AS location_slug, l.name AS location_name
       FROM shifts s
       JOIN locations l ON l.id = s.location_id
      WHERE s.worker_id = $1 AND s.auto_closed AND s.corrected_at IS NULL
      ORDER BY s.start_time`,
    [session.workerId],
  );
  return { status: 200, body: { shifts } };
}

/**
 * POST /shifts/:id/resolve {end_time} -> the worker supplies the real end time.
 * Sets end_time and stamps corrected_at. auto_closed is left TRUE on purpose: it is a
 * historical fact about how the shift ended and payroll disputes need it.
 */
async function resolveShift({ params, body, session }) {
  const shiftId = v.id(params.id, "id");
  // `AND worker_id = $2` is load-bearing: shift ids are sequential, so without it a
  // worker could walk the id space and stamp made-up end times onto other people's
  // payroll. Someone else's id answers 404, exactly as a nonexistent one does.
  const shift = await one(
    "SELECT id, start_time, auto_closed, corrected_at FROM shifts WHERE id = $1 AND worker_id = $2",
    [shiftId, session.workerId],
  );
  if (!shift) fail(404, "unknown_shift");
  if (!shift.auto_closed || shift.corrected_at !== null) fail(409, "already_resolved");

  const { end } = v.shiftWindow(shift.start_time, body.end_time);
  const updated = await one(
    `UPDATE shifts
        SET end_time = $2, corrected_at = now()
      WHERE id = $1 AND worker_id = $3 AND auto_closed AND corrected_at IS NULL
      RETURNING ${SHIFT_COLS}`,
    [shiftId, end, session.workerId],
  );
  if (!updated) fail(409, "already_resolved"); // concurrent resolve won
  return { status: 200, body: { shift: updated } };
}

// Every one of these is `auth: "worker"` — X-App-Key AND a signed-in worker. There is
// no app-key-only shift route left; that combination is what made body.worker_id
// authoritative in the first place.
export const appRoutes = [
  { method: "GET", path: "/roster", auth: "worker", handler: roster },
  { method: "POST", path: "/shifts/open", auth: "worker", handler: openShift },
  { method: "GET", path: "/shifts/open", auth: "worker", handler: currentOpenShift },
  { method: "POST", path: "/shifts/close", auth: "worker", handler: closeShift },
  { method: "GET", path: "/shifts/unresolved", auth: "worker", handler: unresolvedShifts },
  { method: "POST", path: "/shifts/:id/resolve", auth: "worker", handler: resolveShift },
];
