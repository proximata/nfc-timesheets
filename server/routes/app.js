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
import * as Sentry from "@sentry/node";
import { all, one } from "../lib/db.js";
import { fail } from "../lib/http.js";
import { M_MATERIAL_REQUEST_COLS, MATERIAL_REQUEST_COLS } from "../lib/materials.js";
import * as v from "../lib/validate.js";

/**
 * The one deliberate piece of instrumentation on the clock-in path (decision-23).
 *
 * The question it answers, which nothing else could: "the worker says they tapped — did
 * the request arrive, and what did the server decide about it?" The access log has the
 * status code but not the idempotency key, so it cannot tell a fresh clock-in from the
 * phone's third retry of one, which is the difference between a bug and a working retry.
 * `ts.shift.outcome` also lands as a span attribute, so the same fact is readable both in
 * the log search (the needle) and in the trace waterfall next to the DB spans.
 *
 * The worker is NOT an attribute here: `Sentry.setUser({id})` in server.js already
 * attaches them to every event on this request. No names, no emails, no location slug —
 * a location UUID is meaningless outside our database, a building's name is not.
 */
function recordShift(event, attributes) {
  Sentry.getActiveSpan()?.setAttributes(attributes);
  Sentry.logger.info(event, attributes);
}

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
  if (inserted) {
    recordShift("shift open", {
      "ts.shift.client_uuid": clientUuid,
      "ts.shift.outcome": "created",
      "ts.location.id": location.id,
    });
    return { status: 201, body: { shift: inserted, duplicate: false } };
  }

  // Same client_uuid => this is a retry of a request that already landed. Return the
  // stored row unchanged; the first write wins and the phone converges on it.
  const existing = await one(`SELECT ${SHIFT_COLS} FROM shifts WHERE client_uuid = $1`, [clientUuid]);
  if (existing) {
    recordShift("shift open", {
      "ts.shift.client_uuid": clientUuid,
      "ts.shift.outcome": "duplicate",
      "ts.location.id": location.id,
    });
    return { status: 200, body: { shift: existing, duplicate: true } };
  }

  // Different client_uuid => the worker is clocked in somewhere already. Say so, with
  // the offending shift, so the app can offer "close that one first" instead of
  // showing an opaque error.
  const open = await one(`SELECT ${SHIFT_COLS} FROM shifts WHERE worker_id = $1 AND end_time IS NULL`, [
    workerId,
  ]);
  if (open) {
    recordShift("shift open", {
      "ts.shift.client_uuid": clientUuid,
      "ts.shift.outcome": "already_open",
      "ts.location.id": location.id,
    });
    return { status: 409, body: { error: "shift_already_open", shift: open } };
  }

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
    recordShift("shift close", {
      "ts.shift.client_uuid": clientUuid,
      "ts.shift.outcome": "duplicate",
      "ts.shift.auto_closed": current.auto_closed,
    });
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
  if (updated) {
    recordShift("shift close", {
      "ts.shift.client_uuid": clientUuid,
      "ts.shift.outcome": "closed",
      "ts.shift.duration_s": Math.round(
        (new Date(updated.end_time).getTime() - new Date(updated.start_time).getTime()) / 1000,
      ),
      "ts.shift.auto_closed": updated.auto_closed,
    });
    return { status: 200, body: { shift: updated, duplicate: false } };
  }

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
 *
 * THIS IS THE RECOVERY WIRE FOR THE IN-SHIFT LOCK, and it needed nothing added to it.
 * Both clients now take over the whole app while a shift runs and put a signal outside
 * the app (Android ongoing notification, iOS Live Activity + icon badge). All of those
 * are re-armed from THIS payload whenever the phone's own copy is gone — reinstall, new
 * phone, a signal the OS dropped. Every field the arming path needs is already here:
 *   start_time    the ticking clock, and the locally computed start+8h flip
 *   location_name the lock screen names the building with no second round trip
 *   location_id   "is the next tap the same building?"
 *   client_uuid   the idempotency key — without it an adopted shift can never be CLOSED
 *   auto_closed + corrected_at   decision-10's two facts, and nothing else
 * There is deliberately NO `auto_close_at` on the wire. A clock-in works offline, so the
 * client must be able to compute the 8h boundary from `start_time` with no response at
 * all; a server field would be a SECOND mechanism the client could never rely on. One
 * client-side constant beats two disagreeing sources. The window itself lives in
 * ops/sql/autoclose.sql and check-api.js runs that exact file against this route.
 *
 * NO OPEN SHIFT IS 200 {shift: null}, NEVER A 4xx. The clients treat a thrown call as
 * "unknown, keep what I have"; answering an error for the ordinary not-clocked-in case
 * would leave a stale lock screen and a stale notification on every worker between
 * shifts. A miss is an answer here, not a rejection.
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
 *
 * The other half of the recovery wire. When the 8h timer fires while the phone is offline
 * the shift stops being open, so GET /shifts/open goes null and the clients must flip the
 * lock screen from a running timer to "needs confirming" — a running clock on a shift the
 * server already closed is a lie. `location_name` is joined in for the same reason as
 * above: the flipped screen still has to name the building.
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
 * GET /shifts/mine?since=<iso8601> -> my shifts from `since` onwards, newest first.
 *
 * EXISTS FOR ONE CALLER: the on-device data migration (DataMigrations.swift) asks
 * "does the server already hold this client_uuid?" before it touches a legacy row.
 * Without an answer the migration would have to either duplicate the row or guess, and
 * guessing about somebody's hours is the thing the reconciliation rules forbid.
 *
 * Scoped to `session.workerId` like every other read here (decision-22). There is no
 * `?worker=` and there must never be one.
 *
 * `since` is REQUIRED and bounded: the client sends the oldest local row minus a day, so
 * an unbounded history dump is never needed and is never served. LIMIT is a second
 * ceiling on top of that — a phone reconciling a handful of rows does not need a year of
 * payroll on the wire.
 */
const MINE_LIMIT = 500;

async function myShifts({ query, session }) {
  const since = v.timestamp(query.get("since"), "since");
  const shifts = await all(
    `SELECT ${S_SHIFT_COLS}, l.slug AS location_slug, l.name AS location_name
       FROM shifts s
       JOIN locations l ON l.id = s.location_id
      WHERE s.worker_id = $1 AND s.start_time >= $2
      ORDER BY s.start_time DESC
      LIMIT ${MINE_LIMIT}`,
    [session.workerId, since],
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

// ---- material requests (worker side) ----------------------------------------------
//
// decision-22 ONCE MORE, and it is the whole security model of these three routes:
// `worker_id` comes from `session.workerId`. There is no `worker_id` in any body and no
// `?worker=` on any query here, and there must never be one — a material request names a
// person, carries their free text and (once priced) costs the company money.
//
// THERE IS NO PUSH NOTIFICATION IN THIS SYSTEM and these routes do not pretend otherwise.
// Server dependencies are pg + @sentry/node and nothing else (decision-23 amending
// decision-16); no APNs certificate, no FCM project and no device-token table exists. The
// clients POLL `GET /material-requests/mine` on launch and on refresh and raise a banner
// for rows the server marks `arrived` and not yet seen. The UI copy says so, because a
// worker who is told "you will be notified" and then is not has been lied to.
//   ponytail: polling. CEILING: a worker who never opens the app is never told.
//   UPGRADE PATH: APNs + FCM, which is a decision record, an Apple key and a Play
//   project — not a commit.

// The worker's own words. 2000 characters is roughly two screens of typing on a phone and
// is a cap on request size, not an opinion about how much detail is welcome.
const REQUEST_BODY_MAX = 2000;

/**
 * POST /material-requests {body, location_uuid?} -> a request in the worker's own words.
 *
 * `location_uuid` is OPTIONAL and is CONTEXT, never a cost attribution: it records the
 * building the worker had in mind, which is the one thing they actually know. decision-6
 * splits material cost pro-rata by labour hours and explicitly rejected per-request
 * building attribution, so nothing downstream charges this building for this bottle.
 *
 * Nothing is matched against `inventory_items` here. "der blaue Reiniger, der große" is
 * not a foreign key, and guessing which product was meant would put a wrong number into a
 * P&L with nobody able to see why. A human maps it in the admin panel or it stays free
 * text forever.
 *
 * NOT idempotent, deliberately — unlike a clock-in there is no client_uuid, because two
 * identical requests for mops on the same day is a real thing a worker might mean, and
 * silently swallowing the second one loses a request nobody can then find.
 */
async function createMaterialRequest({ body, session }) {
  const text = v.str(body.body, "body", { max: REQUEST_BODY_MAX });
  // Resolved server-side against ACTIVE locations exactly like a tap (decision-15): the
  // id may have come off an unlocked tag and unguessable is not authenticated.
  const locationId =
    body.location_uuid === undefined || body.location_uuid === null || body.location_uuid === ""
      ? null
      : (await v.activeLocation(body.location_uuid)).id;

  const row = await one(
    `INSERT INTO material_requests (worker_id, location_id, body) VALUES ($1, $2, $3)
     RETURNING ${MATERIAL_REQUEST_COLS}`,
    [session.workerId, locationId, text],
  );
  return { status: 201, body: { request: row } };
}

/**
 * GET /material-requests/mine -> MY requests, newest first.
 *
 * `WHERE worker_id = $1` is the entire access control and it is not optional: ids are
 * sequential, so without it any signed-in worker could read every colleague's requests,
 * which are free text people write about their own workplace.
 *
 * The location NAME rides along so the app can render "Neuhaus" without a second call.
 * The slug does not (decision-21): it is a human handle for the admin panel and log lines
 * and must never travel next to something a client could put back into a URL.
 */
const MINE_REQUEST_LIMIT = 200;

async function myMaterialRequests({ session }) {
  const requests = await all(
    `SELECT ${M_MATERIAL_REQUEST_COLS}, l.name AS location_name, i.name AS item_name
       FROM material_requests m
       LEFT JOIN locations l       ON l.id = m.location_id
       LEFT JOIN inventory_items i ON i.id = m.inventory_item_id
      WHERE m.worker_id = $1
      ORDER BY m.created_at DESC
      LIMIT ${MINE_REQUEST_LIMIT}`,
    [session.workerId],
  );
  return { status: 200, body: { requests } };
}

/**
 * POST /material-requests/:id/seen -> "I have read that it arrived".
 *
 * Only the owner's own rows and only once the admin has marked them `arrived`: stamping
 * `seen_at` on anything else would let a client clear its own arrival banner for a request
 * that has not arrived. Idempotent — COALESCE keeps the FIRST acknowledgement, so a
 * double tap does not rewrite when the worker actually found out.
 */
async function markMaterialRequestSeen({ params, session }) {
  const requestId = v.id(params.id, "id");
  const row = await one(
    `UPDATE material_requests SET seen_at = COALESCE(seen_at, now())
      WHERE id = $1 AND worker_id = $2 AND status = 'arrived'
      RETURNING ${MATERIAL_REQUEST_COLS}`,
    [requestId, session.workerId],
  );
  // 404 and not 403 for somebody else's row: an existence oracle over a colleague's
  // requests is not worth a better error message. Same rule as POST /shifts/:id/resolve.
  if (!row) fail(404, "unknown_request");
  return { status: 200, body: { request: row } };
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
  { method: "GET", path: "/shifts/mine", auth: "worker", handler: myShifts },
  { method: "POST", path: "/shifts/:id/resolve", auth: "worker", handler: resolveShift },
  { method: "POST", path: "/material-requests", auth: "worker", handler: createMaterialRequest },
  { method: "GET", path: "/material-requests/mine", auth: "worker", handler: myMaterialRequests },
  { method: "POST", path: "/material-requests/:id/seen", auth: "worker", handler: markMaterialRequestSeen },
];
