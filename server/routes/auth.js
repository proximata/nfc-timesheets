// Worker sign-in. Sign in with Apple, server-side eligibility (decision-22).
//
// APPLE SIGN-IN IS DEPRECATED IN WORDS ONLY (decision-50). No new iOS build offers the
// SignInWithAppleButton — the screen now composes SMS OTP and the admin-issued enrolment
// code, unconditionally, no capability gate. `appleAuth` below, lib/apple.js and
// workers.apple_sub all STAY: TestFlight builds already on workers' phones still call
// POST /auth/apple on every launch, and deleting any of it strands them at a sign-in screen
// until they update. decision-22's STRUCTURAL half — worker_id comes from the session, never
// a request body — outlives the mechanism and is untouched by this note.
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
  ENROL_FAIL_LIMIT,
  OPERATOR_SESSION_COOKIE,
  WORKER_SESSION_COOKIE,
  checkEmailRequestRate,
  checkGlobalEmailSpend,
  checkGlobalEnrolmentRate,
  checkGlobalOtpVerifyRate,
  checkGlobalSmsSpend,
  checkLoginRate,
  checkSmsRequestRate,
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
import { emailConfigured, renderOtpEmail, sendEmail } from "../lib/email.js";
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
  // PER-IP FIRST, GLOBAL SECOND (TASK-330). The order used to be the other way round, with a
  // comment arguing that the shared search space made the global ceiling the more important
  // one. The confidentiality half of that was right; the AVAILABILITY half was the bug. fail()
  // throws, so a request refused by the global ceiling never reached checkLoginRate and never
  // charged its own bucket: one address posting junk at the ceiling rate held the shared
  // budget at zero for every legitimate worker AND operator, indefinitely, for free.
  //
  // Charging the caller's OWN bucket first means a flooder locks itself out (3 failures, then
  // the doubling backoff) and stops spending anyone else's budget, and the ceiling is left to
  // do the one job per-IP limiting genuinely cannot: bound a MANY-ADDRESS attacker.
  //
  // Own bucket, so a stranger guessing codes cannot lock the director out of
  // /admin/login from a shared office address — same idiom as routes/portal.js.
  const bucket = `enrol:${ip}`;
  checkLoginRate(bucket);
  checkGlobalEnrolmentRate();

  const code = normaliseCode(body.code); // strips separators; nothing left to alias (decision-63)
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
    recordLoginFailure(bucket, ENROL_FAIL_LIMIT); // TASK-330: 3, not 5 — shared 100_000-value space
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
    recordLoginFailure(bucket, ENROL_FAIL_LIMIT); // TASK-330: 3, not 5 — shared 100_000-value space
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
 * A second gate on top of `smsConfigured()`, read from the `feature_flags` row a UAT pass
 * asked for (2026-08-27): Twilio can be fully wired and still not be OFFERED, because the
 * owner wants the door shut for now without touching /etc/nfc/env. Same idiom as `GET
 * /flags` (app.js) — a name and a boolean, no cache, evaluated per request so a toggle from
 * the admin Flags page is believed by the very next call. Seeded false by migration 016 (a
 * missing row reads as OFF, never as "ask Twilio instead" — `?? false`, not `?? true`).
 */
async function smsLoginEnabled() {
  const row = await one("SELECT enabled FROM feature_flags WHERE name = $1", ["sms_login"]);
  return row?.enabled === true;
}

/**
 * GET /auth/capabilities -> what THIS BUILD may offer, before any session exists.
 *
 * decision-48 §6.6. THE APP'S ONE PUBLIC CAPABILITY READ: a phone that has never enrolled,
 * or whose session just expired, is exactly the phone that needs to know whether the SMS
 * door is worth drawing BEFORE it draws it — a control that answers 503 the moment it is
 * pressed is the silent pretence the owner forbade, just moved one tap later. This is not a
 * second config surface: it is `smsConfigured()` (lib/sms.js), the SAME derived predicate
 * GET /admin/sms-status and every SMS route already gate on, read again with nothing else
 * attached.
 *
 *   200 {sms: boolean}
 *
 * NAMES NOTHING. No `missing[]`, no `sender_kind` — that detail is for the person who can
 * fix it (GET /admin/sms-status, admin-auth only); this answers before any session exists,
 * to anyone holding the app key `strings` recovers from any installed APK (decision-24's own
 * discipline: the app key is not a secret, and this route tells it nothing a secret would
 * guard).
 *
 * `auth: "app"`, exactly like GET /app/version: no worker or operator session required, so
 * a phone that cannot sign in yet can still ask. `smsConfigured()` is evaluated PER REQUEST
 * (never cached at boot, lib/sms.js), so flipping the four TWILIO_* vars in /etc/nfc/env and
 * restarting is believed by the very next launch — no deploy, no version gate.
 *
 * ANDROID SHIPS NOTHING BEHIND THIS ROUTE UNTIL THIS ITERATION: it exists so the sign-in
 * screen can decide whether to compose the SMS section at all, rather than composing a
 * button that would answer 503 the moment it is pressed.
 */
async function capabilities() {
  return {
    status: 200,
    body: {
      sms: smsConfigured() && (await smsLoginEnabled()),
      // decision-64 §5, ADDITIVE: a field beside `sms`, never a replacement for it, and TRUE
      // ONLY when a provider is configured AND the flag is on — the identical two-gate rule.
      // It reads FALSE on every box today for BOTH reasons (no RESEND_API_KEY anywhere, and
      // migration 021 seeds `email_login` disabled), so no client's behaviour changes.
      email: emailConfigured() && (await emailLoginEnabled()),
    },
  };
}

/**
 * The `email_login` flag (decision-64 §2, migration 021) — the exact shape of
 * `smsLoginEnabled()` above, against its own row. Read PER REQUEST, never cached, so a toggle
 * on the admin Flags page is believed by the very next call. A MISSING ROW READS AS OFF
 * (`?? false`, never `?? true`): a box whose migration has not run must not offer a door.
 */
async function emailLoginEnabled() {
  const row = await one("SELECT enabled FROM feature_flags WHERE name = $1", ["email_login"]);
  return row?.enabled === true;
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
 * decision-45's server-side plan; the ceiling itself is 15/min since TASK-330).
 * The per-IP bucket is OWN (`enrolop:`, not `enrol:`), so a stranger guessing operator
 * codes cannot lock out a worker enrolling from the same office address, or vice versa.
 *
 * SAME ORDER AS codeAuth, and for the same reason: per-IP first, global second (TASK-330).
 */
async function operatorCodeAuth({ body, ip }) {
  const bucket = `enrolop:${ip}`;
  checkLoginRate(bucket);
  checkGlobalEnrolmentRate();

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
    recordLoginFailure(bucket, ENROL_FAIL_LIMIT); // TASK-330: 3, not 5 — shared 100_000-value space
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
    recordLoginFailure(bucket, ENROL_FAIL_LIMIT); // TASK-330: 3, not 5 — shared 100_000-value space
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
 * POST /auth/sms/request {phone} -> 202 {status:"accepted"}, or 404 for a number this
 * server does not recognise.
 *
 * decision-48 §6 as AMENDED by decision-51. This is the THIRD enrolment mechanism onto the
 * SAME worker_sessions table — never a third identity system. Apple (decision-22, retired
 * from iOS by decision-50 but still live for the TestFlight builds already on workers'
 * phones), the admin-issued code (decision-26) and this all terminate in
 * `createWorkerSession()`, and nothing downstream can tell which door was used because
 * `worker_id` still comes from the session and never from a body.
 *
 *   202 {status:"accepted"}          resolves to an ACTIVE worker; a message was attempted
 *   404 {error:"unknown_phone"}      no such number, an operator-only row, or a DEACTIVATED
 *                                    worker — the three collapse to one answer on purpose
 *   422 {error:"invalid_phone"}      SHAPE ONLY — never existence
 *   429 {error:"too_many_attempts"}
 *   503 {error:"sms_not_configured"}
 *
 * THIS USED TO BE A BYTE-IDENTICAL 202 FOR EVERY NUMBER, AND THAT CLAIM IS NOW FALSE.
 * decision-51 records the owner explicitly waiving number-enumeration as a threat for this
 * one-customer, low-tens-of-workers deployment: a worker who is not on file is told so, in
 * words, at the moment they ask, instead of waiting indefinitely for a text that is never
 * coming. See decision-51 for the full argument and its named costs.
 *
 * 202 AND NOT `200 {sent:true}` for the case that DOES send: it is still an acceptance, not
 * a delivery receipt — the body says nothing about whether the carrier actually delivered,
 * only that this server tried. A carrier rejection is recorded in sms_deliveries and never
 * changes this response (see below).
 *
 * THE 503 IS DELIBERATE AND IS NOT A LEAK. It discloses "SMS is off on this server", which
 * is a property of the SERVER, not of a person; there is nothing to enumerate. A caller who
 * could not be told would sit waiting for a message that is never coming, which is exactly
 * the silent pretence the owner forbade.
 *
 * THE ENROLMENT CODE IS UNAFFECTED BY EVERY ONE OF THESE OUTCOMES. This route does not
 * touch workers.enrolment_code_*, does not spend the enrolment limiter's budget
 * (`checkGlobalEnrolmentRate` is NOT called here, and this route's buckets are its own),
 * and cannot make POST /auth/code answer differently.
 */
async function smsRequest({ body, ip }) {
  if (!smsConfigured() || !(await smsLoginEnabled())) fail(503, "sms_not_configured");

  // Shape, in the same normaliser `POST /admin/operators` uses — phone parsing is not
  // reimplemented here (decision-45 §4, lib/validate.js identityPhone). 422 for a shape
  // failure only; a perfectly-shaped number nobody has still gets past this check.
  const phone = v.identityPhone(body.phone, "phone");

  // PER-SOURCE-ADDRESS, AND SPENT BEFORE THE DATABASE IS TOUCHED (decision-51 §6): a
  // refusal must be cheaper than the work it refuses, including for a number that turns
  // out to be unknown. The per-PHONE bucket this used to be is gone — its only purpose was
  // hiding whether a number was on file, and decision-51 has the owner waiving that.
  await checkSmsRequestRate(ip);
  // THE BILL, process-wide. Own counter, never the enrolment ceiling: that one is sized
  // against a shared 100_000-value search space, this one against a telephone bill. NOT retuned
  // or reordered by decision-51 — an unregistered number still spends one unit of this,
  // named as a cost in that record.
  checkGlobalSmsSpend();

  // WORKER-ONLY: a phone_identities row that carries only `operator_id`, and a DEACTIVATED
  // worker's row, both fall through to the same 404 below as a genuinely unknown number.
  // Operators keep /auth/operator-code (decision-45 §6); extending SMS to them is a
  // follow-up decision.
  const target = await one(
    `SELECT w.id, w.name
       FROM phone_identities pi
       JOIN workers w ON w.id = pi.worker_id
      WHERE pi.phone_e164 = $1 AND w.active`,
    [phone],
  );

  if (!target) fail(404, "unknown_phone");

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

  // Fire it. The RESULT DOES NOT CHANGE THE RESPONSE — a carrier rejection is recorded
  // instead, in the append-only log, where the admin can see it, and the worker is simply
  // told (by the 202) that a request was accepted.
  const result = await sendSms(phone, renderOtpSms({ name: senderName(), code, ttlMinutes: OTP_TTL_MINUTES }));
  await query(
    `INSERT INTO sms_deliveries (kind, worker_id, phone_e164, status, reason, provider_sid, provider_code)
     VALUES ('otp', $1, $2, $3, $4, $5, $6)`,
    [target.id, phone, result.status, result.reason ?? null, result.provider_sid ?? null, result.provider_code ?? null],
  );

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
  if (!smsConfigured() || !(await smsLoginEnabled())) fail(503, "sms_not_configured");

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

/**
 * POST /auth/operator-sms/request {phone} -> 202 {status:"accepted"}, or 404 for a number
 * this server does not recognise as an ACTIVE OPERATOR.
 *
 * decision-54 §5. Mirrors `smsRequest` above clause for clause — same shape check, same
 * three limiters, same `otp_challenges` row, same append-only `sms_deliveries` record, same
 * decision-51 disclosure posture. ONE thing differs, and it is the whole route: eligibility
 * JOINs `phone_identities.operator_id -> operators` instead of `.worker_id -> workers`.
 *
 * THE CHALLENGE TABLE IS PHONE-KEYED, NOT ROLE-KEYED, and that is deliberate (012). A number
 * is ONE identity across workers and operators (007, decision-45), so a challenge minted here
 * is the same kind of row `POST /auth/sms/request` mints and needs no `role` column: what
 * decides which session a code can buy is the VERIFY route's own JOIN, not a flag on the
 * challenge. Nothing here can mint a worker session and nothing in `smsVerify` can mint an
 * operator one.
 *
 * NO MIGRATION WAS NEEDED FOR THE DELIVERY LOG EITHER: `sms_deliveries.operator_id` has
 * existed since 011, nullable, ON DELETE SET NULL, sitting beside `worker_id` for exactly
 * this day. `kind` stays 'otp' — it names WHAT was sent, not WHO to.
 *
 *   202 {status:"accepted"}          resolves to an ACTIVE operator; a message was attempted
 *   404 {error:"unknown_phone"}      no such number, a worker-only row, or a DEACTIVATED
 *                                    operator — the three collapse to one answer on purpose
 *   422 {error:"invalid_phone"}      SHAPE ONLY — never existence
 *   429 {error:"too_many_attempts"}
 *   503 {error:"sms_not_configured"}
 *
 * THE OPERATOR ENROLMENT CODE IS UNAFFECTED, exactly as `smsRequest` leaves the worker's
 * alone: this route never touches operators.enrolment_code_*, never spends
 * `checkGlobalEnrolmentRate`'s budget, and cannot make POST /auth/operator-code answer
 * differently. decision-45 §6's code door stays open beside this one, not behind it.
 */
async function operatorSmsRequest({ body, ip }) {
  if (!smsConfigured() || !(await smsLoginEnabled())) fail(503, "sms_not_configured");

  const phone = v.identityPhone(body.phone, "phone");

  // The IP and GLOBAL buckets are ROLE-BLIND ON PURPOSE and are the SAME ones smsRequest
  // spends: `checkSmsRequestRate` bounds how fast one source address can make this server
  // send, and `checkGlobalSmsSpend` bounds the telephone bill — neither question has a role
  // in it, and splitting them would double both ceilings for an attacker who simply posts to
  // both routes. Spent BEFORE the database is touched (decision-51 §6): a refusal must be
  // cheaper than the work it refuses.
  await checkSmsRequestRate(ip);
  checkGlobalSmsSpend();

  // OPERATOR-ONLY: a phone_identities row carrying only `worker_id`, and a DEACTIVATED
  // operator's row, both fall through to the same 404 as a genuinely unknown number.
  const target = await one(
    `SELECT o.id, o.name
       FROM phone_identities pi
       JOIN operators o ON o.id = pi.operator_id
      WHERE pi.phone_e164 = $1 AND o.active`,
    [phone],
  );

  if (!target) fail(404, "unknown_phone");

  const code = newOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  // THE CODE IS NEVER WRITTEN DOWN: a local here, a SHA-256 in the database, dropped from
  // every Sentry event by lib/scrub.js.
  await query("INSERT INTO otp_challenges (phone_e164, code_hash, expires_at) VALUES ($1, $2, $3)", [
    phone,
    hashToken(code),
    expiresAt,
  ]);
  await query("DELETE FROM otp_challenges WHERE expires_at < now() - interval '1 day'");

  // Same SMS BODY as the worker's (`renderOtpSms`, unchanged): the message says "here is
  // your code", and which app the person then opens is not the carrier's business. The
  // result does not change the response — a rejection is recorded, not reported.
  const result = await sendSms(phone, renderOtpSms({ name: senderName(), code, ttlMinutes: OTP_TTL_MINUTES }));
  await query(
    `INSERT INTO sms_deliveries (kind, operator_id, phone_e164, status, reason, provider_sid, provider_code)
     VALUES ('otp', $1, $2, $3, $4, $5, $6)`,
    [target.id, phone, result.status, result.reason ?? null, result.provider_sid ?? null, result.provider_code ?? null],
  );

  return { status: 202, body: { status: "accepted" } };
}

/**
 * POST /auth/operator-sms/verify {phone, code} -> operator session cookie.
 *
 * decision-54 §5. Mirrors `smsVerify` above clause for clause, against `operators`: same
 * newest-live-challenge lookup, same ONE constant-time comparison on every path, same
 * burn-an-attempt on a wrong answer, same single-use-decided-by-the-database redemption. It
 * ends in `createOperatorSession()` and the `ts_operator` cookie, so the 200 body and the
 * cookie are byte-identical to POST /auth/operator-code's — SMS is a fourth DOOR, never a
 * second operator identity system.
 *
 *   200 {operator:{id,name}, expires_at}  + Set-Cookie: ts_operator
 *   401 {error:"invalid_code"}            EVERY other outcome, byte for byte
 *   429 {error:"too_many_attempts"}
 *   503 {error:"sms_not_configured"}
 *
 * A WORKER'S LIVE CHALLENGE CANNOT BE REDEEMED HERE and vice versa: the challenge row is
 * phone-keyed, but the JOIN below demands an ACTIVE OPERATOR for that number, so a code
 * texted to a worker-only number fails this route with the same opaque 401 a wrong guess
 * gets. A number that is BOTH (one human, one claim — impossible today: phone_identities
 * pins one row per number) would be a decision, not an accident.
 */
async function operatorSmsVerify({ body, ip }) {
  if (!smsConfigured() || !(await smsLoginEnabled())) fail(503, "sms_not_configured");

  // A VERIFY FLOOD MUST NOT SPEND THE SEND BUDGET — same shared, role-blind verify ceiling
  // smsVerify spends: guessing costs nothing and sends nothing.
  checkGlobalOtpVerifyRate();
  // OWN per-IP bucket — `smsotpop:`, never `smsotp:` and never `enrolop:` — for the reason
  // decision-45 §6 gave for `enrolop:` and decision-54 §5 repeats: a stranger guessing one
  // role's codes must not lock the other role out from the same office address.
  const bucket = `smsotpop:${ip}`;
  checkLoginRate(bucket);

  // Shape only, and it must NOT 422 here: a malformed number and a wrong code have to be
  // indistinguishable, or the shape check becomes a free existence probe.
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
        `SELECT c.id, c.code_hash AS stored, o.id AS operator_id, o.name
           FROM otp_challenges c
           JOIN phone_identities pi ON pi.phone_e164 = c.phone_e164
           JOIN operators o ON o.id = pi.operator_id
          WHERE c.phone_e164 = $1
            AND c.consumed_at IS NULL
            AND c.expires_at > now()
            AND c.attempts < $2
            AND o.active
          ORDER BY c.created_at DESC
          LIMIT 1`,
        [phone, OTP_MAX_ATTEMPTS],
      )
    );

  const matched = safeEqual(row?.stored ?? DECOY_STORED, presented ?? DECOY_PRESENTED);
  if (!matched || row === null) {
    // A WRONG ANSWER BURNS AN ATTEMPT ON THE LIVE CHALLENGE, or the 5-attempt cap is fiction.
    // Best-effort: a failure to record must not change the answer below.
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

  // SINGLE USE, DECIDED BY THE DATABASE. The predicate is repeated in full rather than
  // trusting the SELECT above: between the two statements the challenge can expire or be
  // consumed, and the loser of a race must update nothing.
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
  const { token, expiresAt } = await createOperatorSession(row.operator_id);
  return {
    status: 200,
    body: { operator: { id: row.operator_id, name: row.name }, expires_at: expiresAt.toISOString() },
    headers: { "set-cookie": sessionCookie(token, expiresAt, OPERATOR_SESSION_COOKIE) },
  };
}

// ===================================================================================
// EMAIL — THE THIRD DOOR (decision-64). Four routes, and every one of them is the SMS route
// above with `email` where `phone` was.
//
// WHAT IS DELIBERATELY IDENTICAL, clause for clause, because decision-64 §3 says "mirroring
// the SMS OTP shape exactly" and every one of these was argued for once already:
//   * the TWO-GATE 503 (`emailConfigured()` AND the `email_login` flag), before any work;
//   * decision-51's disclosure posture — 404 for an address this server does not recognise,
//     422 for a SHAPE failure on /request, and NEVER a 422 on /verify (there a malformed
//     address and a wrong code must be indistinguishable, or the shape check becomes a free
//     existence probe);
//   * three limiters on /request (per-IP, process-wide spend, spent BEFORE the database is
//     touched — a refusal must be cheaper than the work it refuses) and two on /verify
//     (guessing must never spend the SEND budget);
//   * EXACTLY ONE constant-time comparison on every path, hit or miss, against the same
//     per-process decoys;
//   * a wrong answer BURNS AN ATTEMPT on the live challenge, or the 5-attempt cap is fiction;
//   * single use DECIDED BY THE DATABASE — one UPDATE whose predicate is repeated in full,
//     so the loser of a race updates nothing;
//   * the code is NEVER WRITTEN DOWN: a local here, a SHA-256 in the database, dropped from
//     every Sentry event by lib/scrub.js.
//
// WHAT DIFFERS, and it is only this: the registry is `email_identities` (020) and the
// challenge table is `email_challenges` (020). There is NO delivery log — 011's
// sms_deliveries has no email counterpart and decision-64 does not ask for one, so a send
// result is recorded nowhere and, exactly as on the SMS routes, NEVER changes the response.
//
// THE ENROLMENT CODE AND THE SMS DOOR ARE UNAFFECTED BY ALL FOUR. Nothing here touches
// workers/operators.enrolment_code_*, nothing spends `checkGlobalEnrolmentRate` or
// `checkGlobalSmsSpend`, and every bucket below is its own.
// ===================================================================================

/**
 * POST /auth/email/request {email} -> 202 {status:"accepted"}, or 404 for an address this
 * server does not recognise as an ACTIVE WORKER.
 *
 *   202 {status:"accepted"}          resolves to an ACTIVE worker; a message was attempted
 *   404 {error:"unknown_email"}      no such address, an operator-only row, or a DEACTIVATED
 *                                    worker — the three collapse to one answer on purpose
 *   422 {error:"invalid_email"}      SHAPE ONLY — never existence
 *   429 {error:"too_many_attempts"}
 *   503 {error:"email_not_configured"}
 */
async function emailRequest({ body, ip }) {
  if (!emailConfigured() || !(await emailLoginEnabled())) fail(503, "email_not_configured");

  // Shape, in the SAME normaliser the admin claim route uses (lib/validate.js identityEmail)
  // — lower-cased, so what is typed here and what an admin stored agree byte for byte.
  const email = v.identityEmail(body.email, "email");

  // Spent BEFORE the database is touched (decision-51 §6): a refusal must be cheaper than the
  // work it refuses, including for an address that turns out to be unknown.
  await checkEmailRequestRate(ip);
  checkGlobalEmailSpend();

  // WORKER-ONLY: an email_identities row that carries only `operator_id`, and a DEACTIVATED
  // worker's row, both fall through to the same 404 as a genuinely unknown address.
  const target = await one(
    `SELECT w.id, w.name
       FROM email_identities ei
       JOIN workers w ON w.id = ei.worker_id
      WHERE ei.email = $1 AND w.active`,
    [email],
  );
  if (!target) fail(404, "unknown_email");

  await mintAndSendEmailOtp(email);
  return { status: 202, body: { status: "accepted" } };
}

/**
 * POST /auth/operator-email/request {email} -> the same, against `operators`.
 * Mirrors `operatorSmsRequest`'s relationship to `smsRequest` exactly: ONE thing differs and
 * it is the JOIN. The limiters are the SAME role-blind buckets `emailRequest` spends, for the
 * reason `operatorSmsRequest` states: neither "how fast may one address make us send" nor
 * "what is the bill" has a role in it, and splitting them would double both ceilings for an
 * attacker who simply posts to both routes.
 */
async function operatorEmailRequest({ body, ip }) {
  if (!emailConfigured() || !(await emailLoginEnabled())) fail(503, "email_not_configured");

  const email = v.identityEmail(body.email, "email");

  await checkEmailRequestRate(ip);
  checkGlobalEmailSpend();

  const target = await one(
    `SELECT o.id, o.name
       FROM email_identities ei
       JOIN operators o ON o.id = ei.operator_id
      WHERE ei.email = $1 AND o.active`,
    [email],
  );
  if (!target) fail(404, "unknown_email");

  await mintAndSendEmailOtp(email);
  return { status: 202, body: { status: "accepted" } };
}

/**
 * Mint one challenge for an address and attempt one delivery. EXTRACTED, unlike the SMS pair
 * which repeats itself, for the reason decision-48 §5.1 gives for extracting
 * `mintEnrolmentCode`: the worker route and the operator route must never be able to mint a
 * DIFFERENT credential from one another. The SMS pair could not share this because each of
 * them writes a different `sms_deliveries` column; there is no delivery log here, so the two
 * bodies really are identical and one copy is the honest number.
 *
 * THE RESULT DOES NOT CHANGE THE RESPONSE — verbatim the SMS rule: a provider rejection is a
 * fact about the provider, and the caller is told only that a request was accepted. It is not
 * silently swallowed either: `sendEmail` reports every failure to Sentry as a vocabulary word
 * (lib/email.js), which is the only place a failed send is visible today (its own CEILING).
 */
async function mintAndSendEmailOtp(email) {
  const code = newOtpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await query("INSERT INTO email_challenges (email, code_hash, expires_at) VALUES ($1, $2, $3)", [
    email,
    hashToken(code),
    expiresAt,
  ]);
  // Opportunistic sweep, the same idiom the SMS routes and createWorkerSession use: cheaper
  // than owning another systemd timer for it.
  await query("DELETE FROM email_challenges WHERE expires_at < now() - interval '1 day'");

  await sendEmail(email, renderOtpEmail({ name: senderName(), code, ttlMinutes: OTP_TTL_MINUTES }));
}

/**
 * POST /auth/email/verify {email, code} -> worker session cookie.
 *
 * THE 200 BODY AND THE COOKIE ARE BYTE-IDENTICAL TO POST /auth/code's and POST
 * /auth/sms/verify's, because it is the same `createWorkerSession()` call, the same
 * `worker_sessions` row, the same `ts_worker` cookie and the same 90-day TTL.
 *
 *   200 {worker:{id,name}, expires_at}  + Set-Cookie: ts_worker
 *   401 {error:"invalid_code"}          EVERY other outcome, byte for byte
 *   429 {error:"too_many_attempts"}
 *   503 {error:"email_not_configured"}
 */
async function emailVerify({ body, ip }) {
  if (!emailConfigured() || !(await emailLoginEnabled())) fail(503, "email_not_configured");

  checkGlobalOtpVerifyRate();
  // OWN per-IP bucket — `emailotp:`, never `smsotp:` and never `enrol:` — so a stranger
  // guessing email codes cannot lock a worker out of the other two doors from the same
  // office address. Same idiom as `enrolop:` and `smsotpop:`.
  const bucket = `emailotp:${ip}`;
  checkLoginRate(bucket);

  const { email, presented } = normaliseEmailVerifyInput(body);

  const row =
    email === null || presented === null ? null : (
      await one(
        `SELECT c.id, c.code_hash AS stored, w.id AS worker_id, w.name
           FROM email_challenges c
           JOIN email_identities ei ON ei.email = c.email
           JOIN workers w ON w.id = ei.worker_id
          WHERE c.email = $1
            AND c.consumed_at IS NULL
            AND c.expires_at > now()
            AND c.attempts < $2
            AND w.active
          ORDER BY c.created_at DESC
          LIMIT 1`,
        [email, OTP_MAX_ATTEMPTS],
      )
    );

  const matched = safeEqual(row?.stored ?? DECOY_STORED, presented ?? DECOY_PRESENTED);
  if (!matched || row === null) {
    await burnEmailAttempt(email);
    recordLoginFailure(bucket);
    fail(401, "invalid_code");
  }

  const claimed = await redeemEmailChallenge(row.id, presented);
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

/**
 * POST /auth/operator-email/verify {email, code} -> operator session cookie. Ends in
 * `createOperatorSession()` and the `ts_operator` cookie, so the 200 body is byte-identical to
 * POST /auth/operator-code's.
 *
 * A WORKER'S LIVE CHALLENGE CANNOT BE REDEEMED HERE and vice versa: the challenge row is
 * address-keyed, but the JOIN below demands an ACTIVE OPERATOR for that address, so a code
 * mailed to a worker-only address fails this route with the same opaque 401 a wrong guess
 * gets. Under 020’s `email_identities_one_claim` CHECK an address that is BOTH is not even
 * representable.
 */
async function operatorEmailVerify({ body, ip }) {
  if (!emailConfigured() || !(await emailLoginEnabled())) fail(503, "email_not_configured");

  checkGlobalOtpVerifyRate();
  const bucket = `emailotpop:${ip}`;
  checkLoginRate(bucket);

  const { email, presented } = normaliseEmailVerifyInput(body);

  const row =
    email === null || presented === null ? null : (
      await one(
        `SELECT c.id, c.code_hash AS stored, o.id AS operator_id, o.name
           FROM email_challenges c
           JOIN email_identities ei ON ei.email = c.email
           JOIN operators o ON o.id = ei.operator_id
          WHERE c.email = $1
            AND c.consumed_at IS NULL
            AND c.expires_at > now()
            AND c.attempts < $2
            AND o.active
          ORDER BY c.created_at DESC
          LIMIT 1`,
        [email, OTP_MAX_ATTEMPTS],
      )
    );

  const matched = safeEqual(row?.stored ?? DECOY_STORED, presented ?? DECOY_PRESENTED);
  if (!matched || row === null) {
    await burnEmailAttempt(email);
    recordLoginFailure(bucket);
    fail(401, "invalid_code");
  }

  const claimed = await redeemEmailChallenge(row.id, presented);
  if (!claimed) {
    recordLoginFailure(bucket);
    fail(401, "invalid_code");
  }

  clearLoginFailures(bucket);
  const { token, expiresAt } = await createOperatorSession(row.operator_id);
  return {
    status: 200,
    body: { operator: { id: row.operator_id, name: row.name }, expires_at: expiresAt.toISOString() },
    headers: { "set-cookie": sessionCookie(token, expiresAt, OPERATOR_SESSION_COOKIE) },
  };
}

/**
 * SHAPE ONLY, AND IT MUST NOT 422 (the SMS verify routes' rule): on a verify route a
 * malformed address and a wrong code have to be indistinguishable, or the shape check becomes
 * a free existence probe. `null` is the only failure signal on both halves and the caller
 * treats it exactly like a code that is unknown, expired or already used.
 */
function normaliseEmailVerifyInput(body) {
  let email = null;
  try {
    email = v.identityEmail(body.email, "email");
  } catch {
    email = null;
  }
  const code = normaliseOtp(body.code);
  return { email, presented: code === null ? null : hashToken(code) };
}

/**
 * A WRONG ANSWER BURNS AN ATTEMPT ON THE LIVE CHALLENGE. Without this the 5-attempt cap in
 * 012's arithmetic would be fiction and the only bound would be the rate limiter. Best-effort:
 * a failure to record must not change the 401 the caller is about to get.
 */
async function burnEmailAttempt(email) {
  if (email === null) return;
  await query(
    `UPDATE email_challenges SET attempts = attempts + 1
      WHERE id = (SELECT id FROM email_challenges
                   WHERE email = $1 AND consumed_at IS NULL AND expires_at > now()
                   ORDER BY created_at DESC LIMIT 1)`,
    [email],
  ).catch(() => {});
}

/**
 * SINGLE USE, DECIDED BY THE DATABASE (012's redemption note). The predicate is repeated in
 * full rather than trusting the SELECT that found the row: between the two statements the
 * challenge can expire or be consumed, and the loser of a race must update nothing.
 */
function redeemEmailChallenge(id, presented) {
  return one(
    `UPDATE email_challenges SET consumed_at = now()
      WHERE id = $1 AND code_hash = $2 AND expires_at > now()
        AND consumed_at IS NULL AND attempts < $3
      RETURNING id`,
    [id, presented, OTP_MAX_ATTEMPTS],
  );
}

export const authRoutes = [
  // `auth: "app"` and not `null`: the X-App-Key gate stays in front of sign-in as
  // defence in depth, so this endpoint is not reachable from a browser or curl.
  // DEPRECATED IN WORDS ONLY (decision-50) — no new build calls this, but TestFlight builds
  // already on workers' phones do, on every launch. Not removed. See appleAuth's docblock.
  { method: "POST", path: "/auth/apple", auth: "app", handler: appleAuth },
  // Same coarse app-key gate as /auth/apple, and for the same reason: it is not identity,
  // it just keeps the endpoint off the open web for a browser or a stray curl.
  { method: "POST", path: "/auth/code", auth: "app", handler: codeAuth },
  { method: "POST", path: "/auth/logout", auth: "worker", handler: logout },
  { method: "GET", path: "/auth/session", auth: "worker", handler: whoami },
  // decision-48 §6.6, this iteration. auth: "app" like /app/version below — no session, so
  // the sign-in screen can ask before it has one. See capabilities() above.
  { method: "GET", path: "/auth/capabilities", auth: "app", handler: capabilities },
  // decision-45 §6/§7. Not `POST /operator/workers` — that route is BLOCKED, see
  // routes/admin.js (§8, TASK-212 AC#5).
  { method: "POST", path: "/auth/operator-code", auth: "app", handler: operatorCodeAuth },
  { method: "POST", path: "/auth/operator-logout", auth: "operator", handler: operatorLogout },
  // decision-54 §5. SMS for OPERATORS, which decision-45 §6/§7 named as deferred and this
  // decision un-defers, so the ONE shared code form on both apps means something for both
  // roles. Same coarse app-key gate as every other sign-in door. ADDED BESIDE
  // /auth/operator-code, never instead of it — the code door stays exactly as it is.
  { method: "POST", path: "/auth/operator-sms/request", auth: "app", handler: operatorSmsRequest },
  { method: "POST", path: "/auth/operator-sms/verify", auth: "app", handler: operatorSmsVerify },
  // decision-48 §6. Same coarse app-key gate as every other sign-in door, and for the same
  // reason. ADDED BESIDE /auth/code, NEVER INSTEAD OF IT: the line above stays exactly as
  // it is, and no Android build offers this until a server actually answers something other
  // than 503 — a phone that offers "Send me an SMS" against a 503 is the silent pretence
  // the owner forbade.
  { method: "POST", path: "/auth/sms/request", auth: "app", handler: smsRequest },
  { method: "POST", path: "/auth/sms/verify", auth: "app", handler: smsVerify },
  // decision-64 §3. THE THIRD DOOR, added BESIDE the other two and never instead of either:
  // the four lines above and the code lines above them are untouched. Same coarse app-key
  // gate as every other sign-in door. INERT TODAY — no box holds a RESEND_API_KEY and
  // migration 021 seeds `email_login` OFF, so all four answer 503 and
  // GET /auth/capabilities reports `email:false`; no mobile build offers any of this (§7
  // defers the mobile sign-in UI to a follow-up).
  { method: "POST", path: "/auth/email/request", auth: "app", handler: emailRequest },
  { method: "POST", path: "/auth/email/verify", auth: "app", handler: emailVerify },
  { method: "POST", path: "/auth/operator-email/request", auth: "app", handler: operatorEmailRequest },
  { method: "POST", path: "/auth/operator-email/verify", auth: "app", handler: operatorEmailVerify },
];
