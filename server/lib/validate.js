// Input validation. Trust boundary: NFC tags are left UNLOCKED (decision-15), so the
// location id on the wire is attacker-controllable. Nothing here trusts the client.
import { all, one } from "./db.js";
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

/**
 * A UUID the director has not filled in yet. Same reasoning as `optionalId`: an HTML
 * <select> with no choice made posts an empty string, and "the worker did not say which
 * building" is a legitimate, permanent state for a material request.
 */
export function optionalUuid(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return uuid(value, field);
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

/**
 * An email address becoming an IDENTITY (decision-64 §1) — the login address of a worker or
 * an operator. NOT `optionalEmail` above: that one feeds `workers.email`, the vestigial
 * Sign-in-with-Apple column decision-50 retired and decision-64 explicitly leaves alone, and
 * it is OPTIONAL. This one feeds `email_identities.email`, the ONLY place an address is
 * checked for uniqueness across workers and operators, so it is REQUIRED and it has to
 * produce one canonical spelling for every equivalent input or the PRIMARY KEY catches
 * nothing.
 *
 * The relationship between the two is exactly `optionalPhone` vs `identityPhone` below, for
 * exactly the same reason (decision-45 §4, decision-64 §1).
 *
 * LOWER-CASED, ALWAYS. Migration 020’s CHECK is the backstop; this is the gate. The local
 * part of an address is case-SENSITIVE per RFC 5321 and no mail provider anyone here uses
 * treats it that way — folding is what makes "Anna@Firma.at" and "anna@firma.at" one
 * identity, and not folding would let the same mailbox claim two rows.
 * ponytail CEILING: a (theoretical) provider that really does distinguish case cannot be
 * used here. UPGRADE PATH: none planned — 002 already made the same call for workers.email.
 *
 *   1. required — undefined/null/""/whitespace-only   -> 422 required_field
 *   2. trimmed, lower-cased, max 320 (RFC 5321 practical maximum)
 *   3. the SAME deliberately-loose shape `optionalEmail` uses — one @, something either
 *      side, a dot in the domain, no whitespace, no comma       -> 422 invalid_email
 *
 * 422 and not 400, matching `identityPhone`: these two are the identity-claim validators and
 * the routes that call them answer 422 for a shape failure.
 */
export function identityEmail(raw, field = "email") {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    fail(422, "required_field", field);
  }
  if (typeof raw !== "string") fail(422, "invalid_email", field);
  const s = raw.trim().toLowerCase();
  if (s.length > EMAIL_MAX || !EMAIL_RE.test(s)) fail(422, "invalid_email", field);
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

/**
 * A phone number becoming an IDENTITY (decision-45 §4) — an operator's own number, or
 * one typed by an operator to create a worker. NOT `optionalPhone` above: that column
 * (`workers.phone`) is free text, decorative, and never normalised on purpose. This one
 * feeds `phone_identities.phone_e164`, the ONLY place a phone number is checked for
 * uniqueness across workers and operators, so it has to produce one canonical spelling
 * for every equivalent input or the uniqueness constraint catches nothing.
 *
 * Ladder: needed at all — yes, `"0664..."`, `"+43 664..."` and `"0043 664..."` are the
 * SAME identity and a PRIMARY KEY only catches a collision if they normalise to the same
 * string. stdlib — none; Node has no phone parser. Already-installed dependency — none;
 * `libphonenumber-js` would be the first npm dependency beyond `pg` + `@sentry/node`,
 * forbidden outright. One line — no, this is validation at a trust boundary.
 *
 * ponytail: hand-rolled, AUSTRIA-DEFAULT E.164 normaliser, not a general phone parser.
 * CEILING: a number typed with neither a leading 0 nor a + is REJECTED, not guessed at —
 * this will never silently assume a foreign country's trunk convention (a German mobile
 * typed "0176 12345678" normalises as if Austrian, which is wrong and is caught only if
 * the resulting shape is implausible). UPGRADE PATH: `libphonenumber-js`, the day a
 * non-Austrian operator phone is a real requirement — its own decision record, because it
 * would be the first dependency this server carries beyond `pg` + Sentry.
 *
 *   1. required — undefined/null/""/whitespace-only          -> 422 required_field
 *   2. strip COSMETIC characters only: space, "-", "/", "(", ")"
 *      anything else non-digit / non-leading-"+" is refused    -> 422 invalid_phone
 *   3. leading "00" -> replace with "+"                        (0043... == +43...)
 *   4. no "+" prefix:
 *        leading "0" -> drop it, prepend "+43"                 (0664...  -> +43664...)
 *        otherwise   -> REFUSED, 422 invalid_phone — a bare "664 1234567" is never
 *                       silently assumed Austrian; the ambiguity is the caller's to
 *                       resolve by typing a 0 or a +, not this function's to guess
 *   5. final shape, E.164: /^\+[1-9]\d{7,14}$/ — leading digit after "+" is never 0 (no
 *      country code starts with 0), 8-15 digits total after "+" (ITU ceiling 15; 8 is a
 *      lower sanity floor)                                     -> 422 invalid_phone
 *
 * Worked examples (decision-45 §4 — the pair below normalising to the SAME string is the
 * whole reason this function exists):
 *   "0664 123 45 67"     -> "+436641234567"
 *   "+43 664/1234567"    -> "+436641234567"   (same identity as the line above)
 *   "0043 664 1234567"   -> "+436641234567"
 *   "01 5055904"         -> "+4315055904"     (Vienna landline; still an identity)
 *   "664 1234567"        -> REJECTED (no leading 0 or + — ambiguous, not Austrian)
 *   "Anna"                -> REJECTED (fails step 2)
 *   "+43664"              -> REJECTED (5 digits after +43, below the 8-digit floor)
 *   ""                    -> REJECTED (required_field)
 */
export function identityPhone(raw, field) {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    fail(422, "required_field", field);
  }
  if (typeof raw !== "string") fail(422, "invalid_phone", field);

  const stripped = raw.replace(/[\s\-/()]/g, "");
  // Only digits, with at most one leading "+", may survive the strip — a name pasted in,
  // or any other symbol, is refused rather than silently dropped.
  if (!/^\+?[0-9]+$/.test(stripped)) fail(422, "invalid_phone", field);

  let digits = stripped.startsWith("00") ? `+${stripped.slice(2)}` : stripped;

  if (!digits.startsWith("+")) {
    if (digits.startsWith("0")) {
      digits = `+43${digits.slice(1)}`;
    } else {
      // A bare national number with neither a leading 0 nor a +. Guessing the country
      // would be the exact silent reformat decision-45 §4 refuses to do.
      fail(422, "invalid_phone", field);
    }
  }

  if (!/^\+[1-9][0-9]{7,14}$/.test(digits)) fail(422, "invalid_phone", field);
  return digits;
}

export function cents(value, field = "hourly_rate_cents") {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0 || n > 100_000_000) fail(400, "invalid_field", field);
  return n;
}

/**
 * A WAGE. Required, and strictly positive (decision-41).
 *
 * `cents()` above defaults an absent value to 0, and `001_init.sql` defaulted the column to
 * 0 as well, so a worker created without a rate silently became a worker who costs
 * EUR 0,00/h. Eleven lines below, `optionalCents` carries the comment that names the whole
 * defect: NULL = "nobody has told me", 0 = "free of charge". Contract money got that
 * distinction. Wages never did, and every rate-less defect in this system descends from it.
 *
 * A wage has NO "free of charge" reading. The Austrian collective agreement for building
 * cleaning sets a floor well above zero, and an employee who costs nothing does not exist.
 * So 0 is refused here and is unrepresentable in the column (`workers_rate_positive`),
 * which is what lets the named `Kein Stundensatz` exclusion be DELETED rather than kept.
 *
 *   absent / null / ""   422 rate_required   detail "hourly_rate_cents"
 *   0                    422 rate_required   detail "hourly_rate_cents"
 *   junk / negative      400 invalid_field   detail "hourly_rate_cents"   (unchanged)
 *
 * 422 and not 400 because the house line is already drawn: 400 is a malformed shape
 * (`invalid_field`, `invalid_uuid`), 422 is a well-formed request the business refuses
 * (`unknown_location`, `end_before_start`). "You did not tell me the wage" is the second
 * kind. The one existing inconsistency — `requiredRange` uses `400 missing_field` — is
 * LEFT ALONE on purpose: churning a live wire contract for symmetry is not worth it, and
 * the divergence is recorded in decision-41 rather than rediscovered.
 *
 * ponytail: ONE code for both absent and zero. CEILING — the UI cannot phrase "you typed
 * nothing" differently from "you typed zero". Two codes would mean two message keys in two
 * locales carrying one instruction, and the director does exactly one thing about either.
 * UPGRADE PATH: split into `rate_required` / `rate_must_be_positive` the day somebody
 * reports the message is confusing.
 */
export function requiredRate(value, field = "hourly_rate_cents") {
  if (value === undefined || value === null || value === "") fail(422, "rate_required", field);
  const n = cents(value, field); // shape only: junk and negatives stay 400 invalid_field
  if (n === 0) fail(422, "rate_required", field);
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

/**
 * A zone's floor area in SQUARE METRES (decision-43). NULL = nobody has measured it, and
 * that is a real, permanent state — "Stiege 3, there is no floor plan".
 *
 * NULL IS NOT 0 AND MUST NEVER BECOME IT. This number is the DENOMINATOR of every EUR/m2
 * and minutes/m2 figure the director quotes a new building from, so an invented area does
 * not produce a slightly wrong benchmark, it produces a confident wrong one. A building
 * with any unmeasured active zone reports every per-m2 figure as NULL with a reason.
 *
 * Two decimals, matching `NUMERIC(8,2)` in the column, and validated as a string of digits
 * rather than by rounding a float: `parseFloat` would silently accept `12.345` and store
 * `12.35`, turning a typo into a measurement. Strictly positive for the same reason 0 is
 * refused on a wage — a zone with no floor is not a zone.
 */
const AREA_RE = /^\d{1,6}([.,]\d{1,2})?$/;

export function optionalArea(value, field = "area_sqm") {
  if (value === undefined || value === null || value === "") return null;
  // Numbers are accepted so a JSON client need not stringify, but they go through the same
  // two-decimal gate: 12.345 is a typo, not a measurement.
  const s = typeof value === "number" ? String(value) : str(value, field, { max: 12, min: 1 });
  if (!AREA_RE.test(s)) fail(400, "invalid_field", field);
  const normalised = s.replace(",", ".");
  if (Number(normalised) <= 0) fail(400, "invalid_field", field);
  // Returned as a STRING and handed to Postgres as `numeric`. Passing a JS number here
  // would route an exact decimal through binary floating point on the way to the column
  // that is deliberately NOT a float.
  return normalised;
}

/**
 * "How many of them" (material_requests.quantity). STRICTLY POSITIVE, mirroring the 005
 * CHECK: a request for zero bottles is not a request, and letting 0 through would surface
 * Postgres' 23514 as a 500 instead of naming the field. NULL means the admin has not said
 * yet, which is a real state while a request is still being validated.
 */
export function optionalCount(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 1 || n > 1_000_000) fail(400, "invalid_field", field);
  return n;
}

/**
 * "How many rows to skip" (a page offset). ZERO IS THE NORMAL VALUE — page one — which is
 * exactly why `optionalCount` cannot be reused here: it rejects 0 on purpose. Omitted means
 * page one too, so a caller that never learned about paging keeps the payload it always got.
 *
 * `offset=abc` is a 400 and not a silent 0: this is a trust boundary, and a client that
 * mistyped its paging parameter must be told, not quietly handed page one for ever while it
 * believes it is on page seven.
 */
export function optionalOffset(value, field = "offset") {
  if (value === undefined || value === null || value === "") return 0;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000) fail(400, "invalid_field", field);
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
 * Half-open `[from, to)` with BOTH ends mandatory — the reporting-period parameter for
 * GET /admin/pl and GET /admin/analytics.
 *
 * Unbounded is meaningful for a shift LIST ("show me everything") and meaningless for a
 * P&L: revenue is a monthly contract pro-rated over the days in the period, so an open
 * end is either an infinite number of days or a silent substitution of some default month
 * the caller never asked for. Refusing is the only honest answer.
 */
export function requiredRange(fromValue, toValue) {
  if (fromValue === null || fromValue === undefined) fail(400, "missing_field", "from");
  if (toValue === null || toValue === undefined) fail(400, "missing_field", "to");
  return optionalRange(fromValue, toValue);
}

// A Vienna CALENDAR DATE on the wire, `YYYY-MM-DD`. Used for contract validity bounds:
// a price changes on a day, not at an instant, so this deliberately carries no time and
// no zone and therefore has no DST to get wrong.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the STRING, not a Date. It is handed to Postgres as a `date` parameter, and
 * turning it into a JS Date first would re-introduce the very timezone question the DATE
 * type exists to avoid (`new Date("2026-03-29")` is UTC midnight, which is 01:00 or 02:00
 * in Vienna depending on the month).
 */
export function isoDate(value, field) {
  const s = str(value, field, { max: 10, min: 10 });
  if (!ISO_DATE_RE.test(s)) fail(400, "invalid_date", field);
  // Round-trip through UTC to reject 2026-02-31 and friends, which the regex accepts.
  const d = new Date(`${s}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) fail(400, "invalid_date", field);
  const year = Number(s.slice(0, 4));
  if (year < 2000 || year > 2100) fail(422, "timestamp_out_of_range", field);
  return s;
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
 * A Vienna CALENDAR MONTH on the wire, `YYYY-MM` (decision-42).
 *
 * Returns the STRING `'YYYY-MM-01'`, not a Date, for `isoDate`'s exact reason: turning it
 * into a JS Date re-introduces the timezone question the DATE type exists to avoid
 * (`new Date("2026-03-01")` is UTC midnight, which is 01:00 or 02:00 in Vienna depending
 * on the month). Postgres takes it as a `date` parameter.
 *
 * FUTURE MONTHS are accepted up to the NEXT Vienna calendar month and refused beyond with
 * `422 month_too_far_ahead`. Prepaid cleaning contracts are real, so a hard "no future"
 * would refuse a legitimate entry; a cap of +1 still catches the realistic typo, which is
 * the wrong YEAR. A judgement call, named as one.
 */
const ISO_MONTH_RE = /^\d{4}-\d{2}$/;

export function isoMonth(value, field = "month") {
  const s = str(value, field, { max: 7, min: 7 });
  if (!ISO_MONTH_RE.test(s)) fail(400, "invalid_month", field);
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  if (month < 1 || month > 12) fail(400, "invalid_month", field);
  if (year < 2000 || year > 2100) fail(422, "timestamp_out_of_range", field);

  // "Which month is it in Vienna right now" — asked of the tz database via Intl, not of the
  // process's own zone. A server running in UTC is one hour behind Vienna, so on the last
  // evening of a month it would otherwise compute the previous month as "now" and refuse an
  // entry that is legitimately +1.
  const nowVienna = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const nowIndex = Number(nowVienna.slice(0, 4)) * 12 + Number(nowVienna.slice(5, 7));
  if (year * 12 + month > nowIndex + 1) fail(422, "month_too_far_ahead", field);

  return `${s}-01`;
}

/**
 * Resolve an untrusted location UUID to a real, ACTIVE BUILDING.
 * Unguessable is not authenticated (decision-15): the id still has to be checked.
 *
 * BUILDING ONLY, deliberately, and it is NOT the tap path any more — see `activePlace`.
 * The callers left here are the ones where a building is the only sensible answer: an
 * admin typing a shift picks a building from a dropdown, and a material request is
 * building-level by decision-6. A zone id posted to either of those is a mistake and must
 * be refused, not silently widened.
 */
export async function activeLocation(value, field = "location_uuid") {
  const row = await one("SELECT id, slug, name FROM locations WHERE id = $1 AND active", [uuid(value, field)]);
  if (!row) fail(422, "unknown_location");
  return row;
}

/**
 * THE TAP PATH. Resolve one untrusted UUID off a tag to the PLACE it names (decision-43).
 *
 * The `l` in `/t?l=<uuid>` means "the id of the place that was tapped", and the id space is
 * shared between buildings and zones:
 *
 *   an ACTIVE zone of an ACTIVE building  -> { location_id, zone_id }
 *   an ACTIVE building                    -> { location_id, zone_id: null }
 *   neither                               -> 422 unknown_location
 *
 * *** THE SECOND LINE IS LOAD-BEARING AND MUST NOT ACQUIRE A ZONE PREDICATE. ***
 * The card physically on the wall at HOIV carries a BUILDING uuid, and that building has
 * zero zones. "A building with no zones is inactive" is a PRESENTATION rule about a grey
 * pin on the map; implemented here it would 422 that card on the day migration 006 lands,
 * and no site visit could fix it — the tag cannot be rewritten from Vienna. `locations.active`
 * ALONE decides whether a building tag resolves, zoned or not, for ever.
 *
 * decision-47 RE-STATES THAT PROHIBITION AND ADDS NOTHING TO IT. Verification (010) is a
 * ZONE-only concept, and this function is deliberately NOT where it is enforced: a predicate
 * here would collapse "nobody has proved this card yet" into `unknown_location` — telling a
 * cleaner the building was removed — and would make the verify route itself unable to resolve
 * the zone it is about to prove. The gate is `requireVerifiedPlace` below, called by
 * POST /shifts/open and by nothing else. The building branch keeps emitting NULL LITERALS for
 * both zone columns, so no value of `zones.verified_at`, for any row, in any state, can change
 * what a BUILDING uuid answers.
 *
 * A building UUID never resolves to "the first zone" or "a default zone" either: that
 * fabricates a tap location and silently changes meaning the day a second zone is added.
 *
 * THE ERROR CODE STAYS `unknown_location`. The APK in the field maps exactly that string to
 * a translated message; any NEW code renders as "unknown status from a newer server".
 *
 * Unguessable is not authenticated (decision-15) and a serial is not a credential
 * (decision-44): everything arriving here is untrusted and shape-checked before it reaches
 * SQL, and it is resolved server-side rather than believed.
 */
export async function activePlace(value, field = "location_uuid") {
  const placeId = uuid(value, field);
  // ONE round trip over every table an id can name. UNION ALL and not UNION: an id cannot
  // be more than one of these, and making the impossible case collapse silently is exactly
  // what the length check below exists to prevent.
  //
  // THE FOURTH BRANCH is new (server/db/migrations/008_reported_tags.sql): a tag_aliases
  // row is how an ALREADY-EXISTING zone adopts a second physical tag without re-keying its
  // own id (see that migration's own comment for why re-keying was rejected). Purely
  // additive — the first three branches, and every id that only ever matched one of them,
  // are unchanged.
  //
  // `zone_verified_at` (010, decision-47) is the ONE added selected expression. Every WHERE
  // clause below is byte for byte what it was: this function still RESOLVES an unverified
  // zone, and reports what it found. Deciding what to do about it is the caller's, and only
  // POST /shifts/open decides anything.
  const rows = await all(
    `SELECT l.id AS location_id, NULL::uuid AS zone_id, l.slug, l.name, NULL::text AS zone_name,
            NULL::timestamptz AS zone_verified_at
       FROM locations l
      WHERE l.id = $1 AND l.active
     UNION ALL
     SELECT z.location_id, z.id AS zone_id, l.slug, l.name, z.name AS zone_name,
            z.verified_at AS zone_verified_at
       FROM zones z
       JOIN locations l ON l.id = z.location_id
      WHERE z.id = $1 AND z.active AND l.active
     UNION ALL
     SELECT z.location_id, z.id AS zone_id, l.slug, l.name, z.name AS zone_name,
            z.verified_at AS zone_verified_at
       FROM tag_aliases ta
       JOIN zones z ON z.id = ta.zone_id
       JOIN locations l ON l.id = z.location_id
      WHERE ta.id = $1 AND z.active AND l.active`,
    [placeId],
  );
  // Only reachable by a UUIDv4 collision across these tables, i.e. never. One line, and it
  // is the difference between a refusal and silently picking a building. ponytail: it
  // refuses with the SAME code rather than a new one, so the field build renders a message
  // it has. CEILING: a collision is indistinguishable from a miss in the log. UPGRADE PATH:
  // a distinct code once both clients understand new ones.
  if (rows.length > 1) fail(422, "unknown_location");
  if (rows.length === 1) return rows[0];

  // ZERO rows: this iteration's own distinction (server/db/migrations/008_reported_tags.sql).
  // "Not ours at all" (a stranger's tag, a typo, a torn-off sticker) and "ours, but nobody
  // has resolved it yet" (an operator wrote and reported this id, an admin has not decided
  // what it is) are DIFFERENT facts, and tapping the second one WILL happen — tags get
  // mounted before anyone resolves them. It must not read as a generic refusal: the app
  // needs to tell the worker something specific and true in German ("dieser Tag ist noch
  // nicht zugewiesen"), not the same message a garbage tag gets.
  //
  // THE CODE `unknown_location` STAYS UNCHANGED for every case that already used it — the
  // APK in the field maps exactly that string. `tag_unbound` is a NEW code an old build has
  // never seen; per the established fallback (see the comment two lines below), it renders
  // as "unknown status from a newer server", which is a safe degrade, not a crash — it must
  // not open a shift against nothing and must not 500, and it does neither.
  const reported = await one("SELECT resolved_at FROM reported_tags WHERE id = $1", [placeId]);
  if (reported && reported.resolved_at === null) fail(422, "tag_unbound");
  fail(422, "unknown_location");
}

/**
 * THE VERIFICATION GATE (decision-47). Called by POST /shifts/open and BY NOTHING ELSE.
 *
 * A zone becomes a clock-in target when an OPERATOR, standing in the building with the card
 * in hand, has test-scanned it (POST /operator/zones/:id/verify). Until then a tap on it is
 * refused BY NAME and no shift row is created — an admin typing a zone name at a desk has
 * proved nothing about a physical card on a physical wall.
 *
 * *** LINE 1 IS THE HOIV GRANDFATHER, AND IT IS UNCONDITIONAL. ***
 * A BUILDING tap has no zone. `activePlace`'s building branch emits `NULL::uuid AS zone_id`
 * as an SQL LITERAL, never a join result, so `place.zone_id === null` is decided by the
 * SHAPE of the query and not by the contents of any row. The card mounted at HOIV therefore
 * cannot be reached by this function at all: it returns before `zone_verified_at` is read,
 * for every value that column could ever hold. Deleting this line 422s a card nobody in
 * Vienna can rewrite — which is exactly the RED case ops/check-hoiv-survives-006.mjs seeds.
 *
 * NOT APPLIED ON CLOSE, EVER. A worker who is clocked in must always be able to clock out
 * (INCIDENT 1, the worst failure this system has had). A tap on an unverified zone of the
 * building a worker is already clocked into closes the shift, records `end_zone_id`, and is
 * not gated — `end_zone_id` is a tap FACT, never an input to money (decision-43 §4).
 *
 * THE CODE IS NEW, AND WHAT AN OLD APK DOES WITH IT WAS CHECKED BEFORE IT WAS CHOSEN.
 * `unknown_location` stays the code for every case that already used it (see `activePlace`'s
 * comment). `zone_unverified` is a code the shipped build has never seen, so it falls through
 * `ApiFailure.messageKey`'s `else` branch to `err_rejected` — a sentence, not a crash, and
 * still no shift row: the same safe degrade `tag_unbound` had before its own string shipped.
 * It is also RETRYABLE on the phone, deliberately, because a refusal here is a temporary
 * state of the SERVER's configuration and not a defect in the payload: the identical bytes
 * succeed the moment the operator test-scans, and a non-retryable code would block the queued
 * row for ever and lose hours somebody actually worked.
 */
export function requireVerifiedPlace(place) {
  if (place.zone_id === null) return place; // BUILDING TAP. No zone exists, so no gate can apply.
  if (place.zone_verified_at === null) fail(422, "zone_unverified");
  return place;
}

/**
 * The optional note on a MANUAL shift open/close (TASK-316). Free text, capped.
 *
 * 422 and not 400 on an oversized note, matching the other "the payload is well-formed but
 * we will not store it" refusals on these routes: the phone can shorten and retry. Absent,
 * null, empty and whitespace-only all collapse to NULL — "said nothing" has one spelling in
 * the column. The DB CHECK in migration 019 is the same bound and must never be what
 * rejects: a 23514 here would surface as a 500.
 */
export const MANUAL_NOTE_MAX = 255;
export function manualNote(value, field = "note") {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(400, "invalid_field", field);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MANUAL_NOTE_MAX) fail(422, "note_too_long", field);
  return trimmed;
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
