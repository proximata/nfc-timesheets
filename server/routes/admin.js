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
import { CODE_TTL_MS, newEnrolmentCode } from "../lib/enrolment.js";
import { geocode } from "../lib/geocode.js";
import { fail } from "../lib/http.js";
import {
  assertTransition,
  M_MATERIAL_REQUEST_COLS,
  MATERIAL_OPEN_STATUSES,
  MATERIAL_REQUEST_COLS,
  MATERIAL_STATUSES,
} from "../lib/materials.js";
import { buildingAnalytics, profitAndLoss } from "../lib/reporting.js";
import * as v from "../lib/validate.js";
import { newPortalToken, portalPath } from "./portal.js";

const SHIFT_PAGE_DEFAULT = 500;
const SHIFT_PAGE_MAX = 2000;
const MATERIAL_REQUEST_PAGE = 500;

// Trend length for GET /admin/analytics, in Vienna calendar months.
const TREND_MONTHS_DEFAULT = 6;
const TREND_MONTHS_MAX = 24;

// Columns returned for a worker. `email` is here because the admin has to be able to
// SEE what they registered — it is the only thing standing between a worker and a
// permanent "not eligible" screen, and a typo in it is invisible otherwise.
// `apple_sub` is deliberately NOT here: it is an opaque credential identifier, the
// admin can do nothing with it, and it has no business in a browser or a log.
// `phone` was the second of the two fields asked for for a cleaner (name, phone). Like
// email it is contact data, not a credential.
//
// The two enrolment_code_* timestamps are STATE, not the secret: "this worker has a live
// code until 14:32" and "they enrolled on the 3rd". enrolment_code_hash is deliberately
// absent, exactly like apple_sub — the panel can do nothing with it and it has no
// business in a browser or a log. The code itself is returned once, by the route that
// mints it, and is unrecoverable afterwards.
const WORKER_COLS =
  "id, name, email, phone, hourly_rate_cents, active, created_at, " +
  "enrolment_code_expires_at, enrolment_code_redeemed_at";

// The building, including the four contract facts added in 003 and the two geocoding
// facts added in 005. All NULLable: buildings existed before the columns did, the director
// fills contract figures in over weeks, and geocoding is allowed to fail.
//
// monthly_contract_cents / target_minutes_per_month are now a MIRROR of the building's
// CURRENT location_contracts row (005). They stay here so /locations/, /reinigung/ and the
// already-shipped iOS build keep working unchanged; `syncContractFromLocation` +
// `mirrorLocationFromContract` below are the only writers, and check-api.js asserts the
// two never disagree. Two sources of truth are only safe when one is derived and something
// fails loudly when it drifts.
const LOCATION_COLS =
  "id, slug, name, address, lat, lng, active, created_at, " +
  "client_id, contact_id, monthly_contract_cents, target_minutes_per_month, " +
  "geocoded_at, geocode_status, street_view_status";

const CONTRACT_COLS =
  "id, location_id, client_id, monthly_contract_cents, target_minutes_per_month, " +
  "valid_from, valid_to, note, created_at";

// Vienna's own idea of "today". Contract validity is a CALENDAR DATE, so `now()::date`
// in whatever zone the server runs in would move a price change by a day for anything
// entered between midnight UTC and midnight Vienna — i.e. every evening.
const VIENNA_TODAY = "(now() AT TIME ZONE 'Europe/Vienna')::date";

// Settings the panel is allowed to write, and what a legal value is. An allowlist and not
// a free key/value POST: app_settings is read by the P&L, so an arbitrary key is at best
// dead weight and at worst a typo that silently disables the margin flag
// (`pl_margin_baseline_bpp`, and nothing ever says why nothing is flagged).
const SETTINGS = {
  // Margin floor in BASIS POINTS. Signed on purpose: "do not lose more than 5%" (-500) is
  // a target a cleaning company can legitimately set for a building it is winning back.
  pl_margin_baseline_bp: (value, field) => {
    const n = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isSafeInteger(n) || n < -10_000 || n > 10_000) fail(400, "invalid_field", field);
    return String(n);
  },
};

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

/**
 * GET /admin/data -> everything the admin panel renders in one round trip.
 *
 * `?from=` / `?to=` bound the reporting period, half-open `[from, to)` on `start_time`.
 * BOTH the `shifts` rows and the `hours` aggregate use the SAME predicate, because the
 * whole point of the parameter is that a screen can never show a total for one range next
 * to the rows of another. Omitting either end leaves that side unbounded, which is exactly
 * what every caller got before the parameter existed (the iOS app sends neither).
 *
 * A shift belongs to the period its START falls in — the same rule as `startsWithin` in
 * web/lib/payroll.ts. One rule, stated in both places, or the two disagree at month end.
 *
 * Boundaries arrive as UTC instants; Vienna wall time is converted by the caller
 * (web/lib/period.ts), which is where the DST arithmetic lives and is tested.
 */
async function adminData({ query }) {
  const rawLimit = query.get("limit");
  const limit = rawLimit === null ? SHIFT_PAGE_DEFAULT : Math.min(v.id(rawLimit, "limit"), SHIFT_PAGE_MAX);
  const { from, to } = v.optionalRange(query.get("from"), query.get("to"));
  // Cast once: a NULL parameter has no type of its own, and `$1 IS NULL` on an untyped
  // parameter is a 42P08 from Postgres.
  const inRange =
    "($1::timestamptz IS NULL OR s.start_time >= $1) AND ($2::timestamptz IS NULL OR s.start_time < $2)";

  const [
    workers,
    locations,
    shifts,
    hours,
    clients,
    contacts,
    inventory,
    portalGrants,
    bounds,
    materialRequests,
    settings,
  ] = await Promise.all([
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
       WHERE ${inRange}
       ORDER BY s.start_time DESC
       LIMIT $3`,
      [from, to, limit],
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
         AND ${inRange}
       GROUP BY s.worker_id, w.hourly_rate_cents`,
      [from, to],
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
    // The full extent of the ledger: NOT bounded by from/to and NOT capped by limit.
    // Without it an empty `shifts` array is ambiguous between "nobody worked in the period
    // you asked for" and "the data is gone", and the admin panel has no way to tell the
    // director which one it is. Two aggregates over an indexed column.
    one("SELECT min(start_time) AS earliest, max(start_time) AS latest FROM shifts"),
    // NOT bounded by from/to. A request submitted in June that is still unordered in
    // August is exactly the row the director needs to see while looking at August, and a
    // period filter would hide it. Open ones first, then recent history; the cap is a
    // ceiling on the response, not a filter with an opinion.
    all(
      `SELECT ${M_MATERIAL_REQUEST_COLS},
              w.name AS worker_name, l.name AS location_name, i.name AS item_name
         FROM material_requests m
         JOIN workers w             ON w.id = m.worker_id
         LEFT JOIN locations l      ON l.id = m.location_id
         LEFT JOIN inventory_items i ON i.id = m.inventory_item_id
        ORDER BY (m.status = ANY ($1::text[])) DESC, m.created_at DESC
        LIMIT ${MATERIAL_REQUEST_PAGE}`,
      [MATERIAL_OPEN_STATUSES],
    ),
    // Operator-set numbers this codebase must not invent (005). An EMPTY object is the
    // normal, supported state on a fresh box: nothing is configured, so nothing is flagged.
    all("SELECT key, value, updated_at FROM app_settings"),
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
      material_requests: materialRequests,
      material_request_limit: MATERIAL_REQUEST_PAGE,
      settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
      shift_limit: limit,
      // Echoed so a screen can prove what it is showing rather than assume it.
      shift_range: { from: from === null ? null : from.toISOString(), to: to === null ? null : to.toISOString() },
      shift_bounds: {
        earliest: bounds.earliest === null ? null : bounds.earliest.toISOString(),
        latest: bounds.latest === null ? null : bounds.latest.toISOString(),
      },
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

// ---- worker enrolment codes (decision-26) -----------------------------------------

/**
 * POST /admin/workers/:id/enrolment-code -> a short code the worker types once.
 *
 * THE PLAINTEXT IS RETURNED HERE AND NOWHERE ELSE, EVER. Only SHA-256(code) is stored
 * (hashToken — one hash helper for every bearer token in this system), so this response
 * cannot be reconstructed: not by GET /admin/data, not from a pg_dump, not by us. The UI
 * must show it immediately. Losing it is not a problem — press the button again.
 *
 * Re-issuing REPLACES the worker's previous code, because the column IS the code: one
 * person, one live code, no separate table (decision-26). redeemed_at is reset with it so
 * the issued_at / issued_by / redeemed_at trio always describes ONE code.
 *
 * ACTIVE workers only. A live enrolment code for someone who has been let go is not a
 * state worth being able to reach, and requireWorkerSession would refuse the session it
 * produced anyway.
 */
async function issueEnrolmentCode({ params, session }) {
  const worker = await one("SELECT id, name FROM workers WHERE id = $1 AND active", [v.id(params.id, "id")]);
  if (!worker) fail(404, "unknown_worker");

  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  // workers.enrolment_code_hash is UNIQUE so a code can never name two workers. A
  // collision is ~1 in 2^40 per issue; retrying is two lines and removes the case where
  // the director's button answers 500 for a reason nobody could ever reproduce.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { code, display } = newEnrolmentCode();
    try {
      await query(
        `UPDATE workers
            SET enrolment_code_hash = $2,
                enrolment_code_expires_at = $3,
                enrolment_code_issued_at = now(),
                enrolment_code_issued_by = $4,
                enrolment_code_redeemed_at = NULL
          WHERE id = $1`,
        [worker.id, hashToken(code), expiresAt, session.adminId],
      );
      return {
        status: 201,
        body: {
          worker: { id: worker.id, name: worker.name },
          code: display,
          expires_at: expiresAt.toISOString(),
        },
      };
    } catch (err) {
      if (err?.code !== "23505") throw err;
    }
  }
  fail(503, "code_unavailable");
}

/**
 * DELETE /admin/workers/:id/enrolment-code -> revoke. One click, immediate.
 *
 * decision-26: "a code read aloud over the phone to the wrong person is the expected
 * failure mode". Clearing the hash is the revocation — the next redemption finds no row
 * and gets the same 401 as a code that never existed.
 *
 * Idempotent, and 200 whether or not there was a code: the director pressing revoke twice
 * must not see an error, and "was there a live code?" is answerable from the response.
 * issued_at / issued_by survive, because "who handed this out" is the question worth
 * asking after a code goes to the wrong person.
 *
 * Existing SESSIONS are untouched on purpose. Revoking a code means "this code may no
 * longer be exchanged", not "log everyone out"; the button for the latter is
 * DELETE /admin/workers/:id, which deactivates and kills the sessions.
 */
async function revokeEnrolmentCode({ params }) {
  const row = await one(
    `UPDATE workers
        SET enrolment_code_hash = NULL, enrolment_code_expires_at = NULL
      WHERE id = $1
      RETURNING ${WORKER_COLS}`,
    [v.id(params.id, "id")],
  );
  if (!row) fail(404, "unknown_worker");
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
 * locations.* <- the building's CURRENT contract row. The ONLY place those two columns are
 * derived, so "the mirror disagrees with the contract" is a state one function owns.
 * No current contract => both NULL, which is "nobody has told me", not "free of charge".
 */
async function mirrorLocationFromContract(locationId) {
  await query(
    `UPDATE locations l
        SET monthly_contract_cents   = c.monthly_contract_cents,
            target_minutes_per_month = c.target_minutes_per_month
       FROM location_contracts c
      WHERE c.location_id = l.id AND c.valid_to IS NULL AND l.id = $1`,
    [locationId],
  );
  await query(
    `UPDATE locations SET monthly_contract_cents = NULL, target_minutes_per_month = NULL
      WHERE id = $1
        AND NOT EXISTS (SELECT 1 FROM location_contracts c WHERE c.location_id = $1 AND c.valid_to IS NULL)`,
    [locationId],
  );
}

/**
 * The buildings FORM writes a contract figure, and that has to reach location_contracts or
 * the P&L keeps reading a price nobody entered there.
 *
 * IT EDITS THE CURRENT PERIOD IN PLACE; it does not open a new one. A director correcting
 * a typo in the buildings form means "this number was always wrong", not "the price changed
 * today" — and silently minting a period boundary would split a month's revenue between a
 * wrong figure and a right one. Recording an actual price CHANGE is an explicit, dated
 * action: POST /admin/locations/:id/contracts.
 *
 * Clearing the figure closes the current period as of today rather than deleting it: we
 * stop knowing the price from now on, we do not stop having known it in March. Closing on
 * the day it opened yields a zero-day period, which the 005 CHECK allows precisely so
 * "entered and cleared the same afternoon" has an honest representation.
 */
async function syncContractFromLocation(locationId, monthly, targetMinutes, clientId) {
  const current = await one(
    "SELECT id, valid_from FROM location_contracts WHERE location_id = $1 AND valid_to IS NULL",
    [locationId],
  );

  if (monthly === null) {
    if (current) {
      await query(`UPDATE location_contracts SET valid_to = GREATEST(valid_from, ${VIENNA_TODAY}) WHERE id = $1`, [
        current.id,
      ]);
    }
  } else if (current) {
    await query(
      "UPDATE location_contracts SET monthly_contract_cents = $2, target_minutes_per_month = $3, client_id = $4 WHERE id = $1",
      [current.id, monthly, targetMinutes, clientId],
    );
  } else {
    await query(
      `INSERT INTO location_contracts (location_id, client_id, monthly_contract_cents,
                                       target_minutes_per_month, valid_from, note)
       VALUES ($1, $2, $3, $4, ${VIENNA_TODAY}, 'Aus dem Gebäudeformular')`,
      [locationId, clientId, monthly, targetMinutes],
    );
  }

  await mirrorLocationFromContract(locationId);
}

/**
 * Geocode a building and write the result. NEVER THROWS, never blocks a save.
 *
 * Called AFTER the row exists, on purpose: the building is already committed, so no
 * outcome of this function can turn into "your building was not saved because Google was
 * down". `geocoded_at` is stamped whichever way it goes, which is what makes "we asked and
 * got nothing" distinguishable from "nobody has asked yet" (005_v2_features.sql) — without
 * that the panel cannot tell a missing pin from an unattempted one and would either
 * re-query on every render or never offer a retry.
 *
 * lat/lng are cleared on a failed re-geocode of a CHANGED address on purpose: a pin
 * pointing at the previous tenant's street is worse than no pin.
 */
async function applyGeocode(locationId, address) {
  const geo = await geocode(address);
  return one(
    `UPDATE locations
        SET lat = $2, lng = $3, geocode_status = $4, street_view_status = $5, geocoded_at = now()
      WHERE id = $1
      RETURNING ${LOCATION_COLS}`,
    [locationId, geo.lat, geo.lng, geo.status, geo.street_view_status],
  );
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
 *
 * 005 adds GEOCODING, and it runs after the row is written, never before. An explicit
 * lat/lng in the body always wins — a human who has dropped the pin themselves is more
 * authoritative than a geocoder, and re-querying would overwrite their correction.
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

  // Ask Google only when there is a question. A building whose address has not changed and
  // has already been looked up is not re-queried on every save of an unrelated field —
  // that would burn quota to learn nothing, and quota exhaustion is how the NEXT building
  // ends up unpinned.
  const existing =
    targetId === null ? null : await one("SELECT address, geocoded_at FROM locations WHERE id = $1", [targetId]);
  if (targetId !== null && !existing) fail(404, "unknown_location");
  const manualPin = lat !== null || lng !== null;
  const shouldGeocode =
    !manualPin && address !== null && (existing === null || existing.address !== address || existing.geocoded_at === null);

  const values = [locationSlug, name, address, lat, lng, active, clientId, contactId, monthly, targetMinutes];

  let row;
  let status;
  if (targetId === null) {
    row = await one(
      `INSERT INTO locations (slug, name, address, lat, lng, active,
                              client_id, contact_id, monthly_contract_cents, target_minutes_per_month)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${LOCATION_COLS}`,
      values,
    );
    status = 201;
  } else {
    // The geocoding metadata DESCRIBES lat/lng, so it cannot outlive them.
    //
    // This UPDATE writes every column, so a caller that omits `lat`/`lng` clears them
    // (LocationInput in web/lib/api.ts documents that, and both panel call sites pass the
    // row's current values back). Before 005 that cost nothing, because lat/lng were
    // always NULL anyway. Now it strands the row: coordinates gone, but `geocoded_at`
    // still set and `geocode_status` still saying 'OK'. That row is then invisible to
    // BOTH repair paths - `shouldGeocode` above is false while `geocoded_at` is not null,
    // and bin/geocode-backfill.js selects on `geocoded_at IS NULL` unless run with
    // --retry-failed. A building would sit permanently unpinned while its own status
    // column claimed it was on the map.
    //
    // So: only when a coordinate that WAS set is being nulled. A building whose geocode
    // legitimately failed (lat already NULL, status 'ZERO_RESULTS') keeps its reason and
    // does not get re-queried on every unrelated save - that reason is the difference
    // between "fix the address" and "try again later", and burning quota to re-learn it is
    // how the NEXT building ends up unpinned.
    const clearsPin = "($5::double precision IS NULL AND lat IS NOT NULL)";
    row = await one(
      `UPDATE locations SET slug = $2, name = $3, address = $4, lat = $5, lng = $6, active = $7,
              client_id = $8, contact_id = $9, monthly_contract_cents = $10, target_minutes_per_month = $11,
              geocoded_at        = CASE WHEN ${clearsPin} THEN NULL ELSE geocoded_at        END,
              geocode_status     = CASE WHEN ${clearsPin} THEN NULL ELSE geocode_status     END,
              street_view_status = CASE WHEN ${clearsPin} THEN NULL ELSE street_view_status END
       WHERE id = $1
       RETURNING ${LOCATION_COLS}`,
      [targetId, ...values],
    );
    if (!row) fail(404, "unknown_location"); // deleted between the SELECT and here
    status = 200;
  }

  // THE BUILDING IS SAVED FROM HERE ON. Everything below is enrichment and none of it is
  // allowed to take that back.
  await syncContractFromLocation(row.id, monthly, targetMinutes, clientId);
  if (shouldGeocode) row = (await applyGeocode(row.id, address)) ?? row;

  return { status, body: { location: await one(`SELECT ${LOCATION_COLS} FROM locations WHERE id = $1`, [row.id]) } };
}

/**
 * POST /admin/locations/:id/geocode -> "erneut geokodieren".
 *
 * The retry button, and the backfill path for every building entered before 005 existed
 * (bin/geocode-backfill.js drives this same helper). Answers 200 with the row whether or
 * not a pin came back — "we asked again and Google still has nothing" is a successful
 * request with a null answer, not a server error, and the response carries `geocoded_at`
 * so the panel can say when we last tried.
 */
async function geocodeLocation({ params }) {
  const locationId = v.uuid(params.id, "id");
  const current = await one("SELECT id, address FROM locations WHERE id = $1", [locationId]);
  if (!current) fail(404, "unknown_location");
  // Nothing to geocode is a client error worth naming: the fix is to type an address, and
  // silently answering 200 with no pin would look like Google's fault.
  if (!current.address) fail(422, "location_has_no_address");
  return { status: 200, body: { location: await applyGeocode(locationId, current.address) } };
}

// ---- contract history (005) -------------------------------------------------------
//
// WHAT THIS BUYS AND WHAT IT DOES NOT. A period-scoped price makes the REVENUE line of the
// P&L honest: March is valued at the March price even after a September increase.
//
// THE COST LINE STAYS DISHONEST, and the API says so out loud in `labour.rate_basis`
// (lib/reporting.js). `workers.hourly_rate_cents` is one mutable column with no history, so
// raising a wage silently rewrites every past month's labour cost. Fixing that means a
// `worker_rates` table that PAYROLL reads — changing the arithmetic of a system in daily
// use with real money attached. That is a decision record, not a commit.

/** GET /admin/locations/:id/contracts -> the price history, newest first. */
async function listContracts({ params }) {
  const locationId = v.uuid(params.id, "id");
  if (!(await one("SELECT id FROM locations WHERE id = $1", [locationId]))) fail(404, "unknown_location");
  const contracts = await all(
    `SELECT ${CONTRACT_COLS} FROM location_contracts WHERE location_id = $1 ORDER BY valid_from DESC, id DESC`,
    [locationId],
  );
  return { status: 200, body: { contracts } };
}

/**
 * POST /admin/locations/:id/contracts {monthly_contract_cents, target_minutes_per_month?,
 *                                      valid_from, note?}
 * -> the price changed, from this day.
 *
 * Closes the current period at `valid_from` (half-open, so the old price's last day is the
 * day before) and opens a new one. `valid_from` must be strictly after the current period
 * started and not before any closed period ended — overlapping periods would make "the
 * price on 3 March" have two answers, and the P&L would count both.
 *
 * Non-overlap is checked HERE and not by an EXCLUDE constraint: that needs btree_gist, and
 * a Postgres extension on a live payroll box is not worth one guarded INSERT (005).
 * ponytail: CEILING — two admins posting concurrently could interleave past this check.
 * There is one admin. UPGRADE PATH: btree_gist + EXCLUDE.
 */
async function createContract({ params, body }) {
  const locationId = v.uuid(params.id, "id");
  const location = await one("SELECT id, client_id FROM locations WHERE id = $1", [locationId]);
  if (!location) fail(404, "unknown_location");

  const monthly = v.cents(body.monthly_contract_cents, "monthly_contract_cents");
  const targetMinutes = v.optionalMinutes(body.target_minutes_per_month, "target_minutes_per_month");
  const validFrom = v.isoDate(body.valid_from, "valid_from");
  const note = v.optionalStr(body.note, "note", { max: 500 });
  // The company holding the contract AT THE TIME. Defaults to the building's current
  // client because that is nearly always right; overridable because a handover is exactly
  // when a new contract period gets recorded.
  const clientId = body.client_id === undefined ? location.client_id : v.optionalId(body.client_id, "client_id");

  const boundary = await one(
    `SELECT max(valid_from) FILTER (WHERE valid_to IS NULL) AS current_from,
            max(valid_to)                                  AS last_closed_to
       FROM location_contracts WHERE location_id = $1`,
    [locationId],
  );
  // Dates arrive as 'YYYY-MM-DD' strings (lib/db.js pins the `date` parser precisely so
  // they are not silently shifted a day by a timezone), and that format sorts lexically.
  const notAfter = (a, b) => a !== null && b !== null && a <= b;
  if (notAfter(validFrom, boundary.current_from)) fail(409, "contract_overlap", "valid_from");
  if (boundary.current_from === null && notAfter(validFrom, boundary.last_closed_to)) {
    fail(409, "contract_overlap", "valid_from");
  }

  await query(
    "UPDATE location_contracts SET valid_to = $2 WHERE location_id = $1 AND valid_to IS NULL",
    [locationId, validFrom],
  );
  const contract = await one(
    `INSERT INTO location_contracts (location_id, client_id, monthly_contract_cents,
                                     target_minutes_per_month, valid_from, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${CONTRACT_COLS}`,
    [locationId, clientId, monthly, targetMinutes, validFrom, note],
  );
  await mirrorLocationFromContract(locationId);
  return { status: 201, body: { contract } };
}

/**
 * DELETE /admin/contracts/:id -> undo a contract period that was entered wrong.
 *
 * ONLY THE CURRENT ONE. A closed period has already been used to value a month somebody
 * has seen a report for; deleting it would silently rewrite that month with no trace.
 * Removing the current row REOPENS its predecessor — the price reverts to what it was
 * before the mistake, rather than the building falling to "no contract on file".
 */
async function deleteContract({ params }) {
  const contractId = v.id(params.id, "id");
  const contract = await one(`SELECT ${CONTRACT_COLS} FROM location_contracts WHERE id = $1`, [contractId]);
  if (!contract) fail(404, "unknown_contract");
  if (contract.valid_to !== null) fail(409, "contract_not_current");

  await query("DELETE FROM location_contracts WHERE id = $1", [contractId]);
  await query(
    `UPDATE location_contracts SET valid_to = NULL
      WHERE id = (SELECT id FROM location_contracts WHERE location_id = $1
                   ORDER BY valid_from DESC, id DESC LIMIT 1)`,
    [contract.location_id],
  );
  await mirrorLocationFromContract(contract.location_id);
  return { status: 200, body: { contract, deleted: true } };
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

// ---- material requests (admin side) -----------------------------------------------

/**
 * PATCH /admin/material-requests/:id -> validate, price and advance a worker's request.
 *
 * `status` is a TRANSITION REQUEST, not an assignment: lib/materials.js holds the legal
 * moves and `assertTransition` refuses the rest. Without that, a panel bug or a replayed
 * request could jump `submitted` straight to `arrived` and stamp `ordered_at`, putting a
 * cost into a period in which nothing was ever ordered.
 *
 * The three timestamps are stamped BY THE SERVER at the moment of the transition and are
 * not settable from the body. `ordered_at` in particular is what pins a cost to a P&L
 * period, so a client that could choose it could move a spend between months.
 *
 * WHAT THIS ROUTE DOES NOT DO: guess. There is no fuzzy match from the worker's free text
 * to an inventory item, no default quantity and no default cost. `cost_cents` left NULL
 * means UNPRICED — the P&L excludes it from the pool and reports how many it excluded,
 * which is a visible "somebody still has to type the invoice", not a silent zero.
 *
 * Cost, quantity, item and note stay editable after arrival on purpose: an invoice turns
 * up late. The period does not move with it, because `ordered_at` is already fixed.
 */
async function patchMaterialRequest({ params, body, session }) {
  const requestId = v.id(params.id, "id");
  const current = await one("SELECT id, status FROM material_requests WHERE id = $1", [requestId]);
  if (!current) fail(404, "unknown_request");

  const next = body.status === undefined || body.status === null ? null : v.oneOf(body.status, "status", MATERIAL_STATUSES);
  if (next !== null && next !== current.status) assertTransition(current.status, next);
  const status = next ?? current.status;

  // A rejected request is a closed refusal. Editing its cost would be attributing money to
  // something we declined to buy.
  if (current.status === "rejected") fail(409, "request_rejected");

  const adminNote = body.admin_note === undefined ? undefined : v.optionalStr(body.admin_note, "admin_note", { max: 1000 });
  const quantity = body.quantity === undefined ? undefined : v.optionalCount(body.quantity, "quantity");
  const costCents = body.cost_cents === undefined ? undefined : v.optionalCents(body.cost_cents, "cost_cents");
  const locationId = body.location_id === undefined ? undefined : v.optionalUuid(body.location_id, "location_id");

  let itemId;
  if (body.inventory_item_id !== undefined) {
    itemId = v.optionalId(body.inventory_item_id, "inventory_item_id");
    // Existence, not `active`: mapping an old request to a product that has since been
    // deactivated is exactly what happens when the invoice arrives after the shelf change.
    if (itemId !== null && !(await one("SELECT id FROM inventory_items WHERE id = $1", [itemId]))) {
      fail(422, "unknown_item");
    }
  }
  if (locationId !== undefined && locationId !== null) {
    if (!(await one("SELECT id FROM locations WHERE id = $1", [locationId]))) fail(422, "unknown_location");
  }
  const decided = next === "approved" || next === "rejected";
  const row = await one(
    `UPDATE material_requests
        SET status            = $2,
            admin_note        = COALESCE($3, admin_note),
            quantity          = COALESCE($4, quantity),
            cost_cents        = COALESCE($5, cost_cents),
            inventory_item_id = COALESCE($6, inventory_item_id),
            location_id       = COALESCE($7, location_id),
            decided_by        = CASE WHEN $8 THEN $9 ELSE decided_by END,
            decided_at        = CASE WHEN $8 THEN now() ELSE decided_at END,
            ordered_at        = CASE WHEN $2 = 'ordered' AND ordered_at IS NULL THEN now() ELSE ordered_at END,
            arrived_at        = CASE WHEN $2 = 'arrived' AND arrived_at IS NULL THEN now() ELSE arrived_at END
      WHERE id = $1
      RETURNING ${MATERIAL_REQUEST_COLS}`,
    [
      requestId,
      status,
      // COALESCE means "absent leaves it alone". An explicit null in the body therefore
      // cannot CLEAR a field — stated here rather than discovered later. Clearing a cost
      // that was typed wrong is done by typing the right one; clearing it to "unpriced"
      // is not a thing the director has asked for and inventing a sentinel for it would
      // be a second meaning for null.
      adminNote ?? null,
      quantity ?? null,
      costCents ?? null,
      itemId ?? null,
      locationId ?? null,
      decided,
      session.adminId,
    ],
  );
  return { status: 200, body: { request: row } };
}

// ---- reports (005) ----------------------------------------------------------------

/**
 * GET /admin/pl?from=&to= -> revenue minus labour minus materials, per building.
 *
 * BOTH ends are REQUIRED (`v.requiredRange`). Revenue is a monthly contract pro-rated over
 * the days of the period, so an unbounded end is either infinitely many days or a default
 * month the caller never asked for. Refusing beats guessing.
 *
 * Boundaries are UTC instants on the wire; every calendar question inside is answered in
 * Europe/Vienna by Postgres (lib/reporting.js). The arithmetic — decision-6's pro-rata
 * split, decision-10's exclusions, and every "we do not know this" — lives there.
 */
async function plReport({ query: q }) {
  const { from, to } = v.requiredRange(q.get("from"), q.get("to"));
  return { status: 200, body: await profitAndLoss(from, to) };
}

/**
 * GET /admin/analytics?from=&to=&months= -> actual vs target time, plus a trend and the
 * map state for every building.
 *
 * `months` is the trend length in Vienna calendar months, clamped rather than rejected:
 * asking for 200 months of a two-year-old company is a UI slider at its end stop, not an
 * attack, and 24 buckets x 11 buildings is already more than a screen can show.
 */
async function analyticsReport({ query: q }) {
  const { from, to } = v.requiredRange(q.get("from"), q.get("to"));
  const raw = q.get("months");
  const months = raw === null ? TREND_MONTHS_DEFAULT : Math.min(v.id(raw, "months"), TREND_MONTHS_MAX);
  return { status: 200, body: await buildingAnalytics(from, to, months) };
}

// ---- settings ---------------------------------------------------------------------

/**
 * POST /admin/settings {key, value} -> the operator tells us a number we refuse to invent.
 *
 * Today there is exactly one: `pl_margin_baseline_bp`. NOTHING inserts a default for it,
 * and with it unset the P&L flags no building at all and says "Zielmarge nicht gesetzt".
 * A hardcoded 15% would be this codebase having an opinion about a Viennese cleaning
 * company's margins, which it has no basis for.
 *
 * The key is checked against an allowlist, not stored freely: app_settings is READ by the
 * P&L, so `pl_margin_baseline_bpp` would be accepted, stored, and then quietly do nothing
 * forever while the director wonders why no building is ever flagged.
 */
async function putSetting({ body }) {
  const key = v.oneOf(body.key, "key", Object.keys(SETTINGS));
  const value = SETTINGS[key](body.value, "value");
  const row = await one(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     RETURNING key, value, updated_at`,
    [key, value],
  );
  return { status: 200, body: { setting: row } };
}

/**
 * DELETE /admin/settings/:key -> back to "nobody has told me".
 *
 * Unsetting has to be reachable. Without it the first value ever typed becomes permanent
 * policy, and "I do not want buildings flagged any more" would have no expression except a
 * baseline so low it is a lie.
 */
async function deleteSetting({ params }) {
  const key = v.oneOf(params.key, "key", Object.keys(SETTINGS));
  await query("DELETE FROM app_settings WHERE key = $1", [key]);
  // Idempotent, and the body states the RESULTING state rather than whether a row happened
  // to be there: deleting an already-unset key must not look like a failure to the panel.
  return { status: 200, body: { setting: { key, value: null } } };
}

export const adminRoutes = [
  { method: "POST", path: "/admin/login", auth: null, handler: login },
  { method: "POST", path: "/admin/logout", auth: "admin", handler: logout },
  { method: "GET", path: "/admin/session", auth: "admin", handler: whoami },
  { method: "GET", path: "/admin/data", auth: "admin", handler: adminData },
  { method: "POST", path: "/admin/workers", auth: "admin", handler: upsertWorker },
  { method: "DELETE", path: "/admin/workers/:id", auth: "admin", handler: deleteWorker },
  { method: "POST", path: "/admin/workers/:id/enrolment-code", auth: "admin", handler: issueEnrolmentCode },
  { method: "DELETE", path: "/admin/workers/:id/enrolment-code", auth: "admin", handler: revokeEnrolmentCode },
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
  { method: "PATCH", path: "/admin/material-requests/:id", auth: "admin", handler: patchMaterialRequest },
  { method: "POST", path: "/admin/locations/:id/geocode", auth: "admin", handler: geocodeLocation },
  { method: "GET", path: "/admin/locations/:id/contracts", auth: "admin", handler: listContracts },
  { method: "POST", path: "/admin/locations/:id/contracts", auth: "admin", handler: createContract },
  { method: "DELETE", path: "/admin/contracts/:id", auth: "admin", handler: deleteContract },
  { method: "GET", path: "/admin/pl", auth: "admin", handler: plReport },
  { method: "GET", path: "/admin/analytics", auth: "admin", handler: analyticsReport },
  { method: "POST", path: "/admin/settings", auth: "admin", handler: putSetting },
  { method: "DELETE", path: "/admin/settings/:key", auth: "admin", handler: deleteSetting },
];
