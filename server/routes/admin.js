// Admin routes. Consumed by the Next.js admin.
//
// Auth is an email + password login that mints a server-side session cookie
// (decision-20). The X-Admin-Pin header is gone: a short shared secret with no rate
// limit is not defensible on a host that has to be publicly reachable for AASA.
// /admin/login is the only route here that is NOT behind a session.
import {
  checkLoginRate,
  clearLoginFailures,
  clearedSessionCookie,
  createSession,
  decoy,
  destroySession,
  destroyWorkerSessions,
  recordLoginFailure,
  sessionCookie,
  verifyPassword,
} from "../lib/auth.js";
import { all, one } from "../lib/db.js";
import { fail } from "../lib/http.js";
import * as v from "../lib/validate.js";

const SHIFT_PAGE_DEFAULT = 500;
const SHIFT_PAGE_MAX = 2000;

// Columns returned for a worker. `email` is here because the admin has to be able to
// SEE what they registered — it is the only thing standing between a worker and a
// permanent "not eligible" screen, and a typo in it is invisible otherwise.
// `apple_sub` is deliberately NOT here: it is an opaque credential identifier, the
// admin can do nothing with it, and it has no business in a browser or a log.
const WORKER_COLS = "id, name, email, hourly_rate_cents, active, created_at";

// Bounds on the login payload. The upper limits are not a password policy, they cap
// how much work an unauthenticated caller can make scrypt do per request.
const EMAIL_MAX = 320; // RFC 5321 practical maximum
const PASSWORD_MAX = 1024;

/**
 * POST /admin/login {email, password} -> session cookie.
 *
 * ONE failure response for every rejection: unknown email, wrong password, malformed
 * input. Anything else would turn this route into an account-enumeration oracle.
 * A miss still runs scrypt against a decoy hash so the timing matches a hit too.
 */
async function login({ body, ip }) {
  checkLoginRate(ip); // 429 before any database or KDF work

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  let admin = null;
  if (email !== "" && email.length <= EMAIL_MAX && password !== "" && password.length <= PASSWORD_MAX) {
    // Stored lower-cased (see 001_init.sql), so this is a plain unique-index hit.
    admin = await one("SELECT id, email, password_hash FROM admins WHERE email = $1", [email]);
  }

  const ok = await verifyPassword(password, admin ? admin.password_hash : await decoy());
  if (!ok || !admin) {
    recordLoginFailure(ip);
    fail(401, "invalid_credentials");
  }

  clearLoginFailures(ip);
  const { token, expiresAt } = await createSession(admin.id);
  return {
    status: 200,
    body: { admin: { id: admin.id, email: admin.email } },
    headers: { "set-cookie": sessionCookie(token, expiresAt) },
  };
}

/** POST /admin/logout -> deletes the session row. Logout must actually revoke. */
async function logout({ session }) {
  await destroySession(session.token);
  return { status: 200, body: { ok: true }, headers: { "set-cookie": clearedSessionCookie() } };
}

/** GET /admin/session -> who am I. The admin UI uses it to decide login vs. dashboard. */
async function whoami({ session }) {
  return { status: 200, body: { admin: { id: session.adminId, email: session.email } } };
}

/** GET /admin/data -> everything the admin panel renders in one round trip. */
async function adminData({ query }) {
  const rawLimit = query.get("limit");
  const limit = rawLimit === null ? SHIFT_PAGE_DEFAULT : Math.min(v.id(rawLimit, "limit"), SHIFT_PAGE_MAX);

  const [workers, locations, shifts, hours] = await Promise.all([
    all(`SELECT ${WORKER_COLS} FROM workers ORDER BY active DESC, name`),
    // id is the UUID that goes on the tag; slug is the human handle (decision-21).
    all(
      "SELECT id, slug, name, address, lat, lng, active, created_at FROM locations ORDER BY active DESC, name",
    ),
    all(
      `SELECT s.id, s.worker_id, w.name AS worker_name,
              s.location_id, l.slug AS location_slug, l.name AS location_name,
              s.start_time, s.end_time, s.auto_closed, s.corrected_at,
              s.client_uuid, s.created_at
       FROM shifts s
       JOIN workers w ON w.id = s.worker_id
       JOIN locations l ON l.id = s.location_id
       ORDER BY s.start_time DESC
       LIMIT $1`,
      [limit],
    ),
    // Payroll excludes open shifts (no end_time yet) and unresolved auto-closed ones
    // (decision-10): a start+8h stub is a placeholder, not hours worked. Once a human
    // stamps corrected_at the shift counts again, auto_closed or not.
    all(
      `SELECT s.worker_id,
              SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0)::numeric(12,3) AS hours,
              ROUND(SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0) * w.hourly_rate_cents) AS pay_cents
       FROM shifts s
       JOIN workers w ON w.id = s.worker_id
       WHERE s.end_time IS NOT NULL AND NOT (s.auto_closed AND s.corrected_at IS NULL)
       GROUP BY s.worker_id, w.hourly_rate_cents`,
    ),
  ]);

  return { status: 200, body: { workers, locations, shifts, hours, shift_limit: limit } };
}

/**
 * POST /admin/workers -> create (no id) or update (id).
 *
 * `email` is the pre-authorisation for Sign in with Apple (decision-22): a worker can
 * only ever log in if an ACTIVE row already carries the address Apple hands back. This
 * route is therefore the only enrolment path there is, which is the point — owning an
 * Apple ID is not a job.
 *
 * It is also where a Hide My Email address gets entered. The worker hits the dead-end
 * screen, reads the x@privaterelay.appleid.com address off it to their manager, and the
 * manager pastes it in here. That is the whole mechanism; there is no approval queue.
 *
 * Changing the email of a worker who has ALREADY signed in does not lock them out and
 * does not let someone else in: matching prefers apple_sub, which stays bound to the row.
 */
async function upsertWorker({ body }) {
  const name = v.str(body.name, "name", { max: 120 });
  const rate = v.cents(body.hourly_rate_cents);
  const active = v.bool(body.active, "active", true);
  const email = v.optionalEmail(body.email); // normalised to lower case, or null

  // workers.email is UNIQUE: two people cannot share a login. Postgres raises 23505,
  // which would otherwise surface as a 500 with a constraint name in it.
  try {
    if (body.id === undefined || body.id === null) {
      const row = await one(
        `INSERT INTO workers (name, email, hourly_rate_cents, active) VALUES ($1, $2, $3, $4)
         RETURNING ${WORKER_COLS}`,
        [name, email, rate, active],
      );
      return { status: 201, body: { worker: row } };
    }

    const row = await one(
      `UPDATE workers SET name = $2, email = $3, hourly_rate_cents = $4, active = $5 WHERE id = $1
       RETURNING ${WORKER_COLS}`,
      [v.id(body.id, "id"), name, email, rate, active],
    );
    if (!row) fail(404, "unknown_worker");
    return { status: 200, body: { worker: row } };
  } catch (err) {
    if (err?.code === "23505") fail(409, "email_taken");
    throw err;
  }
}

/**
 * DELETE /admin/workers/:id -> soft delete. Shift history must survive.
 *
 * Also revokes their app sessions. requireWorkerSession re-checks `active` on every
 * request, so this is not what makes the lockout work — but leaving valid session rows
 * behind for a person who has been let go is not a state worth keeping.
 */
async function deleteWorker({ params }) {
  const workerId = v.id(params.id, "id");
  const row = await one("UPDATE workers SET active = false WHERE id = $1 RETURNING id, active", [workerId]);
  if (!row) fail(404, "unknown_worker");
  await destroyWorkerSessions(workerId);
  return { status: 200, body: { worker: row } };
}

/**
 * POST /admin/locations -> create (no id) or update (id, a UUID).
 * The id is generated by the database and is what gets written to the tag; it is never
 * chosen by the caller, so a location cannot be given a guessable identifier by hand.
 */
async function upsertLocation({ body }) {
  const locationSlug = v.slug(body.slug);
  const name = v.str(body.name, "name", { max: 160 });
  const address = v.optionalStr(body.address, "address", { max: 300 });
  const lat = v.coord(body.lat, "lat", 90);
  const lng = v.coord(body.lng, "lng", 180);
  const active = v.bool(body.active, "active", true);

  const targetId = body.id === undefined || body.id === null ? null : v.uuid(body.id, "id");
  const clash = await one("SELECT id FROM locations WHERE slug = $1", [locationSlug]);
  if (clash && clash.id !== targetId) fail(409, "slug_taken");

  if (targetId === null) {
    const row = await one(
      `INSERT INTO locations (slug, name, address, lat, lng, active) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, slug, name, address, lat, lng, active, created_at`,
      [locationSlug, name, address, lat, lng, active],
    );
    return { status: 201, body: { location: row } };
  }

  const row = await one(
    `UPDATE locations SET slug = $2, name = $3, address = $4, lat = $5, lng = $6, active = $7
     WHERE id = $1
     RETURNING id, slug, name, address, lat, lng, active, created_at`,
    [targetId, locationSlug, name, address, lat, lng, active],
  );
  if (!row) fail(404, "unknown_location");
  return { status: 200, body: { location: row } };
}

/** DELETE /admin/locations/:id -> soft delete. The NFC tag stays physically valid but stops resolving. */
async function deleteLocation({ params }) {
  const row = await one("UPDATE locations SET active = false WHERE id = $1 RETURNING id, active", [
    v.uuid(params.id, "id"),
  ]);
  if (!row) fail(404, "unknown_location");
  return { status: 200, body: { location: row } };
}

/**
 * PATCH /admin/shifts/:id -> admin correction.
 * Merge-then-validate: the merged row must still be a sane shift.
 *
 * `auto_closed` is NOT patchable. It records what the 8h timer did and is a machine
 * fact; letting an admin flip it would make it as untrustworthy as the manual_finish
 * column it replaced.
 */
async function patchShift({ params, body }) {
  const shiftId = v.id(params.id, "id");
  const current = await one(
    "SELECT id, worker_id, location_id, start_time, end_time, auto_closed, corrected_at FROM shifts WHERE id = $1",
    [shiftId],
  );
  if (!current) fail(404, "unknown_shift");

  const workerId = body.worker_id === undefined ? current.worker_id : (await v.activeWorkerById(body.worker_id)).id;
  const locationId =
    body.location_id === undefined ? current.location_id : (await v.activeLocation(body.location_id, "location_id")).id;

  const startRaw = body.start_time === undefined ? current.start_time : body.start_time;
  const endRaw = body.end_time === undefined ? current.end_time : body.end_time;

  let start;
  let end = null;
  if (endRaw === null) {
    start = v.timestamp(startRaw, "start_time"); // still an open shift
  } else {
    ({ start, end } = v.shiftWindow(startRaw, endRaw));
  }

  // corrected_at means "a human supplied the real end time for a shift the 8h timer
  // had guessed at". It is stamped ONLY when this edit actually resolves such a shift.
  // The previous version stamped now() on EVERY admin edit, including edits to shifts
  // the timer never touched, which made the column mean nothing — a shift that was
  // never flagged came out looking corrected, and a genuine resolution was
  // indistinguishable from a typo fix to the address.
  const resolvesFlagged = current.auto_closed && current.corrected_at === null && end !== null;
  const correctedAt = resolvesFlagged ? new Date() : current.corrected_at;

  const row = await one(
    `UPDATE shifts
     SET worker_id = $2, location_id = $3, start_time = $4, end_time = $5, corrected_at = $6
     WHERE id = $1
     RETURNING id, worker_id, location_id, start_time, end_time, auto_closed,
               corrected_at, client_uuid, created_at`,
    [shiftId, workerId, locationId, start, end, correctedAt],
  );
  return { status: 200, body: { shift: row } };
}

export const adminRoutes = [
  { method: "POST", path: "/admin/login", auth: null, handler: login },
  { method: "POST", path: "/admin/logout", auth: "admin", handler: logout },
  { method: "GET", path: "/admin/session", auth: "admin", handler: whoami },
  { method: "GET", path: "/admin/data", auth: "admin", handler: adminData },
  { method: "POST", path: "/admin/workers", auth: "admin", handler: upsertWorker },
  { method: "DELETE", path: "/admin/workers/:id", auth: "admin", handler: deleteWorker },
  { method: "POST", path: "/admin/locations", auth: "admin", handler: upsertLocation },
  { method: "DELETE", path: "/admin/locations/:id", auth: "admin", handler: deleteLocation },
  { method: "PATCH", path: "/admin/shifts/:id", auth: "admin", handler: patchShift },
];
