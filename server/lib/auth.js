// Auth. Trust boundary — nothing in here is a convenience wrapper.
//
//   X-App-Key   -> iOS routes. One shared secret baked into the build. A COARSE gate
//                 only: it says "this is our app", never "this is Anna". Kept as defence
//                 in depth, never as identity.
//   ts_session  -> /admin/* routes. Email + password, server-side session (decision-20).
//   ts_worker   -> worker routes. Sign in with Apple, server-side session (decision-22).
//   ts_operator -> operator routes. Admin-issued enrolment code, server-side session
//                 (decision-45). An operator session can never reach a route that opens
//                 or closes a shift — no route under /shifts/* is ever auth: "operator".
//
// decision-22 — the app key USED to be the whole story on /shifts/*, with the caller
// naming themselves in body.worker_id. That let anyone holding the key file hours as
// anyone. Worker identity now comes from a session minted against a verified Apple
// identity token, and the request body no longer gets a vote.
//
// The X-Admin-Pin header is GONE. It was a short shared secret with no rate limit
// and no length floor, on a host that is now publicly reachable (the exe.dev proxy
// must serve AASA to Apple). A PIN cannot be made safe there; it was removed rather
// than lengthened.
//
// Nothing here is ever logged: not passwords, not hashes, not tokens, not cookies.
// Callers must keep it that way — `console.log(session)` would defeat all of it.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import * as Sentry from "@sentry/node";
import { one, query } from "./db.js";
import { fail } from "./http.js";

const scryptAsync = promisify(scrypt);

/** Constant-time string compare. Length-guarded (timingSafeEqual throws on length mismatch). */
export function safeEqual(a, b) {
  const left = Buffer.from(typeof a === "string" ? a : "", "utf8");
  const right = Buffer.from(typeof b === "string" ? b : "", "utf8");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function requireAppKey(headers) {
  if (!safeEqual(headers["x-app-key"], process.env.APP_KEY)) fail(401, "unauthorized");
}

// ---- password hashing ------------------------------------------------------------
// node:crypto scrypt. Deliberately NOT bcrypt/argon2: those are dependencies, this is
// stdlib, and scrypt is memory-hard which is the property that matters here.
// N=16384,r=8,p=1 costs ~16 MB and ~60 ms per attempt — under Node's 32 MB default
// maxmem, and slow enough that the rate limiter below is the second line of defence.
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const PREFIX = `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}`;

// Stored form: "scrypt$N$r$p$<salt_hex>$<key_hex>" — a self-describing PHC-style
// string, so the cost parameters can be raised later without a schema change or a
// flag day: verify reads the params out of the row it is checking.
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password.normalize("NFKC"), salt, KEY_BYTES, SCRYPT);
  return `${PREFIX}$${salt.toString("hex")}$${key.toString("hex")}`;
}

const fromHex = (s, bytes) => {
  if (typeof s !== "string" || s.length !== bytes * 2 || !/^[0-9a-f]+$/i.test(s)) return null;
  return Buffer.from(s, "hex");
};

/** @returns {Promise<boolean>} never throws on a malformed stored value — that is just "no". */
export async function verifyPassword(password, stored) {
  const parts = String(stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, keyHex] = parts;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Object.values(params).every((x) => Number.isInteger(x) && x > 0)) return false;

  const expected = fromHex(keyHex, keyHex.length / 2);
  const salt = fromHex(saltHex, saltHex.length / 2);
  if (!salt || !expected || salt.length < SALT_BYTES || expected.length < 16) return false;

  const key = await scryptAsync(password.normalize("NFKC"), salt, expected.length, params);
  return timingSafeEqual(key, expected);
}

// An unknown email must cost the same as a known one, or the response time leaks
// which addresses are real. Built once, lazily, from a password nobody has.
let decoyHash = null;
export async function decoy() {
  decoyHash ??= await hashPassword(randomBytes(32).toString("hex"));
  return decoyHash;
}

// ---- sessions --------------------------------------------------------------------
// Server-side sessions, not JWTs: logout has to actually revoke, and there are 5-20
// users on one box. The cookie is httpOnly so JavaScript (and therefore XSS) cannot
// read it, Secure so it never crosses plaintext, SameSite=Strict so a third-party
// page cannot ride it. It is NOT in localStorage on purpose.
export const SESSION_COOKIE = "ts_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
const TOKEN_RE = /^[0-9a-f]{64}$/;

// Workers get their OWN cookie name and their OWN table. Sharing either with the admin
// path would mean a nullable FK plus a discriminator column, and one missed WHERE would
// turn a worker cookie into an admin credential. Two names, two tables, no shared
// failure mode — and the admin path, which is already deployed and tested, is untouched.
export const WORKER_SESSION_COOKIE = "ts_worker";

// 90 days, not the admin's 7. A worker taps a tag with the phone at a door, often with
// no signal and sometimes from the background NFC handler; a weekly re-auth prompt in
// that moment means a shift does not get recorded. Revocation does not depend on this
// number: `active` is re-checked from the workers row on EVERY request, so deactivating
// someone in the admin panel locks them out on their next call regardless.
const WORKER_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Operators get their OWN cookie name and their OWN table (decision-45 §6), for the same
// reason workers do not share `sessions` with admins: a nullable FK plus a discriminator
// column is how a stray WHERE turns one credential into another. Same TTL as a worker's,
// same field-with-no-signal rationale — an operator taps and reads tags from a phone in a
// stairwell too, and `active` is re-checked from `operators` on every request regardless.
export const OPERATOR_SESSION_COOKIE = "ts_operator";
const OPERATOR_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// The cookie carries the raw token; the DB only ever stores its SHA-256. A leaked dump,
// a stolen pg_backup .gz, or any read-only SQL hole then yields hashes that cannot be
// replayed as sessions. Same reasoning as password hashing, one rung down in cost.
//
// Plain SHA-256 is correct HERE and would be wrong for passwords: the token is 32 bytes
// of CSPRNG output, so there is no dictionary to attack and nothing for a slow KDF to buy.
// Running scrypt on every authenticated request would only hand out a cheap DoS.
// Exported because portal_grants stores its token the same way (003). ONE hash helper for
// every bearer token in the system: a second one would be a second chance to get it wrong,
// and a mismatch between writer and reader is a silent "nothing found" that looks like a
// revoked link.
export const hashToken = (token) => createHash("sha256").update(token, "utf8").digest("hex");

export async function createSession(adminId) {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query("INSERT INTO sessions (token, admin_id, expires_at) VALUES ($1, $2, $3)", [
    hashToken(token),
    adminId,
    expiresAt,
  ]);
  // Opportunistic sweep. Login is rare and this is an index-only range delete, so it
  // is cheaper than owning another systemd timer for it.
  await query("DELETE FROM sessions WHERE expires_at < now()");
  return { token, expiresAt };
}

export async function destroySession(token) {
  await query("DELETE FROM sessions WHERE token = $1", [hashToken(token)]);
}

/**
 * Workers: mint a session against an already-VERIFIED Apple identity (routes/auth.js
 * owns the verification and the eligibility check). This function does not authorise
 * anything — it only records a decision that was already made.
 */
export async function createWorkerSession(workerId) {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + WORKER_SESSION_TTL_MS);
  await query("INSERT INTO worker_sessions (token, worker_id, expires_at) VALUES ($1, $2, $3)", [
    hashToken(token),
    workerId,
    expiresAt,
  ]);
  await query("DELETE FROM worker_sessions WHERE expires_at < now()"); // same opportunistic sweep
  return { token, expiresAt };
}

export async function destroyWorkerSession(token) {
  await query("DELETE FROM worker_sessions WHERE token = $1", [hashToken(token)]);
}

/** Revoke every session a worker holds — used when the admin deactivates them. */
export async function destroyWorkerSessions(workerId) {
  await query("DELETE FROM worker_sessions WHERE worker_id = $1", [workerId]);
}

/**
 * Operators: mint a session against an already-VERIFIED enrolment code redemption
 * (routes/auth.js owns the verification). Mirrors createWorkerSession line for line.
 */
export async function createOperatorSession(operatorId) {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + OPERATOR_SESSION_TTL_MS);
  await query("INSERT INTO operator_sessions (token, operator_id, expires_at) VALUES ($1, $2, $3)", [
    hashToken(token),
    operatorId,
    expiresAt,
  ]);
  await query("DELETE FROM operator_sessions WHERE expires_at < now()"); // same opportunistic sweep
  return { token, expiresAt };
}

export async function destroyOperatorSession(token) {
  await query("DELETE FROM operator_sessions WHERE token = $1", [hashToken(token)]);
}

/** Revoke every session an operator holds — used when the admin deactivates them. */
export async function destroyOperatorSessions(operatorId) {
  await query("DELETE FROM operator_sessions WHERE operator_id = $1", [operatorId]);
}

// One cookie builder for both audiences: the flags are the security property and must
// not be able to drift apart between the two call sites.
//   HttpOnly     - JavaScript, and therefore XSS, cannot read it
//   Secure       - never crosses plaintext
//   SameSite=Strict - a third-party page cannot ride it
export function sessionCookie(token, expiresAt, name = SESSION_COOKIE) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return `${name}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearedSessionCookie(name = SESSION_COOKIE) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function readCookie(headers, name = SESSION_COOKIE) {
  const raw = headers.cookie;
  if (typeof raw !== "string") return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Resolve the session cookie to an admin, or 401. Expiry is enforced in SQL.
 *
 * decision-57 §2. `allowedRoles` DEFAULTS to ['admin'], which is what makes every
 * existing route admin-only without a single one of them changing: a `flags`-role
 * session is refused here, before any handler runs, and gets the SAME 401 an
 * unauthenticated caller gets — not a 403, so the scoped account cannot enumerate which
 * admin routes exist. Only the two /admin/flags routes opt into the wider set.
 */
export async function requireAdminSession(headers, allowedRoles = ["admin"]) {
  const token = readCookie(headers);
  // Shape-check before SQL: a garbage cookie is not worth a round trip.
  if (!token || !TOKEN_RE.test(token)) fail(401, "unauthorized");

  const row = await one(
    `SELECT s.admin_id, s.expires_at, a.email, a.role
       FROM sessions s
       JOIN admins a ON a.id = s.admin_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  if (!row) fail(401, "unauthorized");
  if (!allowedRoles.includes(row.role)) fail(401, "unauthorized");
  return { adminId: row.admin_id, email: row.email, role: row.role, token };
}

/**
 * Resolve the worker cookie to a worker, or 401. THE ONLY SOURCE OF WORKER IDENTITY.
 *
 * `AND w.active` is the lockout: eligibility is re-read from the workers row on every
 * single request, so a worker deactivated in the admin panel stops being able to file
 * hours immediately, without anyone having to hunt down their session rows.
 *
 * Returns no email and no apple_sub on purpose — handlers have no use for either, and
 * what is not returned cannot end up in a log line.
 */
export async function requireWorkerSession(headers) {
  const token = readCookie(headers, WORKER_SESSION_COOKIE);
  if (!token || !TOKEN_RE.test(token)) fail(401, "unauthorized");

  const row = await one(
    `SELECT s.worker_id, w.name
       FROM worker_sessions s
       JOIN workers w ON w.id = s.worker_id
      WHERE s.token = $1 AND s.expires_at > now() AND w.active`,
    [hashToken(token)],
  );
  if (!row) fail(401, "unauthorized");
  return { workerId: row.worker_id, name: row.name, token };
}

/**
 * Resolve the operator cookie to an operator, or 401. THE ONLY SOURCE OF OPERATOR
 * IDENTITY — mirrors requireWorkerSession line for line, including the deactivation
 * lockout: `AND o.active` is re-read on every request, so deactivating an operator in the
 * admin panel stops them redeeming anything immediately, with no session row to hunt down.
 *
 * Returns no phone number on purpose — handlers have no use for it, and what is not
 * returned cannot end up in a log line.
 */
export async function requireOperatorSession(headers) {
  const token = readCookie(headers, OPERATOR_SESSION_COOKIE);
  if (!token || !TOKEN_RE.test(token)) fail(401, "unauthorized");

  const row = await one(
    `SELECT s.operator_id, o.name
       FROM operator_sessions s
       JOIN operators o ON o.id = s.operator_id
      WHERE s.token = $1 AND s.expires_at > now() AND o.active`,
    [hashToken(token)],
  );
  if (!row) fail(401, "unauthorized");
  return { operatorId: row.operator_id, name: row.name, token };
}

// ---- login rate limit ------------------------------------------------------------
// A password is stronger than a 6-digit PIN, but online brute force still applies and
// scrypt makes each guess expensive for US too, so an unthrottled login is also a CPU
// DoS. Locks out after LIMIT consecutive failures, doubling up to a 15 min cap.
//
// ponytail: in-memory Map, per process. CEILING: the counter resets on restart and
//   does not span processes, so a determined attacker who can trigger a restart, or a
//   future second app server, sees a weaker limit than this reads like. It also does
//   nothing against an attacker rotating source IPs. Accepted for 5-20 users behind
//   one systemd unit. UPGRADE PATH: a `login_attempts` table keyed on (ip, email) with
//   the same three functions — the call sites below do not change.
const FAIL_LIMIT = 5;

// TIGHTER, FOR ENROLMENT-CODE VERIFICATION ONLY (TASK-330, decision-63 amended).
//
// WHY THIS ROUTE AND NOT /admin/login: a password guess is one account's business, so 5
// tries before the backoff bites is a fair allowance for a human who forgot which of two
// passwords they used. An enrolment-code guess is EVERYONE's business — the space is
// shared, and since decision-63 it is 100_000 values, not 2^40. Per-IP is now the PRIMARY
// defence against a single-source attacker (the global ceiling below is a backstop against
// a DISTRIBUTED one), so it has to bite sooner.
//
// 3, NOT 1 OR 2: a worker reading five digits off a WhatsApp message can fumble one, and a
// second fumble on the retry is a real, observed shape of human. The third consecutive
// failure is where "tired" stops being the likelier explanation. Cost of being wrong is
// small and self-clearing: 30s, and clearLoginFailures wipes the bucket on the first
// success.
//
// SAME EXPONENTIAL SHAPE, deliberately not a new mechanism: 3 failures -> 30s -> 60s -> …
// -> 15 min cap. Long run that bounds ONE address to ~4 guesses per 15 minutes, i.e. below
// one code's whole lifetime — which is the figure lib/enrolment.js's arithmetic now leans
// on for the single-attacker case.
export const ENROL_FAIL_LIMIT = 3;

const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;
const MAX_TRACKED_IPS = 10_000; // memory bound: an IP-rotating flood cannot grow this forever

const attempts = new Map();

/** Throws 429 while the caller is locked out. Call BEFORE touching the database. */
export function checkLoginRate(ip) {
  const rec = attempts.get(ip);
  if (!rec || rec.until <= Date.now()) return;
  const retryAfter = Math.ceil((rec.until - Date.now()) / 1000);
  fail(429, "too_many_attempts", undefined, { "retry-after": String(retryAfter) });
}

/**
 * Charge one failure to a bucket. `failLimit` is how many CONSECUTIVE failures are allowed
 * before the exponential lockout starts — FAIL_LIMIT (5) for passwords, ENROL_FAIL_LIMIT (3)
 * for enrolment-code verification. The backoff shape is the same either way; only the point
 * at which it starts moves.
 */
export function recordLoginFailure(ip, failLimit = FAIL_LIMIT) {
  if (attempts.size >= MAX_TRACKED_IPS) {
    for (const [key, rec] of attempts) if (rec.until <= Date.now()) attempts.delete(key);
    // Still full => every entry is an active lockout. Dropping the oldest would hand a
    // flood the ability to clear real lockouts, so refuse to track more instead.
    if (attempts.size >= MAX_TRACKED_IPS) return;
  }
  const rec = attempts.get(ip) ?? { fails: 0, until: 0 };
  rec.fails += 1;
  if (rec.fails >= failLimit) {
    rec.until = Date.now() + Math.min(BASE_LOCK_MS * 2 ** (rec.fails - failLimit), MAX_LOCK_MS);
  }
  attempts.set(ip, rec);
}

export function clearLoginFailures(ip) {
  attempts.delete(ip);
}

// ---- global enrolment ceiling (decision-26) ---------------------------------------
// The per-IP limiter above does NOTHING against an attacker rotating source addresses,
// and rotation is cheap. That is tolerable for /admin/login, where each guess is one
// account's password. It is NOT tolerable for POST /auth/code, where the search space is
// SHARED: every live enrolment code in the system is a valid answer, so one flood is
// attacking every worker at once (the arithmetic is in lib/enrolment.js).
//
// So this counts ATTEMPTS — not failures, and regardless of who is asking — in a fixed
// one-minute window, and is the hard bound on how fast the shared space can be walked.
//
// A BACKSTOP AGAINST A DISTRIBUTED ATTACKER, NOT THE PRIMARY THROTTLE (TASK-330,
// decision-63 §5 amended). It was briefly 5/min, which made a TOTAL enrolment lockout cost
// one script and five requests a minute: the callers spent this ceiling BEFORE the per-IP
// bucket, so the flooder was refused without ever accruing a penalty of its own, while every
// legitimate worker AND operator got the same 429. The ordering is fixed at the call sites
// (checkLoginRate first, routes/auth.js), the per-IP limiter is tightened to
// ENROL_FAIL_LIMIT above, and this number is re-derived rather than restored:
//
//   per-IP, after the fix   3 failures then 30s doubling to 15 min
//                           => one address BURSTS 3 guesses, then ~4 guesses / 15 min
//   so saturating 15/min    needs >= 5 DISTINCT addresses, sustained, every window.
//                           One address cannot do it, which is the whole point.
//   guesses per 15-min code lifetime, at the ceiling  15 * 15 = 225
//   p(hit vs ONE live code)        225 / 100_000       = 2.25e-3 (~1 in 444)
//   p(hit, 50 codes live, all 15m) 225 * 50 / 100_000  = 0.1125  (~1 in 9)
//
// Same ORDER OF MAGNITUDE as decision-63's original 7.5e-4 / 1-in-27 target (within ~3x),
// and reached only by an attacker who is genuinely distributed AND sustains it for a full
// code lifetime — which now also fires an alert on the very first window it trips. The
// availability side got strictly better in exchange: the cheap single-source lockout is
// gone.
//
// Far above real use, which is what "never binds legitimately" means here: about twenty
// workers enrol once each, ever; the busiest real minute anyone has described is a handful
// of people enrolled together, and one person typing their own code cannot reach 3.
//
// ponytail: fixed window, in memory, per process — same ceiling and the same upgrade
//   path as the per-IP limiter above. A window boundary allows a 2x burst across two
//   adjacent windows (60 guesses in one second), which changes the figures in
//   lib/enrolment.js by one bit and nothing else. A token bucket would smooth it and is
//   not worth the code.
const GLOBAL_LIMIT = 15;
const GLOBAL_WINDOW_MS = 60_000;
let globalWindowStart = 0;
let globalCount = 0;
let globalAlerted = false;

/**
 * Throws 429 once the whole process has spent its per-minute enrolment budget.
 *
 * CALL IT AFTER checkLoginRate(bucket), never before: a caller already locked out on its own
 * bucket must be refused without spending anyone else's budget. That ordering is what stops
 * one address closing the enrolment door for everybody (TASK-330).
 *
 * TRIPPING THIS IS AN INCIDENT, not a tuning observation. With the per-IP limiter bounding a
 * single address to a 3-guess burst, reaching 15 in one minute means five or more distinct
 * addresses are guessing codes at once — which is not a confused worker under any reading. It
 * alerts on the FIRST trip of each window (never once per refused request: a flood would then
 * be a Sentry bill), with no code, no IP and no worker in the event.
 */
export function checkGlobalEnrolmentRate() {
  const now = Date.now();
  if (now - globalWindowStart >= GLOBAL_WINDOW_MS) {
    globalWindowStart = now;
    globalCount = 0;
    globalAlerted = false;
  }
  globalCount += 1;
  if (globalCount > GLOBAL_LIMIT) {
    if (!globalAlerted) {
      globalAlerted = true;
      Sentry.captureMessage("global enrolment ceiling tripped", {
        level: "warning",
        tags: { "ts.enrolment.ceiling": String(GLOBAL_LIMIT) },
      });
    }
    const retryAfter = Math.ceil((globalWindowStart + GLOBAL_WINDOW_MS - now) / 1000);
    fail(429, "too_many_attempts", undefined, { "retry-after": String(Math.max(1, retryAfter)) });
  }
}

// ---- SMS ceilings (decision-48) ---------------------------------------------------
// SEPARATE FROM checkGlobalEnrolmentRate ON PURPOSE, and this is load-bearing rather than
// tidiness: that counter is sized against a SHARED 100_000-value search space (lib/enrolment.js's
// own arithmetic). These are sized against a TELEPHONE BILL and against one phone's
// patience. Sharing them would silently re-tune the enrolment arithmetic, and a stranger
// guessing OTPs must never be able to lock a worker out of typing an enrolment code.
//
// ROLLING MILLISECOND WINDOWS, NEVER A CALENDAR DAY. A calendar day in Vienna is 23 or 25
// hours twice a year, and a spend cap must not breathe with the clocks.
//
// ponytail: in-memory, per process — the same ceiling and the same upgrade path as the two
//   limiters above (a table, same three call sites). CEILING: a restart forgets the spend,
//   so a crash-looping box could in principle send more than 20/h. Accepted: the box is one
//   systemd unit and a crash loop is a bigger problem than an SMS bill.
const MAX_TRACKED_BUCKETS = 10_000;
const rolling = new Map();

/**
 * Spend one unit against every rule for a bucket, or 429. Rules are
 * `[{windowMs, limit}]` and ALL must pass. `retry-after` is computed from the rule that
 * actually bit, so a caller over the daily cap is not told to come back in a minute.
 */
function spendRolling(bucket, rules) {
  const now = Date.now();
  const widest = Math.max(...rules.map((r) => r.windowMs));
  const hits = (rolling.get(bucket) ?? []).filter((t) => now - t < widest);

  for (const rule of rules) {
    const inWindow = hits.filter((t) => now - t < rule.windowMs);
    if (inWindow.length >= rule.limit) {
      rolling.set(bucket, hits); // keep the pruned list; a refusal is not a spend
      const oldest = inWindow[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000));
      fail(429, "too_many_attempts", undefined, { "retry-after": String(retryAfter) });
    }
  }

  if (!rolling.has(bucket) && rolling.size >= MAX_TRACKED_BUCKETS) {
    for (const [key, list] of rolling) if (list.length === 0 || now - list[list.length - 1] > widest) rolling.delete(key);
    // Still full => every bucket is live. Refuse to track more rather than evict, for the
    // same reason recordLoginFailure refuses: eviction would hand a flood the ability to
    // clear real limits.
    if (rolling.size >= MAX_TRACKED_BUCKETS) return;
  }
  hits.push(now);
  rolling.set(bucket, hits);
}

// THE BILL. Process-wide, counted on every route that can cause an outbound message.
const SMS_SPEND_RULES = [
  { windowMs: 60 * 60_000, limit: 20 },
  { windowMs: 24 * 60 * 60_000, limit: 100 },
];

// PER-IP, ON REQUEST (decision-51, amends decision-48 §6). The per-PHONE bucket that used
// to live here is DELETED: its only stated purpose was making an unknown number behave
// like a known one so a 429 could not confirm it was on file, and decision-51 has the
// owner waiving that concern outright — POST /auth/sms/request now answers 404 for a
// number that does not resolve, so there is nothing left for a per-phone bucket to hide.
//
// The window is FIXED IN CODE and the count is ADMIN-TUNABLE via app_settings, exactly
// the pl_margin_baseline_bp idiom (routes/admin.js SETTINGS): one key, one clamp, read on
// every request so POST /admin/settings takes effect with no restart. The key, the
// bounds and the default live in exactly ONE place — here — so routes/admin.js's
// validator imports them rather than retyping 1/20.
export const SMS_OTP_REQUESTS_KEY = "sms_otp_requests_per_5min";
export const SMS_OTP_REQUESTS_DEFAULT = 3;
export const SMS_OTP_REQUESTS_MIN = 1;
export const SMS_OTP_REQUESTS_MAX = 20;
const SMS_REQUEST_WINDOW_MS = 5 * 60_000;

// A VERIFY FLOOD MUST NOT SPEND THE SEND BUDGET. Verifying costs nothing and sends nothing,
// so it gets its own ceiling: sharing SMS_SPEND_RULES would let a stranger exhaust the hour's
// messages by guessing, and a real worker would then be unable to receive one — the same
// species of failure as a misconfigured box locking someone out of the code path.
const OTP_VERIFY_RULES = [{ windowMs: 60_000, limit: 60 }];

/** Throws 429 once the process has spent its rolling SMS budget. Call BEFORE minting. */
export function checkGlobalSmsSpend() {
  spendRolling("sms:spend", SMS_SPEND_RULES);
}

/**
 * Throws 429 once this SOURCE ADDRESS has asked for too many SMS codes in the last 5
 * minutes. N is read from app_settings on EVERY call — never cached at boot — so
 * POST /admin/settings takes effect on the very next request. A row typed in psql, a
 * NULL, a float, or a string that fails to parse ALL clamp to the default: this is a
 * security control and must never resolve to unlimited.
 */
export async function checkSmsRequestRate(ip) {
  const row = await one("SELECT value FROM app_settings WHERE key = $1", [SMS_OTP_REQUESTS_KEY]);
  const n = row ? Number(row.value) : Number.NaN;
  const limit =
    Number.isSafeInteger(n) && n >= SMS_OTP_REQUESTS_MIN && n <= SMS_OTP_REQUESTS_MAX ? n : SMS_OTP_REQUESTS_DEFAULT;
  spendRolling(`smsreq:${ip}`, [{ windowMs: SMS_REQUEST_WINDOW_MS, limit }]);
}

/**
 * Throws 429 once the process has spent its per-minute OTP verification budget.
 *
 * ROLE-BLIND AND CHANNEL-BLIND ON PURPOSE, and shared by all six verify routes (worker and
 * operator, SMS and email): the question it bounds is "how fast may this process be made to
 * check a guess", which has neither a role nor a carrier in it. Splitting it per channel
 * would simply double the ceiling for an attacker who posts to both.
 */
export function checkGlobalOtpVerifyRate() {
  spendRolling("otp:verify", OTP_VERIFY_RULES);
}

// ---- EMAIL (decision-64) ----------------------------------------------------------
//
// OWN BUCKETS, NEVER THE SMS ONES, for the reason SMS_SPEND_RULES gives for not sharing the
// enrolment counter: these are sized against a DIFFERENT bill and a different abuse shape,
// and sharing would mean a flood of email requests could stop a real worker from ever
// receiving a text (or the reverse). The NUMBERS are the SMS ones unchanged — an email is
// cheaper than an SMS, so the SMS ceiling is a safe over-tight bound, and picking a second,
// looser set of figures would need arithmetic nobody has done. ponytail CEILING: email is
// rate-limited as if it cost 4 cents a message. UPGRADE PATH: measured, separate numbers the
// day email volume is real.
const EMAIL_SPEND_RULES = SMS_SPEND_RULES;

/** Throws 429 once the process has spent its rolling email budget. Call BEFORE minting. */
export function checkGlobalEmailSpend() {
  spendRolling("email:spend", EMAIL_SPEND_RULES);
}

/**
 * Throws 429 once this SOURCE ADDRESS has asked for too many email codes in the last 5
 * minutes. Reads the SAME admin-tunable `sms_otp_requests_per_5min` setting `checkSmsRequestRate`
 * reads — one knob for "how many sign-in codes may one source address ask for", because that
 * is one question and a second key would be a second thing to remember to turn down during an
 * incident. The BUCKET is separate (`emailreq:`), so the two channels cannot exhaust each
 * other. Same clamp: a NULL, a float or an unparseable row ALL fall back to the default —
 * this is a security control and must never resolve to unlimited.
 */
export async function checkEmailRequestRate(ip) {
  const row = await one("SELECT value FROM app_settings WHERE key = $1", [SMS_OTP_REQUESTS_KEY]);
  const n = row ? Number(row.value) : Number.NaN;
  const limit =
    Number.isSafeInteger(n) && n >= SMS_OTP_REQUESTS_MIN && n <= SMS_OTP_REQUESTS_MAX ? n : SMS_OTP_REQUESTS_DEFAULT;
  spendRolling(`emailreq:${ip}`, [{ windowMs: SMS_REQUEST_WINDOW_MS, limit }]);
}

/**
 * Test seam only — clears the GLOBAL enrolment ceiling and nothing else, so a case that is
 * exercising the PER-IP bucket can spend more than GLOBAL_LIMIT attempts without the shared
 * ceiling (5/min since decision-63) answering first and hiding what it meant to test.
 */
export function resetGlobalEnrolmentRate() {
  globalWindowStart = 0;
  globalCount = 0;
  globalAlerted = false;
}

/** Test seam only — check-api.js resets between cases. */
export function resetLoginRate() {
  attempts.clear();
  globalWindowStart = 0;
  globalCount = 0;
  globalAlerted = false;
  rolling.clear();
}
