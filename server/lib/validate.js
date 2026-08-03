// Input validation. Trust boundary: NFC tags are left UNLOCKED (decision-15), so the
// location id on the wire is attacker-controllable. Nothing here trusts the client.
import { one } from "./db.js";
import { fail } from "./http.js";

// Sane timestamp window: nothing before the company started tracking, nothing far ahead.
const EPOCH_FLOOR_MS = Date.UTC(2024, 0, 1);
const CLOCK_SKEW_MS = 5 * 60 * 1000; // phone clocks drift; tolerate 5 min

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function str(value, field, { max = 200, min = 1 } = {}) {
  if (typeof value !== "string") fail(400, "invalid_field", field);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) fail(400, "invalid_field", field);
  return trimmed;
}

export function optionalStr(value, field, opts = {}) {
  if (value === undefined || value === null || value === "") return null;
  return str(value, field, opts);
}

/**
 * Human-readable location handle. Admin UI and log lines ONLY — decision-21 took the
 * slug out of the tag URI because a guessable identifier on an unlocked tag lets
 * anyone enumerate every building. Charset-restricted.
 */
export function slug(value, field = "slug") {
  const s = str(value, field, { max: 64 });
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(s)) fail(400, "invalid_slug", field);
  return s;
}

/**
 * UUID as carried in the NDEF URI (?l=<uuid>) and in admin payloads.
 * Shape-checked here so nothing but 36 known-good characters reaches SQL — the
 * value comes off an unlocked NFC tag and is fully untrusted (decision-15).
 */
export function uuid(value, field = "id") {
  if (typeof value !== "string") fail(400, "invalid_uuid", field);
  const s = value.trim().toLowerCase();
  if (!UUID_RE.test(s)) fail(400, "invalid_uuid", field);
  return s;
}

// Deliberately loose. A regex cannot decide whether an address is deliverable, and the
// strict RFC 5322 grammar rejects real addresses people actually have. This checks the
// SHAPE only — one @, something either side, a dot in the domain, no whitespace — which
// is enough to catch the realistic admin typo (a name, or an address with a trailing
// comma) without inventing rules Apple does not follow.
const EMAIL_RE = /^[^\s@,]+@[^\s@,.]+(\.[^\s@,.]+)+$/;
const EMAIL_MAX = 320; // RFC 5321 practical maximum

/**
 * Worker login address (decision-22). Empty/absent means "no email on file", which is a
 * legitimate state: a worker created before Apple sign-in existed, or one whose
 * apple_sub is already bound.
 *
 * ALWAYS lower-cased. workers.email is lower-case by invariant and login lower-cases
 * before it looks the address up, so storing "Anna@Example.at" here would silently lock
 * that worker out forever with nothing visibly wrong. The database CHECK in
 * 002_worker_identity.sql is the backstop; this is the gate.
 */
export function optionalEmail(value, field = "email") {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const s = str(value, field, { max: EMAIL_MAX }).toLowerCase();
  if (!EMAIL_RE.test(s)) fail(400, "invalid_email", field);
  return s;
}

export function id(value, field = "id") {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 1) fail(400, "invalid_id", field);
  return n;
}

/**
 * A foreign key the director has not filled in yet. "" is included because an HTML
 * <select> with no choice made posts an empty string, and "the building has no client
 * on file" is a legitimate, permanent state for a building that predates 003.
 */
export function optionalId(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return id(value, field);
}

/**
 * Free-text phone number (workers.phone, contacts.phone). Deliberately loose: an
 * Austrian mobile is written "+43 664 1234567", "0664/1234567" or "0664 123 45 67" and
 * all three are the same phone. This rejects letters and control characters — i.e. a
 * name pasted into the phone field — and nothing else. Never normalised, because
 * normalising means silently changing what the director typed.
 */
export function optionalPhone(value, field = "phone") {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const s = str(value, field, { max: 40, min: 4 });
  if (!/^[0-9+()/.\s-]+$/.test(s)) fail(400, "invalid_phone", field);
  return s;
}

export function cents(value, field = "hourly_rate_cents") {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0 || n > 100_000_000) fail(400, "invalid_field", field);
  return n;
}

/**
 * Money the director has not entered yet. NULL and 0 are different answers here:
 * NULL = "nobody has told me the contract volume", 0 = "this building is free of charge".
 * A profitability report has to be able to stay silent about the first case rather than
 * report a 100% loss, so `cents()`'s ?? 0 default would be wrong.
 */
export function optionalCents(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return cents(value, field);
}

/**
 * Duration as INTEGER MINUTES (target_minutes_per_month). Integers only, same reason as
 * cents: a target is compared against, and subtracted from, recorded time. Ceiling is a
 * generous month (31 days x 24h x 60 = 44640) times ten, which catches a value typed in
 * seconds or in milliseconds by mistake.
 */
export function optionalMinutes(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 0 || n > 446_400) fail(400, "invalid_field", field);
  return n;
}

/** Closed set of allowed strings (inventory kind). Mirrors a database CHECK; not a substitute for it. */
export function oneOf(value, field, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) fail(400, "invalid_field", field);
  return value;
}

export function bool(value, field, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") fail(400, "invalid_field", field);
  return value;
}

export function coord(value, field, limit) {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > limit) {
    fail(400, "invalid_field", field);
  }
  return n;
}

/** Parse an ISO-8601 timestamp and bound it to a sane window. */
export function timestamp(value, field) {
  if (typeof value !== "string" && !(value instanceof Date)) fail(400, "invalid_field", field);
  const d = value instanceof Date ? value : new Date(value);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) fail(400, "invalid_timestamp", field);
  if (ms < EPOCH_FLOOR_MS) fail(422, "timestamp_out_of_range", field);
  if (ms > Date.now() + CLOCK_SKEW_MS) fail(422, "timestamp_in_future", field);
  return d;
}

// A period boundary on the wire. Zone designator REQUIRED: a naked "2026-08-01T00:00"
// would be read in whatever zone this process happens to run in, and an hour of drift at a
// month boundary moves a shift between payslips. Callers convert Vienna wall time to UTC
// themselves (web/lib/period.ts) and send the instant.
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
// Absurdity guard only. Not the shift window: `to` is legitimately in the FUTURE (the end
// of the current month is), and `from` may predate the first shift.
const RANGE_FLOOR_MS = Date.UTC(2000, 0, 1);
const RANGE_CEIL_MS = Date.UTC(2100, 0, 1);

/**
 * One end of a reporting period (`?from=` / `?to=` on GET /admin/data).
 *
 * TRUST BOUNDARY: this is user input that reaches a WHERE clause. It is shape-checked
 * before parsing because Date.parse is lenient enough to turn junk into a real instant —
 * `new Date("30")` is the year 2030 in V8, not NaN — and a silently accepted garbage bound
 * would answer a payroll question with the wrong shifts. It never becomes SQL text: the
 * returned Date is passed as a bound parameter.
 */
export function rangeBound(value, field) {
  if (typeof value !== "string") fail(400, "invalid_field", field);
  const s = value.trim();
  if (!ISO_INSTANT_RE.test(s)) fail(400, "invalid_timestamp", field);
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) fail(400, "invalid_timestamp", field);
  if (ms < RANGE_FLOOR_MS || ms > RANGE_CEIL_MS) fail(422, "timestamp_out_of_range", field);
  return new Date(ms);
}

/**
 * Half-open `[from, to)`, either end optional. Absent means unbounded on that side, which
 * is what every caller before this parameter existed got and must keep getting.
 */
export function optionalRange(fromValue, toValue) {
  const from = fromValue === null || fromValue === undefined ? null : rangeBound(fromValue, "from");
  const to = toValue === null || toValue === undefined ? null : rangeBound(toValue, "to");
  // An empty or inverted range is a mistake, not a request for zero rows: answering 200
  // with an empty list would look exactly like "nobody worked".
  if (from !== null && to !== null && from.getTime() >= to.getTime()) fail(422, "invalid_range");
  return { from, to };
}

/**
 * start < end, no future start. Returns the pair.
 *
 * There is deliberately NO maximum duration here any more. The old 24h ceiling
 * rejected exactly the case the safety net exists for: a worker who forgets to tap
 * out for 30h could never clock out at all, getting 422 shift_too_long forever. Under
 * decision-10 the 8h timer owns runaway shifts — it closes them at start+8h before a
 * long window can ever be submitted.
 */
export function shiftWindow(startValue, endValue) {
  const start = timestamp(startValue, "start_time");
  const end = timestamp(endValue, "end_time");
  if (end.getTime() <= start.getTime()) fail(422, "end_before_start");
  return { start, end };
}

/**
 * Resolve an untrusted location UUID to a real, ACTIVE location.
 * Unguessable is not authenticated (decision-15): the id still has to be checked.
 */
export async function activeLocation(value, field = "location_uuid") {
  const row = await one("SELECT id, slug, name FROM locations WHERE id = $1 AND active", [uuid(value, field)]);
  if (!row) fail(422, "unknown_location");
  return row;
}

export async function activeWorkerById(value) {
  const row = await one("SELECT id, name FROM workers WHERE id = $1 AND active", [id(value, "worker_id")]);
  if (!row) fail(422, "unknown_worker");
  return row;
}

/**
 * Idempotency key from the iOS app, UUID-shaped so a client cannot squat arbitrary
 * strings. The SAME key identifies a shift across both halves of its life:
 * POST /shifts/open creates it, POST /shifts/close finds it again (decision-19).
 */
export function clientUuid(value) {
  return uuid(value, "client_uuid");
}
