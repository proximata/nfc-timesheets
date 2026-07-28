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
// LOGGING: never log the identity token, the Apple `sub`, or the email. The 403 body
// carries the email because the WORKER has to be able to read it to their manager; that
// is a response to the person who just authenticated as that address, not a log line.
import { verifyIdentityToken } from "../lib/apple.js";
import {
  WORKER_SESSION_COOKIE,
  checkLoginRate,
  clearLoginFailures,
  clearedSessionCookie,
  createWorkerSession,
  destroyWorkerSession,
  recordLoginFailure,
  sessionCookie,
} from "../lib/auth.js";
import { one } from "../lib/db.js";
import { fail } from "../lib/http.js";

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

export const authRoutes = [
  // `auth: "app"` and not `null`: the X-App-Key gate stays in front of sign-in as
  // defence in depth, so this endpoint is not reachable from a browser or curl.
  { method: "POST", path: "/auth/apple", auth: "app", handler: appleAuth },
  { method: "POST", path: "/auth/logout", auth: "worker", handler: logout },
  { method: "GET", path: "/auth/session", auth: "worker", handler: whoami },
];
