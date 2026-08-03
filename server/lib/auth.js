// Auth. Trust boundary — nothing in here is a convenience wrapper.
//
//   X-App-Key  -> iOS routes. One shared secret baked into the build. A COARSE gate
//                only: it says "this is our app", never "this is Anna". Kept as defence
//                in depth, never as identity.
//   ts_session -> /admin/* routes. Email + password, server-side session (decision-20).
//   ts_worker  -> worker routes. Sign in with Apple, server-side session (decision-22).
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

/** Resolve the session cookie to an admin, or 401. Expiry is enforced in SQL. */
export async function requireAdminSession(headers) {
  const token = readCookie(headers);
  // Shape-check before SQL: a garbage cookie is not worth a round trip.
  if (!token || !TOKEN_RE.test(token)) fail(401, "unauthorized");

  const row = await one(
    `SELECT s.admin_id, s.expires_at, a.email
       FROM sessions s
       JOIN admins a ON a.id = s.admin_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  if (!row) fail(401, "unauthorized");
  return { adminId: row.admin_id, email: row.email, token };
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

export function recordLoginFailure(ip) {
  if (attempts.size >= MAX_TRACKED_IPS) {
    for (const [key, rec] of attempts) if (rec.until <= Date.now()) attempts.delete(key);
    // Still full => every entry is an active lockout. Dropping the oldest would hand a
    // flood the ability to clear real lockouts, so refuse to track more instead.
    if (attempts.size >= MAX_TRACKED_IPS) return;
  }
  const rec = attempts.get(ip) ?? { fails: 0, until: 0 };
  rec.fails += 1;
  if (rec.fails >= FAIL_LIMIT) {
    rec.until = Date.now() + Math.min(BASE_LOCK_MS * 2 ** (rec.fails - FAIL_LIMIT), MAX_LOCK_MS);
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
// 30/min is roughly three orders of magnitude above real use: about twenty workers enrol
// once each, ever. A legitimate worker cannot reach it; a flood hits it in two seconds.
//
// ponytail: fixed window, in memory, per process — same ceiling and the same upgrade
//   path as the per-IP limiter above. A window boundary allows a 2x burst across two
//   adjacent windows (60 guesses in one second), which changes the figures in
//   lib/enrolment.js by one bit and nothing else. A token bucket would smooth it and is
//   not worth the code.
const GLOBAL_LIMIT = 30;
const GLOBAL_WINDOW_MS = 60_000;
let globalWindowStart = 0;
let globalCount = 0;

/** Throws 429 once the whole process has spent its per-minute enrolment budget. */
export function checkGlobalEnrolmentRate() {
  const now = Date.now();
  if (now - globalWindowStart >= GLOBAL_WINDOW_MS) {
    globalWindowStart = now;
    globalCount = 0;
  }
  globalCount += 1;
  if (globalCount > GLOBAL_LIMIT) {
    const retryAfter = Math.ceil((globalWindowStart + GLOBAL_WINDOW_MS - now) / 1000);
    fail(429, "too_many_attempts", undefined, { "retry-after": String(Math.max(1, retryAfter)) });
  }
}

/** Test seam only — check-api.js resets between cases. */
export function resetLoginRate() {
  attempts.clear();
  globalWindowStart = 0;
  globalCount = 0;
}
