// Worker sign-in. Sign in with Apple, server-side eligibility (decision-22).
//
// This route replaces the iOS Settings picker that was bound to @AppStorage("workerId").
// The worker no longer *claims* an identity; they prove one to Apple, and this server
// decides whether that identity is an eligible worker.
//
// APPLE ONLY. No Google, deliberately:
//   - AuthenticationServices is a native framework: no SDK, no client secret in the
//     binary, and the dependency budget stays exactly `pg`.
//   - App Store Guideline 4.8 makes Sign in with Apple MANDATORY as soon as any other
//     third-party sign-in is offered. Apple-only is trivially compliant; adding Google
//     adds an obligation and buys nothing.
//   - Every user is on an iPhone by definition, so they all already have an Apple ID.
//   Google becomes relevant when an Android app exists. Not before.
//
// THE ANDROID APP HAS LANDED, AND THE ANSWER WAS STILL NOT GOOGLE (decision-26). Email is
// the only join key between a provider and a workers row, and Apple hands back
// privaterelay addresses — one human with an old iPhone and a new Android would become two
// worker rows, two sets of shifts and two payslips. So Android enrols with an
// admin-issued code (POST /auth/code below) and terminates in the SAME worker_sessions
// row. Apple stays exactly as it is: it is live, in daily use, and not worth touching.
//
// LOGGING: never log the identity token, the Apple `sub`, or the email. The 403 body
// carries the email because the WORKER has to be able to read it to their manager; that
// is a response to the person who just authenticated as that address, not a log line.
import { verifyIdentityToken } from "../lib/apple.js";
import {
  OPERATOR_SESSION_COOKIE,
  WORKER_SESSION_COOKIE,
  checkGlobalEnrolmentRate,
  checkGlobalOtpVerifyRate,
  checkGlobalSmsSpend,
  checkLoginRate,
  checkOtpRequestRate,
  clearLoginFailures,
  clearedSessionCookie,
  createOperatorSession,
  createWorkerSession,
  destroyOperatorSession,
  destroyWorkerSession,
  hashToken,
  recordLoginFailure,
  safeEqual,
  sessionCookie,
} from "../lib/auth.js";
import { one, query } from "../lib/db.js";
import { DECOY_PRESENTED, DECOY_STORED, normaliseCode } from "../lib/enrolment.js";
import { fail } from "../lib/http.js";
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MINUTES,
  OTP_TTL_MS,
  newOtpCode,
  normaliseOtp,
  renderOtpSms,
  sendSms,
  senderName,
  smsConfigured,
} from "../lib/sms.js";
import * as v from "../lib/validate.js";

/**
 * POST /auth/apple {identity_token, nonce?} -> worker session cookie.
 *
 *   200 {worker: {id, name}, expires_at}   + Set-Cookie: ts_worker
 *   403 {error: "not_eligible", email}     verified Apple user, but not a worker here
 *   401 {error: "invalid_token"}           token failed verification, or Apple is down
 *
 * The 401/403 split is not an information leak: reaching 403 requires a valid,
 * Apple-signed token for OUR bundle id, so the caller already proved they own that
 * Apple ID. Telling them "you are not on the list, and here is the address I saw" is
 * telling them about themselves.
 *
 * Rate-limited on the same limiter as /admin/login. Signature verification is cheap,
 * but a JWKS re-fetch is not, and an unthrottled endpoint that reaches out to Apple is
 * a DoS lever. Reused rather than reimplemented so there is one lockout policy.
 */
async function appleAuth({ body, ip }) {
  checkLoginRate(ip); // 429 before any crypto, network or database work

  const identityToken = typeof body.identity_token === "string" ? body.identity_token : "";
  // The RAW nonce the app put in the ASAuthorizationAppleIDRequest, when it used one.
  // Optional because the native flow does not require it; verified strictly when present.
  const nonce = typeof body.nonce === "string" && body.nonce !== "" ? body.nonce : null;

  let identity;
  try {
    identity = await verifyIdentityToken(identityToken, { nonce });
  } catch {
    // ONE opaque code for every failure mode: bad signature, wrong audience, expired,
    // unknown kid, Apple unreachable. The reason is never the caller's business, and
    // "jwks_unavailable" would tell an attacker exactly when to retry.
    recordLoginFailure(ip);
    fail(401, "invalid_token");
  }

  // Verified. Everything below trusts `identity` and NOTHING else from the request.
  const worker = await resolveWorker(identity);
  if (!worker) {
    // Not a failed authentication — the token was perfectly good — so it does not count
    // toward the lockout. Otherwise the manager adding the address would be racing a
    // 15-minute lock caused by the worker retrying.
    //
    // The email is echoed so the dead-end screen can display it. This is the entire
    // Hide My Email story: Apple may have handed us x@privaterelay.appleid.com, which
    // the admin could not possibly have guessed, so the worker reads what is on screen
    // to their manager, who pastes it into the worker record. No approval queue.
    clearLoginFailures(ip);
    return { status: 403, body: { error: "not_eligible", email: identity.email } };
  }

  clearLoginFailures(ip);
  const { token, expiresAt } = await createWorkerSession(worker.id);
  return {
    status: 200,
    body: { worker: { id: worker.id, name: worker.name }, expires_at: expiresAt.toISOString() },
    headers: { "set-cookie": sessionCookie(token, expiresAt, WORKER_SESSION_COOKIE) },
  };
}

/**
 * Eligibility. Returns the worker row, or null for "not eligible".
 *
 * Order matters:
 *   1. apple_sub hit  -> a returning worker. Authoritative: it survives the admin
 *                        editing the email column, and it is the only thing that keeps
 *                        working after a Hide My Email address is rotated.
 *   2. email hit on an ACTIVE worker -> first login. Bind the sub to that row so step 1
 *                        answers every time after this.
 *   3. otherwise      -> null. There is deliberately no self-enrolment path: a valid
 *                        Apple ID is not a job.
 *
 * INACTIVE IS NEVER ELIGIBLE, including at step 1 with a matching sub. Deactivating a
 * worker in the admin panel has to lock them out, or the button is a lie.
 */
async function resolveWorker({ sub, email }) {
  const bySub = await one("SELECT id, name, active FROM workers WHERE apple_sub = $1", [sub]);
  if (bySub) return bySub.active ? bySub : null;

  if (!email) return null; // Apple withheld the address and we have no sub on file yet

  // Claim the row only if it is still unclaimed. `apple_sub IS NULL` in the WHERE makes
  // this a compare-and-set: two devices signing in at once cannot both bind, and a row
  // already bound to a different Apple ID is never silently re-pointed at a new one.
  const claimed = await one(
    `UPDATE workers SET apple_sub = $1
      WHERE email = $2 AND active AND apple_sub IS NULL
      RETURNING id, name, active`,
    [sub, email],
  );
  return claimed ?? null;
}

/**
 * POST /auth/code {code} -> worker session cookie. IDENTICAL response to /auth/apple.
 *
 * decision-26. The admin issued this code for one named worker; typing it is how an
 * Android phone (or any phone) gets the same worker_sessions row Apple sign-in mints.
 * ONE session system, two enrolment mechanisms — everything downstream still takes
 * worker_id from the session and never from a request body (decision-22).
 *
 * PUBLIC TRUST BOUNDARY. The only thing in front of it is the app key, which is baked
 * into a shipped binary and is therefore not a secret. Treat every caller as hostile.
 *
 *   200 {worker: {id, name}, expires_at}  + Set-Cookie: ts_worker
 *   401 {error: "invalid_code"}           EVERYTHING else
 *   429 {error: "too_many_attempts"}
 *
 * ONE FAILURE RESPONSE, BYTE FOR BYTE. Unknown, wrong shape, expired, already redeemed,
 * revoked, worker deactivated — same status, same body, no field, no message. In
 * particular "merely expired" must not be distinguishable: that would confirm the code
 * was real, which turns a guessing flood into an oracle that maps the live space, and it
 * would tell whoever a code was misdirected to that they were one hour late rather than
 * simply wrong.
 *
 * THE CODE IS NEVER WRITTEN DOWN. Not in a log line, not in an error body, not in the
 * access log (path only, lib/scrub.js), not in a Sentry event (`event.request.data` is
 * deleted outright and any `code` key is dropped, lib/scrub.js). It exists in this
 * function as a local and reaches the database only as a SHA-256.
 */
async function codeAuth({ body, ip }) {
  // Global ceiling FIRST and unconditionally: the search space is shared across every
  // worker holding a live code, so an attacker rotating IPs is attacking all of them at
  // once and the per-IP bucket would never notice (lib/enrolment.js has the arithmetic).
  checkGlobalEnrolmentRate();
  // Own bucket, so a stranger guessing codes cannot lock the director out of
  // /admin/login from a shared office address — same idiom as routes/portal.js.
  const bucket = `enrol:${ip}`;
  checkLoginRate(bucket);

  const code = normaliseCode(body.code); // folds case, strips separators, aliases O/I/L
  const presented = code === null ? null : hashToken(code);

  // Indexed lookup on the hash. This finds a CANDIDATE; it does not authorise anything.
  const row =
    presented === null ? null : (
      await one(
        `SELECT id, name, active, enrolment_code_hash AS stored,
                (enrolment_code_expires_at > now()) AS live
           FROM workers
          WHERE enrolment_code_hash = $1`,
        [presented],
      )
    );

  // Exactly one constant-time comparison, on every path, hit or miss. The decoys are
  // per-process random and mutually unequal, so a missing row and a malformed input cost
  // the same as a real candidate and neither can compare equal by accident.
  const matched = safeEqual(row?.stored ?? DECOY_STORED, presented ?? DECOY_PRESENTED);
  if (!matched || row === null || row.live !== true || row.active !== true) {
    recordLoginFailure(bucket);
    fail(401, "invalid_code");
  }

  // SINGLE USE, DECIDED BY THE DATABASE. One statement: match, clear, stamp. Under READ
  // COMMITTED the second of two racing redemptions blocks on the row lock, re-evaluates
  // its WHERE against the committed row, finds enrolment_code_hash NULL and updates
  // nothing. An `if (already_redeemed)` in this process could not do that — both racers
  // would read "not redeemed" and both would mint a session.
  //
  // The predicate is repeated in full rather than trusting the SELECT above: between the
  // two statements the code can expire, be revoked, or the worker can be deactivated.
  const claimed = await one(
    `UPDATE workers
        SET enrolment_code_hash = NULL,
            enrolment_code_expires_at = NULL,
            enrolment_code_redeemed_at = now()
      WHERE id = $1
        AND enrolment_code_hash = $2
        AND enrolment_code_expires_at > now()
        AND active
      RETURNING id, name`,
    [row.id, presented],
  );
  if (!claimed) {
    recordLoginFailure(bucket);
    fail(401, "invalid_code"); // lost the race, or revoked underneath us. Same answer.
  }

  clearLoginFailures(bucket);
  const { token, expiresAt } = await createWorkerSession(claimed.id);
  return {
    status: 200,
    body: { worker: { id: claimed.id, name: claimed.name }, expires_at: expiresAt.toISOString() },
    headers: { "set-cookie": sessionCookie(token, expiresAt, WORKER_SESSION_COOKIE) },
  };
}

/**
 * POST /auth/logout -> revoke this worker's session.
 * A phone gets handed over, or someone signs in with the wrong Apple ID. Logout has to
 * actually delete the row, not just clear the cookie.
 */
async function logout({ session }) {
  await destroyWorkerSession(session.token);
  return {
    status: 200,
    body: { ok: true },
    headers: { "set-cookie": clearedSessionCookie(WORKER_SESSION_COOKIE) },
  };
}

/** GET /auth/session -> who does the server think I am. Used by the app on launch. */
async function whoami({ session }) {
  return { status: 200, body: { worker: { id: session.workerId, name: session.name } } };
}

/**
 * POST /auth/operator-code {code} -> operator session cookie. Mirrors POST /auth/code
 * (decision-45 §6) against `operators` instead of `workers` — same rate limiting, same
 * decoy-timing discipline, same single-use-decided-by-the-database redemption, same ONE
 * byte-for-byte failure response for every failure mode.
 *
 *   200 {operator: {id, name}, expires_at}  + Set-Cookie: ts_operator
 *   401 {error: "invalid_code"}             EVERYTHING else
 *   429 {error: "too_many_attempts"}
 *
 * `checkGlobalEnrolmentRate()` is the SAME shared module-level counter POST /auth/code
 * already spends against — the search space (every live code, worker or operator) is one
 * space, so the ceiling has to be one ceiling (lib/enrolment.js's own arithmetic; see
 * decision-45's server-side plan for why the existing 30/min headroom still holds).
 * The per-IP bucket is OWN (`enrolop:`, not `enrol:`), so a stranger guessing operator
 * codes cannot lock out a worker enrolling from the same office address, or vice versa.
 */
async function operatorCodeAuth({ body, ip }) {
  checkGlobalEnrolmentRate();
  const bucket = `enrolop:${ip}`;
  checkLoginRate(bucket);

  const code = normaliseCode(body.code);
  const presented = code === null ? null : hashToken(code);

  const row =
    presented === null ? null : (
      await one(
        `SELECT id, name, active, enrolment_code_hash AS stored,
                (enrolment_code_expires_at > now()) AS live
           FROM operators
          WHERE enrolment_code_hash = $1`,
        [presented],
      )
    );

  const matched = safeEqual(row?.stored ?? DECOY_STORED, presented ?? DECOY_PRESENTED);
  if (!matched || row === null || row.live !== true || row.active !== true) {
    recordLoginFailure(bucket);
    fail(401, "invalid_code");
  }

  const claimed = await one(
    `UPDATE operators
        SET enrolment_code_hash = NULL,
            enrolment_code_expires_at = NULL,
            enrolment_code_redeemed_at = now()
      WHERE id = $1
        AND enrolment_code_hash = $2
        AND enrolment_code_expires_at > now()
        AND active
      RETURNING id, name`,
    [row.id, presented],
  );
  if (!claimed) {
    recordLoginFailure(bucket);
    fail(401, "invalid_code");
  }

  clearLoginFailures(bucket);
  const { token, expiresAt } = await createOperatorSession(claimed.id);
  return {
    status: 200,
    body: { operator: { id: claimed.id, name: claimed.name }, expires_at: expiresAt.toISOString() },
    headers: { "set-cookie": sessionCookie(token, expiresAt, OPERATOR_SESSION_COOKIE) },
  };
}

/** POST /auth/operator-logout -> revoke this operator's session. Mirrors POST /auth/logout. */
async function operatorLogout({ session }) {
  await destroyOperatorSession(session.token);
  return {
    status: 200,
    body: { ok: true },
    headers: { "set-cookie": clearedSessionCookie(OPERATOR_SESSION_COOKIE) },
  };
}

/**
 * POST /auth/sms/request {phone} -> 202 {status:"accepted"}
 *
 * decision-48 §6. The THIRD enrolment mechanism onto the SAME worker_sessions table — never
 * a third identity system. Apple (decision-22), the admin-issued code (decision-26) and
 * this all terminate in `createWorkerSession()`, and nothing downstream can tell which door
 * was used because `worker_id` still comes from the session and never from a body.
 *
 *   202 {status:"accepted"}          IDENTICAL for a known and an unknown number
 *   422 {error:"invalid_phone"}      SHAPE ONLY — never existence
 *   429 {error:"too_many_attempts"}
 *   503 {error:"sms_not_configured"}
 *
 * 202 AND NOT `200 {sent:true}`. We are accepting a request, not asserting a delivery: the
 * body says nothing about whether a message went out, so it cannot be a lie for an unknown
 * number and cannot become an enumeration oracle. Every branch below — no registry row, an
 * operator-only row, a deactivated worker, a carrier rejection — returns these same bytes.
 *
 * THE 503 IS DELIBERATE AND IS NOT A LEAK. It discloses "SMS is off on this server", which
 * is a property of the SERVER, not of a person; there is nothing to enumerate. A caller who
 * could not be told would sit waiting for a message that is never coming, which is exactly
 * the silent pretence the owner forbade.
 *
 * THE ENROLMENT CODE IS UNAFFECTED BY EVERY ONE OF THOSE OUTCOMES. This route does not
 * touch workers.enrolment_code_*, does not spend the enrolment limiter's budget
 * (`checkGlobalEnrolmentRate` is NOT called here, and this route's buckets are its own),
 * and cannot make POST /auth/code answer differently.
 */
async function smsRequest({ body }) {
  if (!smsConfigured()) fail(503, "sms_not_configured");

  // Shape, in the same normaliser `POST /admin/operators` uses — phone parsing is not
  // reimplemented here (decision-45 §4, lib/validate.js identityPhone). 422 for a shape
  // failure only; a perfectly-shaped number nobody has still gets 202.
  const phone = v.identityPhone(body.phone, "phone");

  // PER-PHONE FIRST, AND SPENT FOR UNKNOWN NUMBERS TOO. If this only counted real workers,
  // a number that starts answering 429 after three tries would confirm it is on file — the
  // exact oracle the identical 202 exists to close. Bucketing on the normalised string
  // regardless of resolution makes the limiter behave identically for both.
  checkOtpRequestRate(phone);
  // THE BILL, process-wide. Own counter, never the enrolment ceiling: that one is sized
  // against a shared 40-bit search space, this one against a telephone bill.
  checkGlobalSmsSpend();

  // WORKER-ONLY, and the ceiling is stated rather than discovered: a phone_identities row
  // that carries only `operator_id` gets the same 202 and no message. Operators keep
  // /auth/operator-code (decision-45 §6); extending SMS to them is a follow-up decision.
  const target = await one(
    `SELECT w.id, w.name
       FROM phone_identities pi
       JOIN workers w ON w.id = pi.worker_id
      WHERE pi.phone_e164 = $1 AND w.active`,
    [phone],
  );

  if (target) {
    const code = newOtpCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    // THE CODE IS NEVER WRITTEN DOWN, exactly as decision-26 requires of the enrolment
    // code: it exists here as a local, reaches the database only as a SHA-256 (hashToken —
    // the ONE hash helper for every bearer token in this system), and lib/scrub.js already
    // drops a bare `code` key from every Sentry event.
    await query("INSERT INTO otp_challenges (phone_e164, code_hash, expires_at) VALUES ($1, $2, $3)", [
      phone,
      hashToken(code),
      expiresAt,
    ]);
    // Opportunistic sweep, the same idiom createWorkerSession uses for expired sessions:
    // cheaper than owning another systemd timer for it.
    await query("DELETE FROM otp_challenges WHERE expires_at < now() - interval '1 day'");

    // Fire it. The RESULT DOES NOT CHANGE THE RESPONSE — a carrier rejection must look
    // exactly like an unknown number from the outside, or the failure itself becomes the
    // oracle. It is recorded instead, in the append-only log, where the admin can see it.
    const result = await sendSms(phone, renderOtpSms({ name: senderName(), code, ttlMinutes: OTP_TTL_MINUTES }));
    await query(
      `INSERT INTO sms_deliveries (kind, worker_id, phone_e164, status, reason, provider_sid, provider_code)
       VALUES ('otp', $1, $2, $3, $4, $5, $6)`,
      [
        target.id,
        phone,
        result.status,
        result.reason ?? null,
        result.provider_sid ?? null,
        result.provider_code ?? null,
      ],
    );
  }

  return { status: 202, body: { status: "accepted" } };
}

/**
 * POST /auth/sms/verify {phone, code} -> worker session cookie.
 *
 * THE 200 BODY AND THE COOKIE ARE BYTE-IDENTICAL TO POST /auth/code's, because it is the
 * same `createWorkerSession()` call, the same `worker_sessions` row, the same `ts_worker`
 * cookie and the same 90-day TTL.
 *
 *   200 {worker:{id,name}, expires_at}  + Set-Cookie: ts_worker
 *   401 {error:"invalid_code"}          EVERY other outcome, byte for byte
 *   429 {error:"too_many_attempts"}
 *   503 {error:"sms_not_configured"}
 *
 * ONE FAILURE RESPONSE, BYTE FOR BYTE, exactly as codeAuth above: unknown number, wrong
 * shape, expired, already used, attempts exhausted, worker deactivated — same status, same
 * body, no field, no message. "Merely expired" must not be distinguishable: that would
 * confirm the challenge was real.
 */
async function smsVerify({ body, ip }) {
  if (!smsConfigured()) fail(503, "sms_not_configured");

  // A VERIFY FLOOD MUST NOT SPEND THE SEND BUDGET (lib/auth.js OTP_VERIFY_RULES): guessing
  // costs nothing and sends nothing, and if it drank from the same bucket a stranger could
  // stop a real worker from ever receiving a code.
  checkGlobalOtpVerifyRate();
  // OWN per-IP bucket — `smsotp:`, never `enrol:` — so a stranger guessing OTPs cannot
  // lock a worker out of typing an enrolment code from the same office address. Same idiom
  // as `enrolop:` in operatorCodeAuth.
  const bucket = `smsotp:${ip}`;
  checkLoginRate(bucket);

  // Shape only, and it must NOT 422 here: on this route a malformed number and a wrong code
  // have to be indistinguishable, or the shape check becomes a free existence probe.
  let phone = null;
  try {
    phone = v.identityPhone(body.phone, "phone");
  } catch {
    phone = null;
  }
  const code = normaliseOtp(body.code);
  const presented = code === null ? null : hashToken(code);

  const row =
    phone === null || presented === null ? null : (
      await one(
        `SELECT c.id, c.code_hash AS stored, w.id AS worker_id, w.name
           FROM otp_challenges c
           JOIN phone_identities pi ON pi.phone_e164 = c.phone_e164
           JOIN workers w ON w.id = pi.worker_id
          WHERE c.phone_e164 = $1
            AND c.consumed_at IS NULL
            AND c.expires_at > now()
            AND c.attempts < $2
            AND w.active
          ORDER BY c.created_at DESC
          LIMIT 1`,
        [phone, OTP_MAX_ATTEMPTS],
      )
    );

  // EXACTLY ONE CONSTANT-TIME COMPARISON, ON EVERY PATH, hit or miss — the same decoys
  // codeAuth uses, per-process random and mutually unequal, so a missing challenge and a
  // malformed input cost what a real candidate costs.
  const matched = safeEqual(row?.stored ?? DECOY_STORED, presented ?? DECOY_PRESENTED);
  if (!matched || row === null) {
    // A WRONG ANSWER BURNS AN ATTEMPT ON THE LIVE CHALLENGE. Without this the 5-attempt cap
    // in the arithmetic (lib/sms.js) would be fiction and the only bound would be the rate
    // limiter. Best-effort: a failure to record must not change the answer below.
    if (phone !== null) {
      await query(
        `UPDATE otp_challenges SET attempts = attempts + 1
          WHERE id = (SELECT id FROM otp_challenges
                       WHERE phone_e164 = $1 AND consumed_at IS NULL AND expires_at > now()
                       ORDER BY created_at DESC LIMIT 1)`,
        [phone],
      ).catch(() => {});
    }
    recordLoginFailure(bucket);
    fail(401, "invalid_code");
  }

  // SINGLE USE, DECIDED BY THE DATABASE. One statement: match, stamp. Under READ COMMITTED
  // the second of two racing verifications blocks on the row lock, re-evaluates its WHERE
  // against the committed row, finds consumed_at set and updates nothing — an
  // `if (already_consumed)` in this process would let both racers mint a session.
  // The predicate is repeated in full rather than trusting the SELECT above: between the
  // two statements the challenge can expire or be consumed.
  const claimed = await one(
    `UPDATE otp_challenges SET consumed_at = now()
      WHERE id = $1 AND code_hash = $2 AND expires_at > now()
        AND consumed_at IS NULL AND attempts < $3
      RETURNING id`,
    [row.id, presented, OTP_MAX_ATTEMPTS],
  );
  if (!claimed) {
    recordLoginFailure(bucket);
    fail(401, "invalid_code"); // lost the race. Same answer.
  }

  clearLoginFailures(bucket);
  const { token, expiresAt } = await createWorkerSession(row.worker_id);
  return {
    status: 200,
    body: { worker: { id: row.worker_id, name: row.name }, expires_at: expiresAt.toISOString() },
    headers: { "set-cookie": sessionCookie(token, expiresAt, WORKER_SESSION_COOKIE) },
  };
}

export const authRoutes = [
  // `auth: "app"` and not `null`: the X-App-Key gate stays in front of sign-in as
  // defence in depth, so this endpoint is not reachable from a browser or curl.
  { method: "POST", path: "/auth/apple", auth: "app", handler: appleAuth },
  // Same coarse app-key gate as /auth/apple, and for the same reason: it is not identity,
  // it just keeps the endpoint off the open web for a browser or a stray curl.
  { method: "POST", path: "/auth/code", auth: "app", handler: codeAuth },
  { method: "POST", path: "/auth/logout", auth: "worker", handler: logout },
  { method: "GET", path: "/auth/session", auth: "worker", handler: whoami },
  // decision-45 §6/§7. Not `POST /operator/workers` — that route is BLOCKED, see
  // routes/admin.js (§8, TASK-212 AC#5).
  { method: "POST", path: "/auth/operator-code", auth: "app", handler: operatorCodeAuth },
  { method: "POST", path: "/auth/operator-logout", auth: "operator", handler: operatorLogout },
  // decision-48 §6. Same coarse app-key gate as every other sign-in door, and for the same
  // reason. ADDED BESIDE /auth/code, NEVER INSTEAD OF IT: the line above stays exactly as
  // it is, and no Android build offers this until a server actually answers something other
  // than 503 — a phone that offers "Send me an SMS" against a 503 is the silent pretence
  // the owner forbade.
  { method: "POST", path: "/auth/sms/request", auth: "app", handler: smsRequest },
  { method: "POST", path: "/auth/sms/verify", auth: "app", handler: smsVerify },
];
