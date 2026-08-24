// Admin routes. Consumed by the Next.js admin.
//
// Auth is an email + password login that mints a server-side session cookie
// (decision-20). The X-Admin-Pin header is gone: a short shared secret with no rate
// limit is not defensible on a host that has to be publicly reachable for AASA.
// /admin/login is the only route here that is NOT behind a session.
import {
  checkGlobalSmsSpend,
  checkLoginRate,
  clearLoginFailures,
  clearedSessionCookie,
  createSession,
  decoy,
  destroyOperatorSessions,
  destroySession,
  destroyWorkerSessions,
  hashPassword,
  hashToken,
  recordLoginFailure,
  sessionCookie,
  SMS_OTP_REQUESTS_KEY,
  SMS_OTP_REQUESTS_MAX,
  SMS_OTP_REQUESTS_MIN,
  verifyPassword,
} from "../lib/auth.js";
import { all, one, query } from "../lib/db.js";
import { CODE_TTL_MS, newEnrolmentCode } from "../lib/enrolment.js";
import { geocode } from "../lib/geocode.js";
import { fail } from "../lib/http.js";
import { renderEnrolmentSms, senderName, sendSms, smsConfigured, smsStatus } from "../lib/sms.js";
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
// The four phone_* columns are migration 009 (TASK-225): what that worker's phone last
// told us it is still holding. They ride along in WORKER_COLS rather than in a separate
// query because every screen that lists workers is a screen where "this phone is holding
// two shifts" belongs — and because a fact behind its own endpoint is a fact nobody fetches.
const WORKER_COLS =
  "id, name, email, phone, hourly_rate_cents, active, created_at, " +
  "enrolment_code_expires_at, enrolment_code_redeemed_at, " +
  "phone_last_seen_at, phone_pending_shifts, phone_pending_blocked, phone_pending_oldest_start";

// An operator (decision-45). No email, no rate, no apple_sub — the columns that exist on
// `workers` for reasons that are all worker-specific. `enrolment_code_hash` is deliberately
// absent, exactly like WORKER_COLS: the panel can do nothing with it, the code itself is
// returned once by the route that mints it, and it has no business in a browser or a log.
const OPERATOR_COLS = "id, name, active, created_at, enrolment_code_expires_at, enrolment_code_redeemed_at";

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

// A zone (decision-43). `area_sqm` is NULLable and that is the point: a zone nobody has
// measured is real, and a required area would be an invented one poisoning the EUR/m2
// benchmark that is the only reason the column exists. `tag_serial` is ADOPTED hardware
// only (decision-44) — a tag we wrote carries this zone's id in its URL and has no serial
// on file. Neither is a credential and neither is ever authenticated on.
// `verified_at` / `verified_by_operator_id` (010, decision-47) ride along on every zone the
// admin reads, because „Wartet auf Testscan" is a state the director must SEE rather than
// discover when a cleaner phones. They are READ here and written NOWHERE in this file: no
// /admin/* route may stamp them, which is the whole guarantee the record buys — verification
// happens in the field, on an operator session, with the card in hand.
const ZONE_COLS =
  "id, location_id, name, note, area_sqm, tag_serial, tag_deployed_at, active, created_at, " +
  "verified_at, verified_by_operator_id";

// A typed monthly payment (decision-42). APPEND-ONLY: `superseded_at IS NULL` is the
// figure in force, and a superseded row keeps its amount so a correction stays visible.
const REVENUE_COLS =
  "id, location_id, month, amount_cents, note, entered_by, entered_at, superseded_at, superseded_by";

// An adopted tag's serial as the hardware broadcasts it and as `KnownTags.locationIdFor`
// already spells it: uppercase hex, colon-separated. Normalised on the way in so any
// casing or separator style the director pastes lands in one shape and the database CHECK
// never fires on a human.
const TAG_SERIAL_RE = /^[0-9A-F]{2}(:[0-9A-F]{2})+$/;

/**
 * An adopted tag's serial, as a HUMAN types it, turned into the one shape stored.
 *
 * The director reads `04:A1:A8:52:AE:5C:80` off NFC Tools, or `04-a1-a8-52-ae-5c-80` off
 * another reader, or pastes `04 A1 A8 52 AE 5C 80`. All three are the same tag. Normalising
 * means the database CHECK never fires on somebody who typed the truth in a different
 * style, and the unique index actually catches a duplicate instead of storing two spellings
 * of one serial.
 *
 * A SERIAL IS NOT A CREDENTIAL (decision-15, decision-44). It is broadcast in the clear and
 * is trivially clonable. It is stored so an admin can ADOPT a tag someone else mounted; it
 * is never authenticated on, and it never arrives from a phone — it only ever travels
 * server -> phone, inside GET /roster.
 *
 * NULL is a real, ordinary answer: almost every zone carries a tag WE wrote, which holds
 * the zone's id in its URL and has no serial on file at all.
 */
function normaliseSerial(value) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return null;
  const s = v.str(value, "tag_serial", { max: 64 });
  const hex = s.replace(/[\s:-]/g, "").toUpperCase();
  // Even-length hex only, and at least four bytes: a NFC serial is 4, 7 or 10 bytes.
  if (!/^[0-9A-F]+$/.test(hex) || hex.length % 2 !== 0 || hex.length < 8) fail(400, "invalid_field", "tag_serial");
  const serial = (hex.match(/../g) ?? []).join(":");
  // The database CHECK is the backstop; this asserts the normaliser and the column agree.
  if (!TAG_SERIAL_RE.test(serial)) fail(400, "invalid_field", "tag_serial");
  return serial;
}

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
  // decision-51. How many times one source address may call POST /auth/sms/request in a
  // rolling 5 minutes (window fixed in lib/auth.js, not here). WRITE-TIME rejects an
  // out-of-range value outright — the admin is told, never silently clamped — while
  // lib/auth.js's checkSmsRequestRate falls back to the default at READ time if the row is
  // ever missing or garbled. Bounds imported, not retyped, so the two copies cannot drift.
  [SMS_OTP_REQUESTS_KEY]: (value, field) => {
    const n = typeof value === "string" ? Number(value.trim()) : value;
    if (!Number.isSafeInteger(n) || n < SMS_OTP_REQUESTS_MIN || n > SMS_OTP_REQUESTS_MAX) fail(400, "invalid_field", field);
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
  "id, worker_id, location_id, start_zone_id, end_zone_id, " +
  "start_time, end_time, auto_closed, corrected_at, client_uuid, created_at";

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

// Short enough that a small business will actually use it, long enough to be worth the
// scrypt cost that already guards it. The real defence here is not length: it is the
// per-IP rate limit plus ~60 ms per attempt, both of which already exist on /admin/login.
const PASSWORD_MIN = 5;

/**
 * POST /admin/password -> change the signed-in admin's own password.
 *
 * The CURRENT password is required even though the caller already holds a valid session.
 * That is the whole point: a session cookie is something a borrowed, unlocked laptop also
 * has, and without this check walking past an open browser is enough to lock the owner out
 * of their own company's data.
 *
 * Every OTHER session for this admin is destroyed on success, and the caller keeps a fresh
 * one. If the reason for the change is "someone else knows it", a password change that
 * leaves the other party logged in has achieved nothing.
 */
async function changePassword({ body, session, ip }) {
  checkLoginRate(ip); // same bucket as login: this endpoint verifies a password too

  const current = typeof body.current_password === "string" ? body.current_password : "";
  const next = typeof body.new_password === "string" ? body.new_password : "";

  if (next.length < PASSWORD_MIN || next.length > PASSWORD_MAX) {
    fail(422, "password_too_short", { min: PASSWORD_MIN });
  }
  if (next === current) fail(422, "password_unchanged");

  const admin = await one("SELECT id, password_hash FROM admins WHERE id = $1", [session.adminId]);
  // Compare against a decoy when the row has vanished, so a deleted admin costs the same
  // time as a wrong password rather than answering instantly.
  const ok = await verifyPassword(current, admin ? admin.password_hash : await decoy());
  if (!ok || !admin) {
    recordLoginFailure(ip);
    fail(401, "invalid_credentials");
  }
  clearLoginFailures(ip);

  const hash = await hashPassword(next);
  await query("UPDATE admins SET password_hash = $1 WHERE id = $2", [hash, admin.id]);

  // Revoke everything, then hand this caller a new session so they are not logged out by
  // their own successful change.
  await query("DELETE FROM sessions WHERE admin_id = $1", [admin.id]);
  const { token, expiresAt } = await createSession(admin.id);

  return {
    status: 200,
    body: { ok: true },
    headers: { "set-cookie": sessionCookie(token, expiresAt) },
  };
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
  const inRangeFor = (f, t) =>
    `($${f}::timestamptz IS NULL OR s.start_time >= $${f}) AND ($${t}::timestamptz IS NULL OR s.start_time < $${t})`;
  const inRange = inRangeFor(1, 2);

  // /shifts/ WINDOWS by period (TASK-235): the same optional `?worker=` / `?location=` /
  // `?state=` the shift log already applies IN THE BROWSER are now accepted here too, so a
  // filtered screen is bounded by Postgres before the row ever crosses the wire, not after.
  // Omitted (the dashboard's and payroll's own calls to this same route never send them)
  // means "any", so nothing changes for a caller that does not ask.
  const shiftWorkerId = v.optionalId(query.get("worker"), "worker");
  const shiftLocationId = v.optionalUuid(query.get("location"), "location");
  const rawState = query.get("state");
  const shiftStateFilter = rawState === null ? null : v.oneOf(rawState, "state", ["open", "unresolved", "manual"]);
  // Mirrors web/lib/shifts.ts `shiftState` / `isManualEntry` exactly — one rule, stated in
  // both places, or the two disagree about which rows a filter keeps.
  const filterPredicate = (w, l, st) =>
    `($${w}::bigint IS NULL OR s.worker_id = $${w}) AND ($${l}::uuid IS NULL OR s.location_id = $${l}) AND ` +
    `($${st}::text IS NULL OR ` +
    `($${st} = 'open' AND s.end_time IS NULL) OR ` +
    `($${st} = 'unresolved' AND s.end_time IS NOT NULL AND s.auto_closed AND s.corrected_at IS NULL) OR ` +
    `($${st} = 'manual' AND s.client_uuid IS NULL))`;

  const [
    workers,
    operators,
    locations,
    zones,
    reportedTags,
    shifts,
    shiftMatchingInRange,
    shiftMatchingTotal,
    hours,
    clients,
    contacts,
    inventory,
    portalGrants,
    bounds,
    materialRequests,
    settings,
  ] = await Promise.all([
    // The two SMS columns are decision-48 and are ADDITIVE: every field the panel read
    // before this join existed is still here, in the same place, under the same name.
    //
    // `phone_e164` is the LOGIN number (phone_identities, decision-45) and is a DIFFERENT
    // fact from `workers.phone`, which is free text the director typed and which is never
    // normalised. Both are returned, and they are allowed to disagree — decision-45 §4
    // forbids silently reformatting the free-text column, so the panel shows both rather
    // than pretending one is the other.
    //
    // `sms_last_*` is the LAST ATTEMPT, from the append-only log (011). It is what makes a
    // stored "preferred channel" column unnecessary (decision-48 §2.2): this records what
    // HAPPENED, per attempt, instead of what somebody once intended.
    all(
      `SELECT ${WORKER_COLS.split(", ").map((c) => `w.${c}`).join(", ")},
              pi.phone_e164,
              s.status     AS sms_last_status,
              s.reason     AS sms_last_reason,
              s.created_at AS sms_last_at,
              COALESCE(t.n, 0)::int AS sms_count
         FROM workers w
         LEFT JOIN phone_identities pi ON pi.worker_id = w.id
         LEFT JOIN LATERAL (
           SELECT status, reason, created_at FROM sms_deliveries
            WHERE worker_id = w.id ORDER BY created_at DESC LIMIT 1
         ) s ON true
         LEFT JOIN LATERAL (
           SELECT count(*) AS n FROM sms_deliveries WHERE worker_id = w.id
         ) t ON true
        ORDER BY w.active DESC, w.name`,
    ),
    // decision-45. `enrolment_code_hash` never selected, mirroring WORKER_COLS's existing
    // omission exactly. No `to_regclass` guard: matches the existing (unguarded) `zones`
    // query below — adding one here and not there would be a new inconsistency, not a fix.
    all(
      `SELECT o.id, o.name, o.active, o.created_at, o.enrolment_code_expires_at, o.enrolment_code_redeemed_at,
              pi.phone_e164, pi.worker_id AS linked_worker_id, w.name AS linked_worker_name
         FROM operators o
         LEFT JOIN phone_identities pi ON pi.operator_id = o.id
         LEFT JOIN workers w ON w.id = pi.worker_id
        ORDER BY o.active DESC, o.name`,
    ),
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
    // Zones, with `last_tap_at` DERIVED and never stored (decision-43): "when was this tag
    // last tapped" is answerable from shifts, and a stored copy would drift the first time
    // a shift was corrected. NOT bounded by from/to — "the Tiefgarage tag has not been
    // tapped since 14 May" is precisely the answer a period filter would hide.
    // Inactive zones ride along like inactive buildings do: history has to keep naming them.
    all(
      `SELECT ${ZONE_COLS.split(", ").map((c) => `z.${c}`).join(", ")},
              (SELECT max(s.start_time) FROM shifts s WHERE s.start_zone_id = z.id) AS last_tap_at,
              vo.name AS verified_by_operator_name
         FROM zones z
         JOIN locations l ON l.id = z.location_id
         LEFT JOIN operators vo ON vo.id = z.verified_by_operator_id
        ORDER BY l.name, z.active DESC, z.name`,
    ),
    // Tags an operator has WRITTEN AND REPORTED but nobody has resolved yet (this
    // iteration; server/db/migrations/008_reported_tags.sql). UNRESOLVED ONLY — the same
    // "live rows only" posture GET /admin/revenue and portal_grants already take: a
    // resolved report is history the database keeps, not a queue item the panel still has
    // to act on. This is the ADMIN'S OWN worklist: "a tag exists, decide what it is."
    all(
      `SELECT rt.id, rt.reported_at, rt.reported_by_operator_id, o.name AS reported_by_operator_name
         FROM reported_tags rt
         LEFT JOIN operators o ON o.id = rt.reported_by_operator_id
        WHERE rt.resolved_at IS NULL
        ORDER BY rt.reported_at`,
    ),
    all(
      `SELECT s.id, s.worker_id, w.name AS worker_name,
              s.location_id, l.slug AS location_slug, l.name AS location_name,
              s.start_zone_id, s.end_zone_id, sz.name AS start_zone_name, ez.name AS end_zone_name,
              s.start_time, s.end_time, s.auto_closed, s.corrected_at,
              s.client_uuid, s.created_at
       FROM shifts s
       JOIN workers w ON w.id = s.worker_id
       JOIN locations l ON l.id = s.location_id
       LEFT JOIN zones sz ON sz.id = s.start_zone_id
       LEFT JOIN zones ez ON ez.id = s.end_zone_id
       WHERE ${inRange} AND ${filterPredicate(4, 5, 6)}
       ORDER BY s.start_time DESC
       LIMIT $3`,
      [from, to, limit, shiftWorkerId, shiftLocationId, shiftStateFilter],
    ),
    // Same worker/location/state predicate as the row query above, but counted rather than
    // fetched, so a filtered screen can say what it is showing without paying for rows it
    // will discard. Two counts, not one: `matchingInRange` is the true row count for the
    // window the row query above just applied its LIMIT to — it can legitimately exceed
    // `shifts.length` when the LIMIT bit, and `shifts.length >= limit` is still exactly the
    // truncation signal the shift log has always used. `matchingTotal` drops the date bound
    // entirely, so `matchingTotal - matchingInRange` is the count of rows the SAME filter
    // keeps in every OTHER period — the number `/shifts/` needs to tell "nothing here" apart
    // from "nothing anywhere".
    one(`SELECT count(*)::int AS n FROM shifts s WHERE ${inRangeFor(1, 2)} AND ${filterPredicate(3, 4, 5)}`, [
      from,
      to,
      shiftWorkerId,
      shiftLocationId,
      shiftStateFilter,
    ]),
    one(`SELECT count(*)::int AS n FROM shifts s WHERE ${filterPredicate(1, 2, 3)}`, [
      shiftWorkerId,
      shiftLocationId,
      shiftStateFilter,
    ]),
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
      operators,
      locations,
      zones,
      reported_tags: reportedTags,
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
      // The SAME worker/location/state filter the row query above just applied, counted
      // rather than fetched: how many rows that filter keeps OUTSIDE the requested
      // `[from, to)` window. `/shifts/` reports this next to the period so "no rows" and
      // "no rows anywhere" never render the same way (TASK-235).
      shift_outside_count: shiftMatchingTotal.n - shiftMatchingInRange.n,
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
  // decision-41. ONE variable feeds BOTH branches below, which is the point: a worker
  // created WITH a rate can be edited back to empty from /workers/, so the UPDATE branch
  // needs the same gate as the INSERT. `v.cents` defaulted an absent value to 0 and
  // silently made somebody cost EUR 0,00/h.
  const rate = v.requiredRate(body.hourly_rate_cents);
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

  const minted = await mintEnrolmentCode(worker.id, session.adminId);
  return {
    status: 201,
    body: {
      worker: { id: worker.id, name: worker.name },
      code: minted.display,
      expires_at: minted.expiresAt.toISOString(),
    },
  };
}

/**
 * Mint one code onto one worker row. EXTRACTED, NOT REWRITTEN (decision-48 §5.1): the SMS
 * route and the „Zugangscode erzeugen" button call THIS function, so the two cannot drift
 * apart — a bug fixed in one is fixed in both, and there is no version of the fallback that
 * is a slightly different credential from the one it falls back from.
 *
 * The response bytes of POST /admin/workers/:id/enrolment-code are unchanged by the
 * extraction: same 201, same three fields, same display form, same 5-day CODE_TTL_MS.
 *
 * workers.enrolment_code_hash is UNIQUE so a code can never name two workers. A collision
 * is ~1 in 2^40 per issue; retrying is two lines and removes the case where the director's
 * button answers 500 for a reason nobody could ever reproduce.
 */
async function mintEnrolmentCode(workerId, adminId) {
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
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
        [workerId, hashToken(code), expiresAt, adminId],
      );
      return { display, expiresAt };
    } catch (err) {
      if (err?.code !== "23505") throw err;
    }
  }
  fail(503, "code_unavailable");
}

// ---- SMS as a SECOND DELIVERY CHANNEL for the SAME code (decision-48) --------------
//
// THE OWNER, VERBATIM: "in admin there must be an option to choose how to onboard a worker,
// so if sms didnt work, there is always a fallback."
//
// ONBOARDING IS AN ACTION, NOT A SETTING. There is no `workers.onboarding_method` column and
// there never will be (decision-48 §2): two buttons on one row, both live for every active
// worker, both usable any number of times in any order, for ever. „Zugangscode erzeugen" is
// never disabled, hidden or made conditional by anything here.
//
// A SEPARATE ROUTE, NOT A `{deliver:"sms"}` FLAG on the existing one. An option on an
// existing route would put the fallback BEHIND A PARAMETER; a new route cannot. It also
// means POST /admin/workers/:id/enrolment-code keeps its current bytes, which is what
// ops/check-fallback-reachable.mjs asserts.

/**
 * POST /admin/workers/:id/enrolment-code/sms -> the SAME code, delivered by SMS.
 *
 *   200 {worker, code, expires_at, delivery:{status:"sent",   provider_sid, phone_e164}}
 *   200 {worker, code, expires_at, delivery:{status:"failed", reason, provider_code, phone_e164}}
 *   409 {error:"no_phone_identity"}   no login number on file  -> PUT .../phone first
 *   503 {error:"sms_not_configured"}  NOTHING minted, NOTHING written, NO budget spent
 *   429 {error:"too_many_attempts"}   over the rolling spend cap; nothing minted
 *   404 {error:"unknown_worker"}      unknown or inactive, exactly as the existing route
 *
 * A FAILED SEND IS A 200. That is not sloppiness, it is the whole design: the code was
 * minted, it is in the body, it is on the admin's screen and it works. A 4xx/5xx would let
 * the panel's error path swallow the body and destroy the fallback.
 *
 * THE ORDER BELOW IS THE GUARANTEE, and it is why "there is always a fallback" is
 * structural here rather than asserted:
 *
 *   1  smsConfigured()          false -> 503. Nothing has happened yet.
 *   2  resolve phone_identities none  -> 409. Nothing has happened yet.
 *   3  checkGlobalSmsSpend()    over  -> 429. Nothing has happened yet.
 *   4  mintEnrolmentCode()      the SAME helper the existing button calls
 *   5  BUILD THE 200 BODY       <- the fallback exists from this line onward
 *   6  await sendSms()          never throws; returns {status, reason?, provider_*?}
 *   7  INSERT sms_deliveries    one row, always, whatever step 6 said
 *   8  return body + delivery   the code is in it on EVERY path through 6 and 7
 *
 * Steps 1-3 all precede the mint, so a misconfigured or rate-limited box can never spend a
 * worker's code, and never leaves a row behind claiming a delivery that did not happen.
 */
async function sendEnrolmentCodeBySms({ params, session }) {
  const workerId = v.id(params.id, "id");

  // 1. THE FLAG, FIRST AND BEFORE EVERYTHING. 503 and never 202: the route exists and is
  // correct, the DEPENDENCY is unavailable, and 503 is the one status that can never be
  // read as "accepted". Checked before the limiter so a box with no credentials cannot
  // burn the hour's budget on refusals.
  if (!smsConfigured()) fail(503, "sms_not_configured");

  const worker = await one(
    `SELECT w.id, w.name, pi.phone_e164
       FROM workers w
       LEFT JOIN phone_identities pi ON pi.worker_id = w.id
      WHERE w.id = $1 AND w.active`,
    [workerId],
  );
  if (!worker) fail(404, "unknown_worker");
  // 2. No canonical number, no message. NOT an error the admin cannot act on: the panel
  // offers „Nummer hinterlegen" (PUT .../phone) beside it, and the code button is right
  // there and unaffected.
  if (!worker.phone_e164) fail(409, "no_phone_identity");

  // 3. THE BILL. The caller is an authenticated admin so there is no search space to
  // protect — but there IS money, and a stuck panel retrying in a loop is the way it gets
  // spent. Over the ceiling -> 429 BEFORE the mint, so nothing is issued and nothing is
  // charged.
  checkGlobalSmsSpend();

  // 4 + 5. THE CODE EXISTS AND THE BODY IS BUILT BEFORE TWILIO IS EVER CONTACTED.
  const minted = await mintEnrolmentCode(worker.id, session.adminId);
  const body = {
    worker: { id: worker.id, name: worker.name },
    code: minted.display,
    expires_at: minted.expiresAt.toISOString(),
  };

  // 6. Never throws. A timeout, a DNS failure, a 401 from Twilio and an unsubscribed
  // handset all arrive here as {status:"failed", reason}.
  const result = await sendSms(
    worker.phone_e164,
    renderEnrolmentSms({ name: senderName(), display: minted.display, expiresAt: minted.expiresAt }),
  );

  // 7. One row, always. Append-only: nothing in this tree updates or deletes it.
  await query(
    `INSERT INTO sms_deliveries (kind, worker_id, phone_e164, status, reason, provider_sid, provider_code, requested_by)
     VALUES ('enrolment_code', $1, $2, $3, $4, $5, $6, $7)`,
    [
      worker.id,
      worker.phone_e164,
      result.status,
      result.reason ?? null,
      result.provider_sid ?? null,
      result.provider_code ?? null,
      session.adminId,
    ],
  );

  // 8. „übergeben", never „zugestellt" (decision-48 §5.5): Twilio answering 2xx means it
  // accepted the message, not that she read it. The panel's wording follows from this
  // field and there is no third value that could be mistaken for a delivery receipt.
  return {
    status: 200,
    body: {
      ...body,
      delivery: {
        status: result.status,
        phone_e164: worker.phone_e164,
        ...(result.status === "sent" ?
          { provider_sid: result.provider_sid }
        : { reason: result.reason, provider_code: result.provider_code ?? null }),
      },
    },
  };
}

/**
 * PUT /admin/workers/:id/phone {phone} -> 200 {worker:{id}, phone_e164}
 *
 * THE ONE-CLICK PROMOTION decision-45 NAMED AND DID NOT BUILD: "Promotion of existing rows
 * is a named, future, one-click admin action, not built here." Without it, SMS to a worker
 * is unreachable — `POST /admin/workers` writes free-text `workers.phone` and claims
 * nothing in the registry (check-phone-namespace.mjs §3 asserts exactly that ceiling).
 *
 * IT DOES NOT TOUCH `workers.phone`. decision-45 §4 forbids reformatting the free-text
 * column, so the two are allowed to disagree from this moment on and the panel shows both.
 * This is a deliberate claim the admin makes, not a silent normalisation of what was typed.
 *
 *   409 phone_claimed names NOBODY — anti-enumeration, the same posture createOperator
 *   already takes and decision-22's 403 takes for a claimed email.
 */
async function putWorkerPhone({ params, body }) {
  const workerId = v.id(params.id, "id");
  const phone = v.identityPhone(body.phone, "phone");

  const worker = await one("SELECT id FROM workers WHERE id = $1 AND active", [workerId]);
  if (!worker) fail(404, "unknown_worker");

  // REFUSE BEFORE RELEASING. The worker's own previous claim has to go before the new one
  // can be inserted (phone_identities.worker_id is UNIQUE — one person, one login number),
  // and releasing first would mean a refused claim left the worker with NO number at all.
  // So the refusal is decided first, against the row as it stands.
  const held = await one("SELECT worker_id FROM phone_identities WHERE phone_e164 = $1", [phone]);
  if (held && held.worker_id !== null && Number(held.worker_id) !== workerId) fail(409, "phone_claimed");

  // Release the worker's PREVIOUS number, if any. Without this, changing a number would
  // leave the old one claimed for ever and an OTP sent to it would still resolve to this
  // worker.
  await releaseWorkerPhone(workerId, phone);

  try {
    // The WHERE on the conflict branch is what makes this safe. `worker_id IS NULL` lets a
    // row an OPERATOR already holds ADOPT its worker half — one human, one telephone, two
    // roles, which is precisely what 007's table is for — while making it impossible to
    // STEAL a number from another worker: that row has a non-NULL worker_id, the UPDATE
    // matches nothing and 0 rows come back. `OR worker_id = $2` keeps re-saving the same
    // number idempotent instead of answering 409 for a no-op.
    const claimed = await one(
      `INSERT INTO phone_identities (phone_e164, worker_id) VALUES ($1, $2)
         ON CONFLICT (phone_e164) DO UPDATE SET worker_id = $2
            WHERE phone_identities.worker_id IS NULL OR phone_identities.worker_id = $2
       RETURNING phone_e164`,
      [phone, workerId],
    );
    if (!claimed) fail(409, "phone_claimed"); // lost a race between the SELECT and here

    return { status: 200, body: { worker: { id: workerId }, phone_e164: phone } };
  } catch (err) {
    // The database, not this function, is the thing that makes the collision impossible
    // (decision-45 §2). Same opaque answer, naming nobody.
    if (err?.code === "23505") fail(409, "phone_claimed");
    throw err;
  }
}

/**
 * DELETE /admin/workers/:id/phone -> 200. Releases the claim, and runs decision-45's named
 * cleanup: a row owned by nobody is not a reservation, it is litter, and leaving it would
 * make the number permanently unclaimable by anyone.
 *
 * Idempotent and 200 whether or not there was a claim — same posture as revokeEnrolmentCode.
 */
async function deleteWorkerPhone({ params }) {
  const workerId = v.id(params.id, "id");
  await releaseWorkerPhone(workerId, null);
  return { status: 200, body: { worker: { id: workerId }, phone_e164: null } };
}

/**
 * Give up this worker's registry claim, optionally sparing one number they are about to
 * re-claim. TWO STATEMENTS AND NOT ONE `SET worker_id = NULL`, and the reason is a
 * constraint, not a preference:
 *
 *   phone_identities_claims CHECK (worker_id IS NOT NULL OR operator_id IS NOT NULL)   -- 007
 *
 * A row that claims NOBODY is UNREPRESENTABLE, so nulling the worker on a worker-only row
 * raises 23514 and the director's „Nummer entfernen" button answers 500. decision-45's
 * "named cleanup of a both-NULL row" is therefore not a sweep after the fact — the
 * database refuses to create the litter in the first place, and the release has to be a
 * DELETE for a worker-only row and a NULL only where an operator still holds the other half
 * (one human, one telephone, two roles).
 *
 * Measured, not reasoned: this function exists because check-sms-flag.mjs §6 caught the
 * one-statement version answering `500 ... violates check constraint
 * "phone_identities_claims"`.
 */
async function releaseWorkerPhone(workerId, keepPhone) {
  await query(
    `DELETE FROM phone_identities
      WHERE worker_id = $1 AND operator_id IS NULL AND ($2::text IS NULL OR phone_e164 <> $2)`,
    [workerId, keepPhone],
  );
  await query(
    `UPDATE phone_identities SET worker_id = NULL
      WHERE worker_id = $1 AND operator_id IS NOT NULL AND ($2::text IS NULL OR phone_e164 <> $2)`,
    [workerId, keepPhone],
  );
}

/**
 * GET /admin/sms-status -> {configured, missing[], sender_kind}
 *
 * NAMES ONLY, never a value, never a prefix, never a length. The panel fetches this beside
 * the worker list so the „SMS senden" button's state is a FACT FROM THE SERVER rather than
 * a guess baked into a static bundle (the admin is a static export, decision-16).
 *
 * The button is RENDERED EITHER WAY. When this says `configured: false` it is disabled with
 * the reason beside it in words — never hidden, because hiding it would delete something
 * true: this system has an SMS path and it is switched off.
 */
async function smsStatusRoute() {
  return { status: 200, body: smsStatus() };
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

// ---- operators (decision-45) ------------------------------------------------------
//
// POST /operator/workers {name, phone} — "create a worker from the phone by typing name
// + phone" — is NOT BUILT HERE, or anywhere else in this tree. OPERATOR-MODEL.md §8: the
// owner's own instruction (no rate in the input) is in direct, unresolved conflict with
// decision-41 (PROPOSED, unconditional `hourly_rate_cents > 0`, no exemption for any
// state). Building it against TODAY's schema (rate defaults to 0) would manufacture the
// exact invisible-€0/h defect decision-41 exists to close, on purpose, on every call.
// TASK-212 AC#5 names this route BLOCKED until the owner rules on §8. Do not build it.

/**
 * POST /admin/operators {name, phone} -> 201 {operator}. CREATE ONLY — no id in the body,
 * no update branch. Nothing in OPERATOR-MODEL.md or its tasks asks for editing an
 * operator's name or re-pointing their phone; a phone that needs to change is a new
 * identity claim, not an edit of an old one.
 *
 * ONE writable-CTE statement, not two round trips: this codebase has NO transaction
 * helper anywhere (`grep -rn "BEGIN\|pool.connect" server/routes/*.js` -> nothing — every
 * existing "one transaction" claim here already IS a single SQL statement), and a
 * two-statement version would leave an orphan `operators` row behind on a `phone_claimed`
 * 409. The CTE can't: either both inserts land, or neither does.
 *
 * 409 phone_claimed names nothing about WHO holds the number — anti-enumeration,
 * decision-45 §7, the same posture decision-22's 403 already applies to a claimed email.
 * `phone_identities_pkey` is the only 23505 source reachable here: `operators.id` is a
 * BIGSERIAL (never collides) and `operators` carries no other UNIQUE column.
 */
async function createOperator({ body, session }) {
  const name = v.str(body.name, "name", { max: 120 });
  const phone = v.identityPhone(body.phone, "phone");

  try {
    const row = await one(
      `WITH new_operator AS (
         INSERT INTO operators (name, created_by) VALUES ($1, $2)
         RETURNING id, name, active, created_at
       )
       INSERT INTO phone_identities (phone_e164, operator_id)
         SELECT $3, id FROM new_operator
       RETURNING (SELECT id FROM new_operator) AS id, (SELECT name FROM new_operator) AS name,
                 (SELECT active FROM new_operator) AS active, (SELECT created_at FROM new_operator) AS created_at`,
      [name, session.adminId, phone],
    );
    return { status: 201, body: { operator: { ...row, phone_e164: phone } } };
  } catch (err) {
    if (err?.code === "23505") fail(409, "phone_claimed");
    throw err;
  }
}

/**
 * DELETE /admin/operators/:id -> soft delete (`active = false`), never a hard delete.
 * Mirrors deleteWorker exactly, including revoking sessions — `requireOperatorSession`
 * re-checks `active` on every request regardless, but a live session row for someone let
 * go is not a state worth keeping. `phone_identities.operator_id` survives as NULL
 * (ON DELETE SET NULL, never CASCADE): the phone claim decays, it is not silently freed
 * for reuse while the deactivated row still exists — see 007's own comment on that table.
 */
async function deleteOperator({ params }) {
  const operatorId = v.id(params.id, "id");
  const row = await one("UPDATE operators SET active = false WHERE id = $1 RETURNING id, active", [operatorId]);
  if (!row) fail(404, "unknown_operator");
  await destroyOperatorSessions(operatorId);
  return { status: 200, body: { operator: row } };
}

/**
 * POST /admin/operators/:id/enrolment-code -> byte-identical shape to
 * POST /admin/workers/:id/enrolment-code, against `operators`. Same CODE_TTL_MS, same
 * newEnrolmentCode from lib/enrolment.js — reused, not reimplemented (decision-45 §6).
 * ACTIVE operators only, same reasoning as the worker route: a live code for someone let
 * go is not a state worth being able to reach.
 */
async function issueOperatorEnrolmentCode({ params, session }) {
  const operator = await one("SELECT id, name FROM operators WHERE id = $1 AND active", [v.id(params.id, "id")]);
  if (!operator) fail(404, "unknown_operator");

  const minted = await mintOperatorEnrolmentCode(operator.id, session.adminId);
  return {
    status: 201,
    body: {
      operator: { id: operator.id, name: operator.name },
      code: minted.display,
      expires_at: minted.expiresAt.toISOString(),
    },
  };
}

/**
 * Mint one code onto one operator row. EXTRACTED, NOT INLINE, for the same reason
 * mintEnrolmentCode is extracted for workers (decision-48 §5.1, applied here for the
 * operator SMS channel below): the „Zugangscode erzeugen“ button and the SMS route call
 * THIS function, so the two can never mint a different credential from one another.
 */
async function mintOperatorEnrolmentCode(operatorId, adminId) {
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  // enrolment_code_hash is UNIQUE, same collision handling as the worker route: retry
  // rather than let a ~1-in-2^40 event surface as an unreproducible 500.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { code, display } = newEnrolmentCode();
    try {
      await query(
        `UPDATE operators
            SET enrolment_code_hash = $2,
                enrolment_code_expires_at = $3,
                enrolment_code_issued_at = now(),
                enrolment_code_issued_by = $4,
                enrolment_code_redeemed_at = NULL
          WHERE id = $1`,
        [operatorId, hashToken(code), expiresAt, adminId],
      );
      return { display, expiresAt };
    } catch (err) {
      if (err?.code !== "23505") throw err;
    }
  }
  fail(503, "code_unavailable");
}

/**
 * POST /admin/operators/:id/enrolment-code/sms -> the SAME code, delivered by SMS.
 * Byte-identical contract to POST /admin/workers/:id/enrolment-code/sms (decision-48),
 * against `operators` instead of `workers`, `phone_identities.operator_id` instead of
 * `.worker_id`, and `sms_deliveries.operator_id` instead of `.worker_id`. Same eight-step
 * order, same guarantee: steps 1-3 all precede the mint, so a misconfigured or
 * rate-limited box can never spend an operator's code.
 *
 *   200 {operator, code, expires_at, delivery:{status:"sent",   provider_sid, phone_e164}}
 *   200 {operator, code, expires_at, delivery:{status:"failed", reason, provider_code, phone_e164}}
 *   409 {error:"no_phone_identity"}   no number on file (createOperator always sets one,
 *                                     so this is the same defensive check as the worker
 *                                     route, not a reachable state today)
 *   503 {error:"sms_not_configured"}  NOTHING minted, NOTHING written, NO budget spent
 *   429 {error:"too_many_attempts"}   over the rolling spend cap; nothing minted
 *   404 {error:"unknown_operator"}
 */
async function sendOperatorEnrolmentCodeBySms({ params, session }) {
  const operatorId = v.id(params.id, "id");

  if (!smsConfigured()) fail(503, "sms_not_configured");

  const operator = await one(
    `SELECT o.id, o.name, pi.phone_e164
       FROM operators o
       LEFT JOIN phone_identities pi ON pi.operator_id = o.id
      WHERE o.id = $1 AND o.active`,
    [operatorId],
  );
  if (!operator) fail(404, "unknown_operator");
  if (!operator.phone_e164) fail(409, "no_phone_identity");

  checkGlobalSmsSpend();

  const minted = await mintOperatorEnrolmentCode(operator.id, session.adminId);
  const body = {
    operator: { id: operator.id, name: operator.name },
    code: minted.display,
    expires_at: minted.expiresAt.toISOString(),
  };

  const result = await sendSms(
    operator.phone_e164,
    renderEnrolmentSms({ name: senderName(), display: minted.display, expiresAt: minted.expiresAt }),
  );

  await query(
    `INSERT INTO sms_deliveries (kind, operator_id, phone_e164, status, reason, provider_sid, provider_code, requested_by)
     VALUES ('enrolment_code', $1, $2, $3, $4, $5, $6, $7)`,
    [
      operator.id,
      operator.phone_e164,
      result.status,
      result.reason ?? null,
      result.provider_sid ?? null,
      result.provider_code ?? null,
      session.adminId,
    ],
  );

  return {
    status: 200,
    body: {
      ...body,
      delivery: {
        status: result.status,
        phone_e164: operator.phone_e164,
        ...(result.status === "sent" ?
          { provider_sid: result.provider_sid }
        : { reason: result.reason, provider_code: result.provider_code ?? null }),
      },
    },
  };
}

/**
 * DELETE /admin/operators/:id/enrolment-code -> revoke. Byte-identical to the worker
 * route: idempotent, 200 whether or not a code was live, issued_at/issued_by survive.
 */
async function revokeOperatorEnrolmentCode({ params }) {
  const row = await one(
    `UPDATE operators
        SET enrolment_code_hash = NULL, enrolment_code_expires_at = NULL
      WHERE id = $1
      RETURNING ${OPERATOR_COLS}`,
    [v.id(params.id, "id")],
  );
  if (!row) fail(404, "unknown_operator");
  return { status: 200, body: { operator: row } };
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
  // And its zones (decision-43). `activePlace` requires BOTH the zone and its building to
  // be active, so an active zone under an inactive building is already unresolvable — it
  // would just sit in the panel looking live while its tag answered 422 at the wall. This
  // makes the row say what is true. Soft, like every other delete here: history keeps
  // naming the zone a shift was tapped at.
  await query("UPDATE zones SET active = false WHERE location_id = $1 AND active", [locationId]);
  return { status: 200, body: { location: row } };
}

// ---- zones (decision-43) ----------------------------------------------------------
//
// A ZONE IS A PLACE INSIDE A BUILDING THAT GETS CLEANED AND CAN CARRY A TAG.
// A ZONE IS NOT A COSTING UNIT. A shift is billed to the BUILDING, and the contract and
// the revenue stay on the BUILDING (decision-42). There is no zone-level contract, target,
// revenue or margin, and there must never be one: a shift is building-level, so no
// duration is attributable to a zone, and splitting a building's labour by area share
// would assert that time is proportional to floor area — false in the obvious direction,
// since a Tiefgarage is fast per m2 and an office floor is slow. Same failure decision-6
// already refused for materials.

/**
 * POST /admin/zones -> create (no id) or update (id). Same upsert idiom as everything else
 * here: one route, one form, one submit handler.
 *
 * 409 duplicate_zone_name  another LIVE zone of this building already has that name. Two
 *                          live "Stiege 1"s is a director about to tag the wrong door.
 * 409 serial_taken         another zone already claims that adopted serial, and the answer
 *                          NAMES that zone — otherwise the director is told "no" with
 *                          nowhere to go.
 *
 * The partial unique indexes are the backstop; these are the gates. Both exist because a
 * 23505 surfacing as a 500 with an index name in it is not something a director can act on.
 */
async function upsertZone({ body }) {
  const locationId = v.uuid(body.location_id, "location_id");
  if (!(await one("SELECT id FROM locations WHERE id = $1", [locationId]))) fail(422, "unknown_location");

  const name = v.str(body.name, "name", { max: 120 });
  const note = v.optionalStr(body.note, "note", { max: 500 });
  const areaSqm = v.optionalArea(body.area_sqm, "area_sqm");
  const tagSerial = normaliseSerial(body.tag_serial);
  const tagDeployedAt =
    body.tag_deployed_at === undefined || body.tag_deployed_at === null || body.tag_deployed_at === ""
      ? null
      : v.timestamp(body.tag_deployed_at, "tag_deployed_at");
  const active = v.bool(body.active, "active", true);
  const targetId = body.id === undefined || body.id === null ? null : v.uuid(body.id, "id");

  // Checked here rather than left to 23505 so the refusal can NAME the other zone. The
  // index still backs it up, because two admins could interleave past this.
  if (tagSerial !== null) {
    const claimed = await one("SELECT id, name, location_id FROM zones WHERE tag_serial = $1", [tagSerial]);
    if (claimed && claimed.id !== targetId) {
      return {
        status: 409,
        body: { error: "serial_taken", zone: { id: claimed.id, name: claimed.name, location_id: claimed.location_id } },
      };
    }
  }

  try {
    if (targetId === null) {
      const row = await one(
        `INSERT INTO zones (location_id, name, note, area_sqm, tag_serial, tag_deployed_at, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${ZONE_COLS}`,
        [locationId, name, note, areaSqm, tagSerial, tagDeployedAt, active],
      );
      return { status: 201, body: { zone: row } };
    }

    // location_id is NOT patchable. Moving a zone between buildings would strand every
    // shift that names it (the composite FK would raise 23503) and would silently re-point
    // a physical tag on a wall at a different address.
    const row = await one(
      `UPDATE zones SET name = $2, note = $3, area_sqm = $4, tag_serial = $5, tag_deployed_at = $6, active = $7
        WHERE id = $1 AND location_id = $8
        RETURNING ${ZONE_COLS}`,
      [targetId, name, note, areaSqm, tagSerial, tagDeployedAt, active, locationId],
    );
    if (!row) fail(404, "unknown_zone");
    return { status: 200, body: { zone: row } };
  } catch (err) {
    if (err?.code === "23505") {
      fail(409, err?.constraint === "zones_tag_serial_idx" ? "serial_taken" : "duplicate_zone_name");
    }
    throw err;
  }
}

/**
 * DELETE /admin/zones/:id -> SOFT deactivate. Never a delete.
 *
 * A shift that was tapped here has to keep naming the door it was tapped at, and the
 * composite FK would refuse the delete anyway. Deactivating also stops the zone's own tag
 * resolving (`activePlace` requires an active zone), which is the actual thing the director
 * means when a tag comes off a wall.
 */
async function deleteZone({ params }) {
  const zoneId = v.uuid(params.id, "id");
  const row = await one(`UPDATE zones SET active = false WHERE id = $1 RETURNING ${ZONE_COLS}`, [zoneId]);
  if (!row) fail(404, "unknown_zone");
  return { status: 200, body: { zone: row } };
}

// ---- reported tags: turning an UNBOUND tag into something (this iteration) --------
//
// server/db/migrations/008_reported_tags.sql. An operator's phone minted a uuid, wrote it
// to a physical tag and told POST /operator/tags it exists. It landed with no zone and no
// building. These three routes are the only way that changes, and they are the only
// writers of `reported_tags.resolved_at` in this codebase.
//
// ALL THREE SHARE ONE RACE-SAFETY SHAPE: "stamp resolved_at THEN insert/link, in one
// statement", via a CTE — the same reason POST /admin/operators uses one (this codebase
// has no transaction helper; see that function's own comment). Two admins resolving the
// SAME reported tag at once must not both succeed: the UPDATE inside the CTE only matches
// a row where `resolved_at IS NULL`, so the second caller's CTE returns zero rows, the
// INSERT/link below it selects from zero rows, and `one()` sees `null` — answered as 409
// already_resolved, never as two locations or two aliases silently created for one tag.
//
// A resolve route is refused the same way whether the tag was NEVER reported (404) or was
// reported and ALREADY resolved (409) — told apart by one extra read, because the admin
// panel needs to render "this id isn't a tag we know of" differently from "someone already
// decided this".
async function resolvedOrUnknown(tagId) {
  const reported = await one("SELECT resolved_at FROM reported_tags WHERE id = $1", [tagId]);
  fail(reported ? 409 : 404, reported ? "already_resolved" : "unknown_reported_tag");
}

// *** POST /admin/tags/:id/resolve-building IS DELETED (decision-47). ***
//
// It turned a freshly field-written card into a NEW BUILDING whose primary key IS the
// card's id — a second direct-tap building surface, for ever, with no zone ever created.
// The owner's sentence retires exactly that: "there should be building as an entity where
// zones can be created."
//
// WHAT REPLACES IT, and it needed nothing built: POST /admin/locations is already TAG-FREE
// (the row's id is generated by the DATABASE and is never chosen by the caller — see
// `upsertLocation`). A building discovered on a field visit is created there, and the
// reported card then becomes that building's FIRST ZONE through `resolveTagToZone` below.
//
// NOT KEPT IMPORTABLE, deliberately. The one thing it produced is the thing being retired;
// the one building-level tap that must keep working (HOIV) needs NO route at all, because
// its row already exists and `activePlace` already answers it — deleting a CREATION route
// cannot touch a RESOLUTION path. And a retired handler that still compiles is one a later
// reader finds, assumes is supported, and re-wires; the id space is shared, so that
// re-wiring is invisible until a card is on a wall, and then it is permanent. If it ever
// comes back, it comes back through a decision record.
//
// Pinned by a check: POST /admin/tags/<id>/resolve-building answers 404, and its RED case
// is putting the route-table entry back.

/**
 * POST /admin/tags/:id/resolve-zone {location_id, name, note?, area_sqm?} -> a NEW zone
 * in an EXISTING building, id = :id.
 *
 * `tag_deployed_at` is stamped from the REPORT, not from this admin action: the physical
 * card was mounted (or at least written) when the operator's phone told the server it
 * exists, which is usually days before an admin gets to a desk to resolve it. "the tag has
 * been physically placed" is a fact about the field visit, not about the paperwork.
 *
 * location_id existence only, no `active` filter — the same posture POST /admin/zones
 * already takes (a zone can be created under a building that is not currently active;
 * whether it RESOLVES is `activePlace`'s call, made fresh on every tap).
 */
async function resolveTagToZone({ params, body }) {
  const tagId = v.uuid(params.id, "id");
  const locationId = v.uuid(body.location_id, "location_id");
  if (!(await one("SELECT id FROM locations WHERE id = $1", [locationId]))) fail(422, "unknown_location");
  const name = v.str(body.name, "name", { max: 120 });
  const note = v.optionalStr(body.note, "note", { max: 500 });
  const areaSqm = v.optionalArea(body.area_sqm, "area_sqm");

  let row;
  try {
    row = await one(
      `WITH stamp AS (
         UPDATE reported_tags SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL
         RETURNING id, reported_at
       )
       INSERT INTO zones (id, location_id, name, note, area_sqm, tag_deployed_at)
         SELECT id, $2, $3, $4, $5, reported_at FROM stamp
       RETURNING ${ZONE_COLS}`,
      [tagId, locationId, name, note, areaSqm],
    );
  } catch (err) {
    // Only two constraints can fire on this INSERT: a name clash within the building, or
    // (vanishingly unlikely) a UUIDv4 collision on the id itself — tag_serial is never set
    // here, so zones_tag_serial_idx cannot be the cause.
    if (err?.code === "23505") fail(409, err?.constraint === "zones_pkey" ? "id_in_use" : "duplicate_zone_name");
    throw err;
  }
  if (!row) await resolvedOrUnknown(tagId);
  return { status: 201, body: { zone: row } };
}

/**
 * POST /admin/tags/:id/resolve-existing-zone {zone_id} -> this physical tag now ALSO
 * resolves to an already-existing zone, via `tag_aliases`.
 *
 * THE ONE CASE THAT CANNOT REUSE "this row's own id becomes the new PK": the target zone
 * already has an id, and very possibly an already-printed tag of its own. Re-keying it to
 * match this new physical card would strand whatever else was ever written with its
 * original id. An alias is purely additive: the zone's own identity, and any OTHER tag
 * that already resolves to it, is untouched.
 *
 * The target must be ACTIVE. Aliasing to a deactivated zone would create a row that can
 * never resolve (`activePlace`'s alias branch requires `z.active`, same as the zone's own
 * id would) — refused here with a clear reason instead of accepted and silently useless.
 */
async function resolveTagToExistingZone({ params, body }) {
  const tagId = v.uuid(params.id, "id");
  const zoneId = v.uuid(body.zone_id, "zone_id");
  if (!(await one("SELECT id FROM zones WHERE id = $1 AND active", [zoneId]))) fail(422, "unknown_zone");

  const row = await one(
    `WITH stamp AS (
       UPDATE reported_tags SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL
       RETURNING id
     )
     INSERT INTO tag_aliases (id, zone_id)
       SELECT id, $2 FROM stamp
     RETURNING id, zone_id`,
    [tagId, zoneId],
  );
  if (!row) await resolvedOrUnknown(tagId);
  return { status: 200, body: { alias: row } };
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

  // MOVING A SHIFT TO ANOTHER BUILDING CLEARS BOTH ZONE COLUMNS (decision-43).
  //
  // Not optional: the composite FKs are (zone_id, location_id) -> zones (id, location_id),
  // so leaving a zone from the OLD building attached raises 23503 and the director's
  // correction dies as a 500 they cannot act on.
  //
  // Clearing is also the correct SEMANTICS, which is why it is not a workaround. The zone
  // columns are TAP FACTS — "this door was held to this phone". A human re-pointing a shift
  // at a different building is saying the tap record was wrong, and the honest replacement
  // for a wrong fact is no fact, not the nearest-looking zone in the new building.
  const movedBuilding = locationId !== current.location_id;

  const row = await one(
    `UPDATE shifts
     SET worker_id = $2, location_id = $3, start_time = $4, end_time = $5, corrected_at = $6,
         start_zone_id = CASE WHEN $7 THEN NULL ELSE start_zone_id END,
         end_zone_id   = CASE WHEN $7 THEN NULL ELSE end_zone_id   END
     WHERE id = $1
     RETURNING ${ADMIN_SHIFT_COLS}`,
    [shiftId, workerId, locationId, start, end, correctedAt, movedBuilding],
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

// ---- revenue: what the client actually PAID (decision-42) --------------------------
//
// TWO FACTS THAT HAD BEEN COLLAPSED INTO ONE:
//   CONTRACT   what was AGREED.  A rate, valid from a date until a date.   location_contracts
//   REVENUE    what was RECEIVED. A scalar, for one named Vienna month.    location_revenue
//
// The P&L used to derive revenue by DAILY ACCRUAL from the contract: careful arithmetic
// about a number nobody received. The director wants to type what the client actually paid.
//
// THE ABSENCE OF A ROW IS THE UNKNOWN, and 0 is a real, different answer meaning "they paid
// nothing this month" — a credit month, a dispute, a free trial. Nothing here ever writes a
// row on its own: auto-creating one from the contract is the rejected accrual wearing a
// different hat, and it fabricates a payment a human then reads as confirmed.
//
// APPEND-ONLY. Hand-typed money that changes invisibly is an opinion, not a fact.

/**
 * GET /admin/revenue?from&to -> the /pl/ month grid.
 *
 * `entries` are the figures IN FORCE plus, for each, the previous figure it replaced (so
 * the screen can print "geändert 11.09 · vorher 1.250,00" — "this was changed" without
 * "from what" sends the director to the database). `suggestions` are the CONTRACT value in
 * force for each building-month: a pre-fill for the form, visibly labelled, and stored only
 * when a human presses save.
 *
 * The grid is over WHOLE VIENNA MONTHS overlapping the period, because the entry ritual is
 * monthly and a per-building modal reopened twelve times is not a ritual anybody performs.
 */
async function listRevenue({ query: q }) {
  const { from, to } = v.requiredRange(q.get("from"), q.get("to"));

  // Every Vienna calendar month the period TOUCHES. `date_trunc` in Vienna, not in the
  // process's zone: a period starting at 2026-03-01T00:00+01:00 is 23:00 on 28 February in
  // UTC, and a server running in UTC would offer February as the first month of a March
  // period.
  const months = await all(
    `SELECT to_char(gs, 'YYYY-MM') AS month, gs::date AS month_start
       FROM generate_series(
              date_trunc('month', $1::timestamptz AT TIME ZONE 'Europe/Vienna'),
              date_trunc('month', ($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'Europe/Vienna'),
              interval '1 month') AS gs`,
    [from, to],
  );
  const monthStarts = months.map((m) => m.month_start);

  const [entries, suggestions] = await Promise.all([
    all(
      `SELECT r.location_id, to_char(r.month, 'YYYY-MM') AS month, r.amount_cents, r.note,
              r.entered_at, a.email AS entered_by_email,
              prev.amount_cents AS previous_cents, prev.superseded_at AS changed_at,
              prevby.email      AS changed_by_email
         FROM location_revenue r
         LEFT JOIN admins a ON a.id = r.entered_by
         LEFT JOIN LATERAL (
           SELECT p.amount_cents, p.superseded_at, p.superseded_by
             FROM location_revenue p
            WHERE p.location_id = r.location_id AND p.month = r.month AND p.superseded_at IS NOT NULL
            ORDER BY p.superseded_at DESC, p.id DESC
            LIMIT 1
         ) prev ON true
         LEFT JOIN admins prevby ON prevby.id = prev.superseded_by
        WHERE r.superseded_at IS NULL AND r.month = ANY ($1::date[])
        ORDER BY r.month, r.location_id`,
      [monthStarts],
    ),
    // The AGREED figure for each building-month, from the contract in force on the FIRST of
    // that month. A suggestion, never a stored value — and it is also what makes
    // "vereinbart vs erhalten" answerable, which is the argument for keeping the contract
    // alive at all (decision-28 is amended by decision-42, not superseded).
    all(
      `SELECT c.location_id, to_char(m.month_start, 'YYYY-MM') AS month,
              c.monthly_contract_cents AS contract_cents
         FROM unnest($1::date[]) AS m(month_start)
         JOIN location_contracts c
           ON c.valid_from <= m.month_start
          AND (c.valid_to IS NULL OR m.month_start < c.valid_to)
        ORDER BY m.month_start, c.location_id`,
      [monthStarts],
    ),
  ]);

  return {
    status: 200,
    body: {
      range: { from: from.toISOString(), to: to.toISOString() },
      timezone: "Europe/Vienna",
      months: months.map((m) => m.month),
      entries,
      // Named `suggestions` and not `defaults` on purpose. Nothing applies them.
      suggestions,
    },
  };
}

/**
 * POST /admin/locations/:id/revenue {month, amount_cents, note?} -> file, or CORRECT, a
 * month's payment.
 *
 * A CORRECTION IS AN INSERT, NEVER AN UPDATE IN PLACE. The previous row keeps its amount
 * and gains `superseded_at` + `superseded_by`, so /pl/ can print what the figure used to be
 * and who changed it. Same idiom the schema already runs twice
 * (`location_contracts_one_current_idx`, `portal_grants_one_live_idx`), so no new concept.
 *
 * `entered_by` comes from the SESSION and is never read from the body — decision-22's rule
 * applied to the admin side. An audit trail a caller can name themselves in is not one.
 *
 * ponytail: the stored row does not record whether the figure was ACCEPTED from the
 * contract suggestion or typed over it. CEILING: those two are indistinguishable
 * afterwards. Pressing save is the assertion either way, and the audit question is WHO and
 * WHEN, which is answered. UPGRADE PATH: `source TEXT CHECK (source IN ('typed','suggested'))`.
 */
async function putRevenue({ params, body, session }) {
  const locationId = v.uuid(params.id, "id");
  if (!(await one("SELECT id FROM locations WHERE id = $1", [locationId]))) fail(404, "unknown_location");

  const month = v.isoMonth(body.month, "month");
  // NOT `optionalCents`: a revenue entry with no amount is not an entry. 0 IS accepted and
  // means "they paid nothing this month", which is why this is `cents` and not a positive
  // check — unlike a wage, "free of charge" is a real thing a client month can be.
  if (body.amount_cents === undefined || body.amount_cents === null || body.amount_cents === "") {
    fail(422, "amount_required", "amount_cents");
  }
  const amountCents = v.cents(body.amount_cents, "amount_cents");
  const note = v.optionalStr(body.note, "note", { max: 500 });

  // Supersede first, then insert: the partial unique index admits exactly one live row per
  // (building, month), so the other order would collide with itself.
  const previous = await one(
    `UPDATE location_revenue SET superseded_at = now(), superseded_by = $3
      WHERE location_id = $1 AND month = $2 AND superseded_at IS NULL
      RETURNING id, amount_cents`,
    [locationId, month, session.adminId],
  );
  const entry = await one(
    `INSERT INTO location_revenue (location_id, month, amount_cents, note, entered_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${REVENUE_COLS}`,
    [locationId, month, amountCents, note, session.adminId],
  );
  return {
    status: previous ? 200 : 201,
    body: { entry, previous_cents: previous === null ? null : previous.amount_cents },
  };
}

// 8 buildings x 12 months = 96, the day-one grid this route exists for. A generous
// multiple of that, not a tight fit: a second client's portfolio is still one request.
const REVENUE_BULK_MAX = 500;

/**
 * POST /admin/revenue {entries: [{location_id, month, amount_cents, note?}, ...]} -> file
 * or correct MANY building-months in one request (TASK-236).
 *
 * WHY THIS EXISTS: `putRevenue` above is one drawer, one building-month, and the day-one
 * grid is 8 buildings x 12 months = 96 cells. A ritual that opens a drawer 96 times is not
 * a ritual anyone performs, and — unlike a P&L that merely LOOKS unusable — that ceiling is
 * the reason `location_revenue` stays empty and `/pl/` reads "nicht beurteilbar" forever.
 *
 * SAME RULE AS THE SINGLE-CELL ROUTE (supersede, THEN insert), applied to every row in TWO
 * BULK STATEMENTS rather than one CTE. One CTE was tried first and is wrong: Postgres runs
 * every data-modifying clause of a single `WITH` against ONE shared snapshot, so an INSERT
 * that needs to see an UPDATE's supersede IN THE SAME STATEMENT is not guaranteed to — and
 * measured here, it did not: a same-batch correction 500'd on
 * `location_revenue_one_live_idx` because the INSERT's uniqueness check ran before the
 * UPDATE's supersede was visible to it. Two SEPARATE statements (bulk UPDATE, THEN bulk
 * INSERT, both over `unnest()` so it is still 2 round trips and not 2N) sidestep that
 * because each is its own command with its own snapshot. This is exactly `putRevenue`'s own
 * two-statement shape above, scoped to N rows instead of 1 — including its same small,
 * accepted window: a crash between the two statements leaves a superseded row with no live
 * replacement, same risk a single edit already carries today, just wider. This codebase has
 * no transaction helper anywhere (`grep -rn "BEGIN\|pool.connect" server/routes/*.js` ->
 * nothing), so accepting that window is the existing convention, not a new one.
 *
 * Every location id is checked to exist BEFORE anything is written: a bulk save that
 * silently drops the one row with a typo'd id is worse than refusing the whole batch.
 * Duplicate (location_id, month) pairs WITHIN one request are refused too — the supersede
 * step can only correctly retire ONE prior row per pair, and two entries claiming the same
 * cell in the same request is a client bug or two tabs open on the same grid, not a case to
 * silently pick a winner for.
 *
 * NOTHING HERE INVENTS A FIGURE. Every entry is a value the caller sent; there is no
 * pre-fill from the contract suggestion and no zero for a cell the director left blank —
 * an omitted cell is simply not in `entries` and stays exactly as unknown as it was
 * (decision-42). The bulk grid on `/pl/` only ever sends cells a human actually typed into.
 */
async function putRevenueBulk({ body, session }) {
  const rawEntries = Array.isArray(body.entries) ? body.entries : null;
  if (rawEntries === null || rawEntries.length === 0) fail(400, "invalid_field", "entries");
  if (rawEntries.length > REVENUE_BULK_MAX) fail(422, "too_many_entries", "entries");

  const parsed = rawEntries.map((entry, i) => {
    const locationId = v.uuid(entry?.location_id, `entries[${i}].location_id`);
    const month = v.isoMonth(entry?.month, `entries[${i}].month`);
    // Same "absent is not zero" rule as the single-cell route: a cell with no amount is not
    // an entry, and 0 IS accepted — "they paid nothing this month" is a real answer.
    if (entry?.amount_cents === undefined || entry?.amount_cents === null || entry?.amount_cents === "") {
      fail(422, "amount_required", `entries[${i}].amount_cents`);
    }
    const amountCents = v.cents(entry.amount_cents, `entries[${i}].amount_cents`);
    const note = v.optionalStr(entry?.note, `entries[${i}].note`, { max: 500 });
    return { locationId, month, amountCents, note };
  });

  const seen = new Set();
  for (const { locationId, month } of parsed) {
    const key = `${locationId}|${month}`;
    if (seen.has(key)) fail(422, "duplicate_entry", key);
    seen.add(key);
  }

  const locationIds = [...new Set(parsed.map((p) => p.locationId))];
  const known = await all("SELECT id FROM locations WHERE id = ANY($1::uuid[])", [locationIds]);
  const knownIds = new Set(known.map((r) => r.id));
  const missing = locationIds.filter((id) => !knownIds.has(id));
  if (missing.length > 0) fail(404, "unknown_location", missing.join(","));

  const locationIdArr = parsed.map((p) => p.locationId);
  const monthArr = parsed.map((p) => p.month);

  // Statement 1: supersede every LIVE row this batch is about to replace, in one bulk
  // UPDATE. Rows the batch does not touch are untouched, same as the single-cell route.
  const superseded = await all(
    `UPDATE location_revenue r
        SET superseded_at = now(), superseded_by = $3
       FROM unnest($1::uuid[], $2::date[]) AS i(location_id, month)
      WHERE r.location_id = i.location_id AND r.month = i.month AND r.superseded_at IS NULL
      RETURNING r.location_id, r.month, r.amount_cents AS previous_cents`,
    [locationIdArr, monthArr, session.adminId],
  );
  const previousOf = new Map(superseded.map((s) => [`${s.location_id}|${String(s.month).slice(0, 10)}`, Number(s.previous_cents)]));

  // Statement 2, run AFTER statement 1 has committed its own snapshot: bulk INSERT the new
  // live row for every entry. Postgres now sees every row statement 1 just superseded, so
  // the partial unique index (`location_revenue_one_live_idx`) admits exactly one live row
  // per (building, month) the way the single-cell route already relies on it to.
  const inserted = await all(
    `INSERT INTO location_revenue (location_id, month, amount_cents, note, entered_by)
     SELECT location_id, month, amount_cents, note, $5
       FROM unnest($1::uuid[], $2::date[], $3::bigint[], $4::text[])
                 AS t(location_id, month, amount_cents, note)
     RETURNING ${REVENUE_COLS}`,
    [locationIdArr, monthArr, parsed.map((p) => p.amountCents), parsed.map((p) => p.note), session.adminId],
  );

  const entries = inserted.map((row) => ({
    ...row,
    previous_cents: previousOf.get(`${row.location_id}|${String(row.month).slice(0, 10)}`) ?? null,
  }));

  return { status: 200, body: { entries } };
}

/**
 * DELETE /admin/locations/:id/revenue/:month -> RETRACT. The month reverts to UNKNOWN.
 *
 * NOT OPTIONAL, and not the same as entering 0. If a figure lands on the wrong building the
 * only other way back would be "set it to 0", which asserts that a paying client paid
 * nothing — inside a report that drives conversations with that client.
 *
 * The retracted row is kept and stamped, like a correction: what was believed, and when it
 * stopped being believed, are both facts.
 */
async function retractRevenue({ params, session }) {
  const locationId = v.uuid(params.id, "id");
  const month = v.isoMonth(params.month, "month");
  const row = await one(
    `UPDATE location_revenue SET superseded_at = now(), superseded_by = $3
      WHERE location_id = $1 AND month = $2 AND superseded_at IS NULL
      RETURNING ${REVENUE_COLS}`,
    [locationId, month, session.adminId],
  );
  if (!row) fail(404, "unknown_revenue_entry");
  // The body states the RESULTING state: this month is now unknown, which is what the
  // screen has to render. Not "deleted: true" — nothing was deleted.
  return { status: 200, body: { retracted: row, revenue_cents: null, revenue_unknown_reason: "not_entered" } };
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
  { method: "POST", path: "/admin/password", auth: "admin", handler: changePassword },
  { method: "GET", path: "/admin/data", auth: "admin", handler: adminData },
  { method: "POST", path: "/admin/workers", auth: "admin", handler: upsertWorker },
  { method: "DELETE", path: "/admin/workers/:id", auth: "admin", handler: deleteWorker },
  { method: "POST", path: "/admin/workers/:id/enrolment-code", auth: "admin", handler: issueEnrolmentCode },
  { method: "DELETE", path: "/admin/workers/:id/enrolment-code", auth: "admin", handler: revokeEnrolmentCode },
  // decision-48. A SEPARATE route, deliberately: the two lines above keep their exact
  // current shape, so the fallback can never end up behind a parameter on a shared route.
  { method: "POST", path: "/admin/workers/:id/enrolment-code/sms", auth: "admin", handler: sendEnrolmentCodeBySms },
  { method: "PUT", path: "/admin/workers/:id/phone", auth: "admin", handler: putWorkerPhone },
  { method: "DELETE", path: "/admin/workers/:id/phone", auth: "admin", handler: deleteWorkerPhone },
  { method: "GET", path: "/admin/sms-status", auth: "admin", handler: smsStatusRoute },
  // decision-45. POST /operator/workers is deliberately NOT in this list — see the
  // comment above createOperator.
  { method: "POST", path: "/admin/operators", auth: "admin", handler: createOperator },
  { method: "DELETE", path: "/admin/operators/:id", auth: "admin", handler: deleteOperator },
  { method: "POST", path: "/admin/operators/:id/enrolment-code", auth: "admin", handler: issueOperatorEnrolmentCode },
  {
    method: "POST",
    path: "/admin/operators/:id/enrolment-code/sms",
    auth: "admin",
    handler: sendOperatorEnrolmentCodeBySms,
  },
  { method: "DELETE", path: "/admin/operators/:id/enrolment-code", auth: "admin", handler: revokeOperatorEnrolmentCode },
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
  { method: "POST", path: "/admin/zones", auth: "admin", handler: upsertZone },
  { method: "DELETE", path: "/admin/zones/:id", auth: "admin", handler: deleteZone },
  { method: "POST", path: "/admin/tags/:id/resolve-zone", auth: "admin", handler: resolveTagToZone },
  { method: "POST", path: "/admin/tags/:id/resolve-existing-zone", auth: "admin", handler: resolveTagToExistingZone },
  { method: "GET", path: "/admin/revenue", auth: "admin", handler: listRevenue },
  { method: "POST", path: "/admin/revenue", auth: "admin", handler: putRevenueBulk },
  { method: "POST", path: "/admin/locations/:id/revenue", auth: "admin", handler: putRevenue },
  { method: "DELETE", path: "/admin/locations/:id/revenue/:month", auth: "admin", handler: retractRevenue },
  { method: "GET", path: "/admin/pl", auth: "admin", handler: plReport },
  { method: "GET", path: "/admin/analytics", auth: "admin", handler: analyticsReport },
  { method: "POST", path: "/admin/settings", auth: "admin", handler: putSetting },
  { method: "DELETE", path: "/admin/settings/:key", auth: "admin", handler: deleteSetting },
];
