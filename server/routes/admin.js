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
  hashToken,
  recordLoginFailure,
  sessionCookie,
  verifyPassword,
} from "../lib/auth.js";
import { all, one, query } from "../lib/db.js";
import { fail } from "../lib/http.js";
import * as v from "../lib/validate.js";
import { newPortalToken, portalPath } from "./portal.js";

const SHIFT_PAGE_DEFAULT = 500;
const SHIFT_PAGE_MAX = 2000;

// Columns returned for a worker. `email` is here because the admin has to be able to
// SEE what they registered — it is the only thing standing between a worker and a
// permanent "not eligible" screen, and a typo in it is invisible otherwise.
// `apple_sub` is deliberately NOT here: it is an opaque credential identifier, the
// admin can do nothing with it, and it has no business in a browser or a log.
// `phone` was the second of the two fields asked for for a cleaner (name, phone). Like
// email it is contact data, not a credential.
const WORKER_COLS = "id, name, email, phone, hourly_rate_cents, active, created_at";

// The building, including the four contract facts added in 003. All four are NULLable:
// buildings existed before the columns did and the director fills them in over weeks.
const LOCATION_COLS =
  "id, slug, name, address, lat, lng, active, created_at, " +
  "client_id, contact_id, monthly_contract_cents, target_minutes_per_month";

const CLIENT_COLS = "id, name, active, created_at";
const CONTACT_COLS = "id, client_id, name, email, phone, active, created_at";
const INVENTORY_COLS = "id, name, kind, unit_cost_cents, active, created_at";
const INVENTORY_KINDS = ["product", "equipment"];

const PORTAL_TOKEN_HASH_RE = /^[0-9a-f]{64}$/;

// One shift shape for both admin write routes, so a field can never be returned by one and
// silently missing from the other.
const ADMIN_SHIFT_COLS =
  "id, worker_id, location_id, start_time, end_time, auto_closed, corrected_at, client_uuid, created_at";

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

  const [workers, locations, shifts, hours, clients, contacts, inventory, portalGrants] = await Promise.all([
    all(`SELECT ${WORKER_COLS} FROM workers ORDER BY active DESC, name`),
    // id is the UUID that goes on the tag; slug is the human handle (decision-21).
    // client_name / contact_name ride along so the buildings screen can show "Hausverwaltung
    // Meier - Frau Gruber" without a second request or a client-side join.
    all(
      `SELECT ${LOCATION_COLS.split(", ").map((c) => `l.${c}`).join(", ")},
              c.name AS client_name, ct.name AS contact_name
         FROM locations l
         LEFT JOIN clients c   ON c.id  = l.client_id
         LEFT JOIN contacts ct ON ct.id = l.contact_id
        ORDER BY l.active DESC, l.name`,
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
    all(`SELECT ${CLIENT_COLS} FROM clients ORDER BY active DESC, name`),
    all(`SELECT ${CONTACT_COLS} FROM contacts ORDER BY active DESC, name`),
    all(`SELECT ${INVENTORY_COLS} FROM inventory_items ORDER BY active DESC, kind, name`),
    // Live grants only. A revoked link is history the database keeps and the director has
    // no use for; showing it would only invite "can I un-revoke it?" (no: issue a new one).
    // token_hash is the handle the revoke button posts back. It is a SHA-256 and grants
    // nothing on its own — the raw token is returned exactly once, by the route that mints
    // it, and is unrecoverable afterwards.
    all(
      `SELECT g.token_hash, g.contact_id, g.location_id, g.created_at,
              ct.name AS contact_name, l.name AS location_name
         FROM portal_grants g
         JOIN contacts ct ON ct.id = g.contact_id
         JOIN locations l ON l.id  = g.location_id
        WHERE g.revoked_at IS NULL
        ORDER BY l.name, ct.name`,
    ),
  ]);

  return {
    status: 200,
    body: {
      workers,
      locations,
      shifts,
      hours,
      clients,
      contacts,
      inventory,
      portal_grants: portalGrants,
      shift_limit: limit,
    },
  };
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
  // The director asked for exactly two fields for a cleaner: name and phone. Optional,
  // because every worker row already on the box predates the column.
  const phone = v.optionalPhone(body.phone);

  // workers.email is UNIQUE: two people cannot share a login. Postgres raises 23505,
  // which would otherwise surface as a 500 with a constraint name in it.
  try {
    if (body.id === undefined || body.id === null) {
      const row = await one(
        `INSERT INTO workers (name, email, phone, hourly_rate_cents, active) VALUES ($1, $2, $3, $4, $5)
         RETURNING ${WORKER_COLS}`,
        [name, email, phone, rate, active],
      );
      return { status: 201, body: { worker: row } };
    }

    const row = await one(
      `UPDATE workers SET name = $2, email = $3, phone = $4, hourly_rate_cents = $5, active = $6 WHERE id = $1
       RETURNING ${WORKER_COLS}`,
      [v.id(body.id, "id"), name, email, phone, rate, active],
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
 * Resolve the (client, contact) pair for a building.
 *
 * DIRECTOR-FRIENDLY ASYMMETRY, on purpose: picking a point of contact is enough — the
 * company follows from the person, because a contact belongs to exactly one client. That
 * removes one field from the buildings form for the common case. If both are supplied they
 * must agree, or the building would claim to be contracted to one company while its named
 * contact works at another.
 *
 * Existence, NOT `active`: a building may point at a client that has since been
 * deactivated, and re-saving that building's address must not fail because of it.
 */
async function resolveClientAndContact(body) {
  const contactId = v.optionalId(body.contact_id, "contact_id");
  let clientId = v.optionalId(body.client_id, "client_id");

  if (contactId !== null) {
    const contact = await one("SELECT id, client_id FROM contacts WHERE id = $1", [contactId]);
    if (!contact) fail(422, "unknown_contact");
    if (clientId === null) clientId = contact.client_id;
    else if (clientId !== contact.client_id) fail(422, "contact_not_for_client");
  } else if (clientId !== null) {
    if (!(await one("SELECT id FROM clients WHERE id = $1", [clientId]))) fail(422, "unknown_client");
  }

  return { clientId, contactId };
}

/**
 * POST /admin/locations -> create (no id) or update (id, a UUID).
 * The id is generated by the database and is what gets written to the tag; it is never
 * chosen by the caller, so a location cannot be given a guessable identifier by hand.
 *
 * 003 added the four contract facts. monthly_contract_cents and target_minutes_per_month
 * stay NULL until the director types them: NULL means "nobody has told me", 0 means "free
 * of charge", and a profitability report has to be able to say "unknown" instead of
 * reporting a 100% loss on every building entered before the column existed.
 */
async function upsertLocation({ body }) {
  const locationSlug = v.slug(body.slug);
  const name = v.str(body.name, "name", { max: 160 });
  const address = v.optionalStr(body.address, "address", { max: 300 });
  const lat = v.coord(body.lat, "lat", 90);
  const lng = v.coord(body.lng, "lng", 180);
  const active = v.bool(body.active, "active", true);
  const monthly = v.optionalCents(body.monthly_contract_cents, "monthly_contract_cents");
  const targetMinutes = v.optionalMinutes(body.target_minutes_per_month, "target_minutes_per_month");
  const { clientId, contactId } = await resolveClientAndContact(body);

  const targetId = body.id === undefined || body.id === null ? null : v.uuid(body.id, "id");
  const clash = await one("SELECT id FROM locations WHERE slug = $1", [locationSlug]);
  if (clash && clash.id !== targetId) fail(409, "slug_taken");

  const values = [locationSlug, name, address, lat, lng, active, clientId, contactId, monthly, targetMinutes];

  if (targetId === null) {
    const row = await one(
      `INSERT INTO locations (slug, name, address, lat, lng, active,
                              client_id, contact_id, monthly_contract_cents, target_minutes_per_month)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${LOCATION_COLS}`,
      values,
    );
    return { status: 201, body: { location: row } };
  }

  const row = await one(
    `UPDATE locations SET slug = $2, name = $3, address = $4, lat = $5, lng = $6, active = $7,
            client_id = $8, contact_id = $9, monthly_contract_cents = $10, target_minutes_per_month = $11
     WHERE id = $1
     RETURNING ${LOCATION_COLS}`,
    [targetId, ...values],
  );
  if (!row) fail(404, "unknown_location");
  return { status: 200, body: { location: row } };
}

/**
 * DELETE /admin/locations/:id -> soft delete. The NFC tag stays physically valid but stops resolving.
 *
 * Also revokes every client-portal link for this building: we no longer clean it, so the
 * contract is over and the outsiders who could watch it must stop being able to. Not
 * relying on the admin remembering to click revoke first.
 */
async function deleteLocation({ params }) {
  const locationId = v.uuid(params.id, "id");
  const row = await one("UPDATE locations SET active = false WHERE id = $1 RETURNING id, active", [locationId]);
  if (!row) fail(404, "unknown_location");
  await query("UPDATE portal_grants SET revoked_at = now() WHERE location_id = $1 AND revoked_at IS NULL", [
    locationId,
  ]);
  return { status: 200, body: { location: row } };
}

// ---- clients, contacts, inventory -------------------------------------------------
// Same upsert idiom as POST /admin/workers throughout: ONE route per thing, no id in the
// body means create (201), an id means update (200). Deliberately not a second idiom with
// separate POST/PUT routes — the admin UI has one form per thing and one submit handler,
// and the director never learns the difference between adding and editing.
//
// DELETE is always a SOFT deactivate. History must survive: a shift from March has to keep
// naming the building, the client that was paying for it and the person we reported to.

/** POST /admin/clients {id?, name, active?} -> the company holding a contract. */
async function upsertClient({ body }) {
  const name = v.str(body.name, "name", { max: 160 });
  const active = v.bool(body.active, "active", true);

  if (body.id === undefined || body.id === null) {
    const row = await one(`INSERT INTO clients (name, active) VALUES ($1, $2) RETURNING ${CLIENT_COLS}`, [
      name,
      active,
    ]);
    return { status: 201, body: { client: row } };
  }

  const row = await one(`UPDATE clients SET name = $2, active = $3 WHERE id = $1 RETURNING ${CLIENT_COLS}`, [
    v.id(body.id, "id"),
    name,
    active,
  ]);
  if (!row) fail(404, "unknown_client");
  return { status: 200, body: { client: row } };
}

/**
 * DELETE /admin/clients/:id -> soft deactivate.
 *
 * Buildings keep pointing at it on purpose: silently unlinking them would lose the record
 * of who was paying, and a building with no client would then look like an unbilled one.
 * The admin UI is responsible for showing which buildings are affected before confirming.
 */
async function deleteClient({ params }) {
  const row = await one("UPDATE clients SET active = false WHERE id = $1 RETURNING id, active", [
    v.id(params.id, "id"),
  ]);
  if (!row) fail(404, "unknown_client");
  return { status: 200, body: { client: row } };
}

/**
 * POST /admin/contacts {id?, client_id, name, email?, phone?, active?} -> the point of contact.
 *
 * `email` is how the DIRECTOR recognises this person. IT IS NOT A LOGIN CREDENTIAL: there
 * is no password, no session and no auth path that reads it. Portal access is granted by
 * handing out a link (POST /admin/portal-grants), never by proving ownership of an inbox.
 */
async function upsertContact({ body }) {
  const clientId = v.id(body.client_id, "client_id");
  if (!(await one("SELECT id FROM clients WHERE id = $1", [clientId]))) fail(422, "unknown_client");
  const name = v.str(body.name, "name", { max: 160 });
  const email = v.optionalEmail(body.email);
  const phone = v.optionalPhone(body.phone);
  const active = v.bool(body.active, "active", true);

  if (body.id === undefined || body.id === null) {
    const row = await one(
      `INSERT INTO contacts (client_id, name, email, phone, active) VALUES ($1, $2, $3, $4, $5)
       RETURNING ${CONTACT_COLS}`,
      [clientId, name, email, phone, active],
    );
    return { status: 201, body: { contact: row } };
  }

  const row = await one(
    `UPDATE contacts SET client_id = $2, name = $3, email = $4, phone = $5, active = $6 WHERE id = $1
     RETURNING ${CONTACT_COLS}`,
    [v.id(body.id, "id"), clientId, name, email, phone, active],
  );
  if (!row) fail(404, "unknown_contact");
  return { status: 200, body: { contact: row } };
}

/**
 * DELETE /admin/contacts/:id -> soft deactivate AND revoke their portal links.
 *
 * The realistic reason a contact is deactivated is that they left the client company. Their
 * link must stop working at that moment, not whenever someone remembers it exists.
 */
async function deleteContact({ params }) {
  const contactId = v.id(params.id, "id");
  const row = await one("UPDATE contacts SET active = false WHERE id = $1 RETURNING id, active", [contactId]);
  if (!row) fail(404, "unknown_contact");
  await query("UPDATE portal_grants SET revoked_at = now() WHERE contact_id = $1 AND revoked_at IS NULL", [
    contactId,
  ]);
  return { status: 200, body: { contact: row } };
}

/**
 * POST /admin/inventory {id?, name, kind, unit_cost_cents?, active?} -> a product or a
 * piece of equipment. ONE route, one table, one screen (003): they differ by a label.
 * unit_cost_cents defaults to 0, i.e. "not priced yet", which is a real state.
 */
async function upsertInventoryItem({ body }) {
  const name = v.str(body.name, "name", { max: 160 });
  const kind = v.oneOf(body.kind, "kind", INVENTORY_KINDS);
  const cost = v.cents(body.unit_cost_cents, "unit_cost_cents");
  const active = v.bool(body.active, "active", true);

  if (body.id === undefined || body.id === null) {
    const row = await one(
      `INSERT INTO inventory_items (name, kind, unit_cost_cents, active) VALUES ($1, $2, $3, $4)
       RETURNING ${INVENTORY_COLS}`,
      [name, kind, cost, active],
    );
    return { status: 201, body: { item: row } };
  }

  const row = await one(
    `UPDATE inventory_items SET name = $2, kind = $3, unit_cost_cents = $4, active = $5 WHERE id = $1
     RETURNING ${INVENTORY_COLS}`,
    [v.id(body.id, "id"), name, kind, cost, active],
  );
  if (!row) fail(404, "unknown_item");
  return { status: 200, body: { item: row } };
}

/** DELETE /admin/inventory/:id -> soft deactivate. Past cost attribution must stay explicable. */
async function deleteInventoryItem({ params }) {
  const row = await one("UPDATE inventory_items SET active = false WHERE id = $1 RETURNING id, active", [
    v.id(params.id, "id"),
  ]);
  if (!row) fail(404, "unknown_item");
  return { status: 200, body: { item: row } };
}

// ---- client portal grants ---------------------------------------------------------

/**
 * POST /admin/portal-grants {contact_id, location_id} -> a shareable read-only link.
 *
 * THE RAW TOKEN IS RETURNED HERE AND NOWHERE ELSE, EVER. Only SHA-256(token) is stored
 * (reusing lib/auth.js hashToken — one hash helper for every bearer token in the system),
 * so this response cannot be reconstructed later. The UI must show it immediately as a
 * copyable link. Losing it is not a problem: re-posting the same pair issues a fresh link.
 *
 * Re-issuing REVOKES the previous live link for that (contact, building) pair. That is why
 * "Get link" can be a single button the director presses without thinking: the person they
 * are sharing with always has exactly one working link, and the old one dies.
 *
 * ACTIVE contact and ACTIVE building only. Handing a live link to someone who has been
 * removed, or for a building we no longer clean, is not a state worth being able to reach.
 */
async function createPortalGrant({ body }) {
  const contact = await one("SELECT id FROM contacts WHERE id = $1 AND active", [
    v.id(body.contact_id, "contact_id"),
  ]);
  if (!contact) fail(422, "unknown_contact");
  const location = await v.activeLocation(body.location_id, "location_id");

  await query(
    "UPDATE portal_grants SET revoked_at = now() WHERE contact_id = $1 AND location_id = $2 AND revoked_at IS NULL",
    [contact.id, location.id],
  );

  const token = newPortalToken();
  let row;
  try {
    row = await one(
      `INSERT INTO portal_grants (token_hash, contact_id, location_id) VALUES ($1, $2, $3)
       RETURNING token_hash, contact_id, location_id, created_at, revoked_at`,
      [hashToken(token), contact.id, location.id],
    );
  } catch (err) {
    // portal_grants_one_live_idx: another admin (or a double-clicked button) inserted a
    // live grant for this pair between our UPDATE and this INSERT. A retry succeeds.
    if (err?.code === "23505") fail(409, "conflict");
    throw err;
  }

  // `path` and not a full URL: the server has no configured public origin, and inventing a
  // required env var to build a string the browser already knows would be a deploy change.
  // The admin UI prefixes location.origin.
  return { status: 201, body: { grant: row, token, path: portalPath(token) } };
}

/**
 * DELETE /admin/portal-grants/:token_hash -> revoke. One click, immediate.
 *
 * The URL carries the HASH, which is what /admin/data lists; the raw token is not
 * recoverable and the admin never needs it. Revoking is an UPDATE, so "we stopped sharing
 * this in March" stays answerable. Idempotent: revoking an already-revoked grant is 200.
 */
async function revokePortalGrant({ params }) {
  const tokenHash = String(params.token_hash ?? "").toLowerCase();
  if (!PORTAL_TOKEN_HASH_RE.test(tokenHash)) fail(400, "invalid_field", "token_hash");
  const row = await one(
    `UPDATE portal_grants SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1
     RETURNING token_hash, contact_id, location_id, created_at, revoked_at`,
    [tokenHash],
  );
  if (!row) fail(404, "unknown_grant");
  return { status: 200, body: { grant: row } };
}

/**
 * POST /admin/shifts {worker_id, location_id, start_time, end_time} -> create a shift that
 * was never tapped.
 *
 * WHY THIS EXISTS (journey J5b/J5c): a worker whose phone died, or who found the tag
 * destroyed, worked a real day. Without this route that day cannot exist — the person is
 * paid EUR 0 and the only recovery is hand-written SQL on the production box, which is not
 * a payroll process.
 *
 * SAME INVARIANTS AS THE TAP PATH, because this writes into the same payroll data:
 *   - a real, ACTIVE worker      (v.activeWorkerById, as POST /shifts/open resolves it)
 *   - a real, ACTIVE location    (v.activeLocation, decision-15: never trusted, always resolved)
 *   - end after start, neither in the future (v.shiftWindow)
 *   - no overlap with any existing shift of that worker — including an OPEN one, which the
 *     database's partial unique index cannot catch here because this row is not open itself
 *
 * end_time is REQUIRED. An admin-created OPEN shift would compete with the phone for the
 * one-open-shift-per-worker slot and could block a real clock-in; a shift being typed in
 * after the fact is by definition already over.
 *
 * NO auto_closed: that column is a machine fact about the 8h timer and no human sets it.
 * NO new "added by hand" flag either — client_uuid IS that fact and is left NULL (see 003):
 * every phone-originated shift carries an idempotency key, so `client_uuid IS NULL` means
 * and can only mean "typed into the admin panel". A separate boolean would be a second
 * column stating the same thing, i.e. a column that can drift, which is exactly why
 * needs_correction was removed.
 */
async function createShift({ body }) {
  const worker = await v.activeWorkerById(body.worker_id);
  const location = await v.activeLocation(body.location_id, "location_id");
  const { start, end } = v.shiftWindow(body.start_time, body.end_time);

  // Half-open interval arithmetic: [start, end) overlaps [s.start_time, s.end_time).
  // COALESCE(end_time, 'infinity') makes a currently OPEN shift overlap everything after
  // its start, which is correct — the worker is still on the clock there, so they cannot
  // also have been at another building.
  const clash = await one(
    `SELECT ${ADMIN_SHIFT_COLS} FROM shifts
      WHERE worker_id = $1
        AND start_time < $3
        AND COALESCE(end_time, 'infinity'::timestamptz) > $2
      ORDER BY start_time
      LIMIT 1`,
    [worker.id, start, end],
  );
  // 409 with the offending shift, so the UI can say "Anna is already recorded at Neuhaus
  // 09:00-13:00" instead of an opaque error the director cannot act on.
  if (clash) return { status: 409, body: { error: "shift_overlap", shift: clash } };

  const row = await one(
    `INSERT INTO shifts (worker_id, location_id, start_time, end_time)
     VALUES ($1, $2, $3, $4)
     RETURNING ${ADMIN_SHIFT_COLS}`,
    [worker.id, location.id, start, end],
  );
  return { status: 201, body: { shift: row } };
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
     RETURNING ${ADMIN_SHIFT_COLS}`,
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
  { method: "POST", path: "/admin/clients", auth: "admin", handler: upsertClient },
  { method: "DELETE", path: "/admin/clients/:id", auth: "admin", handler: deleteClient },
  { method: "POST", path: "/admin/contacts", auth: "admin", handler: upsertContact },
  { method: "DELETE", path: "/admin/contacts/:id", auth: "admin", handler: deleteContact },
  { method: "POST", path: "/admin/inventory", auth: "admin", handler: upsertInventoryItem },
  { method: "DELETE", path: "/admin/inventory/:id", auth: "admin", handler: deleteInventoryItem },
  { method: "POST", path: "/admin/portal-grants", auth: "admin", handler: createPortalGrant },
  { method: "DELETE", path: "/admin/portal-grants/:token_hash", auth: "admin", handler: revokePortalGrant },
  { method: "POST", path: "/admin/shifts", auth: "admin", handler: createShift },
  { method: "PATCH", path: "/admin/shifts/:id", auth: "admin", handler: patchShift },
];
