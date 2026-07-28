// Sign in with Apple — identity token verification (decision-22).
//
// TRUST BOUNDARY. Everything below runs on a string an unauthenticated caller handed
// us. The rule is: SIGNATURE FIRST, CLAIMS SECOND, and nothing in the payload is a
// fact until the RSA check has passed. A token that merely *parses* is not verified —
// base64 is not a security property, and `JSON.parse(atob(parts[1])).sub` is the
// single most common way this integration gets built wrong.
//
// stdlib only. Node 22 imports a JWK directly (`format: "jwk"`) and verifies RS256
// natively, so `jose` and `jsonwebtoken` buy nothing here: the dependency budget for
// this server stays exactly `pg` (decision-16).
//
// FAIL CLOSED, ALWAYS. Every path out of here is either a verified claim set or a
// throw. There is no branch that returns a payload because the network was down, the
// JWKS was malformed or Apple returned a 500 — an outage must lock everyone out, not
// let everyone in.
//
// Nothing here is logged except JWKS transport failures (a URL and an error message).
// Never log the token, the `sub` or the email.
import { createHash, createPublicKey, verify } from "node:crypto";
import { safeEqual } from "./auth.js";

const JWKS_URL = "https://appleid.apple.com/auth/keys";
const ISSUER = "https://appleid.apple.com";

/** `aud` must be OUR app. A valid Apple token minted for someone else's app is a forgery here. */
export const APPLE_AUDIENCE = "io.github.qwadratic.NFCTimeSheets";

// Apple's tokens are ~1 KB. The cap stops an attacker making us base64-decode and
// JSON.parse megabytes before the signature check can reject them.
const MAX_TOKEN_CHARS = 8192;

// RS256 only. Named explicitly rather than read from the header, because "trust the
// alg field" is how `alg: none` and the HS256-signed-with-the-public-key confusion
// attack both work.
const ALG = "RS256";
const NODE_ALG = "RSA-SHA256";

// Clocks drift. 60 s of leeway on `exp` only — never on the signature.
const CLOCK_SKEW_MS = 60_000;

// ---- JWKS cache ------------------------------------------------------------------
// Apple rotates signing keys without notice, so an unknown `kid` triggers a re-fetch
// rather than a rejection. That re-fetch is rate-limited: otherwise anyone could make
// this process hammer Apple (and stall its own event loop) by posting garbage kids.
const JWKS_TTL_MS = 6 * 60 * 60 * 1000;
const JWKS_MIN_REFETCH_MS = 60_000;
const JWKS_TIMEOUT_MS = 5000;

let cache = { keys: null, fetchedAt: 0, lastAttempt: 0 };

async function fetchAppleKeys() {
  let res;
  try {
    res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
  } catch (err) {
    // Ops needs to see this — it is the difference between "one bad token" and "nobody
    // can sign in". The token is not in scope here, so there is nothing to leak.
    console.error(`[apple] JWKS fetch failed: ${err.message}`);
    throw new Error("jwks_unavailable");
  }
  if (!res.ok) {
    console.error(`[apple] JWKS fetch returned ${res.status}`);
    throw new Error("jwks_unavailable");
  }
  const body = await res.json();
  const keys = Array.isArray(body?.keys) ? body.keys : null;
  // A JWKS with no usable RSA keys is a malformed JWKS. Treat it as an outage rather
  // than caching an empty map and 401-ing every future login until the TTL lapses.
  const usable = keys?.filter((k) => k?.kty === "RSA" && typeof k.kid === "string" && k.n && k.e);
  if (!usable || usable.length === 0) throw new Error("jwks_unavailable");
  return new Map(usable.map((k) => [k.kid, k]));
}

// Test seam: check-api.js swaps in a locally generated key so the check never depends
// on Apple's availability (or leaks that CI is running). Production never calls this.
let keyFetcher = fetchAppleKeys;
export function setKeyFetcherForTest(fn) {
  keyFetcher = fn ?? fetchAppleKeys;
  cache = { keys: null, fetchedAt: 0, lastAttempt: 0 };
}

async function keyFor(kid) {
  const now = Date.now();
  const fresh = cache.keys && now - cache.fetchedAt < JWKS_TTL_MS;
  if (fresh && cache.keys.has(kid)) return cache.keys.get(kid);

  // Stale, or a kid we have never seen (Apple rotated). Re-fetch — but not more often
  // than JWKS_MIN_REFETCH_MS, so a flood of bogus kids cannot turn this into a proxy
  // for DoSing Apple.
  if (!fresh || now - cache.lastAttempt >= JWKS_MIN_REFETCH_MS) {
    cache.lastAttempt = now;
    const keys = await keyFetcher(); // throws => caller 401s. Never falls through.
    cache = { keys, fetchedAt: now, lastAttempt: now };
  }
  const key = cache.keys?.get(kid);
  if (!key) throw new Error("unknown_kid");
  return key;
}

// ---- token parsing ---------------------------------------------------------------
/** Strict base64url -> Buffer. Rejects padding and any non-alphabet byte. */
function decodeSegment(segment) {
  if (typeof segment !== "string" || segment === "" || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new Error("malformed_token");
  }
  return Buffer.from(segment, "base64url");
}

function parseJson(buf) {
  let value;
  try {
    value = JSON.parse(buf.toString("utf8"));
  } catch {
    throw new Error("malformed_token");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("malformed_token");
  return value;
}

/** Lowercase hex SHA-256, matching iOS `AppleNonce.hashed` byte for byte. */
const hashNonce = (raw) => createHash("sha256").update(raw, "utf8").digest("hex");

/** `aud` is a string for Apple, but the JWT spec allows an array. Accept both, match exactly. */
const audienceMatches = (aud) =>
  typeof aud === "string" ? aud === APPLE_AUDIENCE : Array.isArray(aud) && aud.includes(APPLE_AUDIENCE);

/**
 * Verify an Apple identity token.
 *
 * @param {string} token          the raw `identity_token` from ASAuthorizationAppleIDCredential
 * @param {{nonce?: string|null}} opts  the RAW nonce, as posted by the app. The app puts
 *                                      SHA-256(raw) — lowercase hex — into the
 *                                      ASAuthorizationAppleIDRequest, and Apple copies
 *                                      that string into the `nonce` claim verbatim, so
 *                                      the comparison below hashes before it compares.
 *                                      Both halves must agree on this exact spelling or
 *                                      every single sign-in 401s.
 * @returns {Promise<{sub: string, email: string|null, emailVerified: boolean}>}
 * @throws  on ANYTHING unexpected. The caller turns every throw into one opaque 401.
 *
 * Checks, in this order — the order matters, claims are meaningless before the signature:
 *   1. shape: exactly three base64url segments, under the size cap
 *   2. header: alg === RS256, kid present  (alg is CHECKED, never obeyed)
 *   3. RSA-SHA256 signature over "<header>.<payload>" against the key for that kid
 *   4. iss === https://appleid.apple.com
 *   5. aud === our bundle id
 *   6. exp in the future (60 s leeway); iat present and not absurdly ahead
 *   7. nonce matches, when the caller supplied one (constant-time)
 *   8. sub is a non-empty string
 */
export async function verifyIdentityToken(token, { nonce = null } = {}) {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) {
    throw new Error("malformed_token");
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed_token");

  const header = parseJson(decodeSegment(parts[0]));
  if (header.alg !== ALG || typeof header.kid !== "string" || header.kid === "") {
    throw new Error("bad_header");
  }

  const jwk = await keyFor(header.kid);
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });

  // The signature covers the ENCODED header and payload, byte for byte — re-serialising
  // the parsed objects would produce different bytes and never verify.
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "ascii");
  if (!verify(NODE_ALG, signed, publicKey, decodeSegment(parts[2]))) {
    throw new Error("bad_signature");
  }

  // ---- only now is the payload evidence of anything ----
  const claims = parseJson(decodeSegment(parts[1]));

  if (claims.iss !== ISSUER) throw new Error("bad_issuer");
  if (!audienceMatches(claims.aud)) throw new Error("bad_audience");

  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp * 1000 + CLOCK_SKEW_MS <= Date.now()) throw new Error("expired");

  // A token stamped in the future is either a broken clock at Apple (does not happen)
  // or a replay attempt against a machine whose clock we do not control.
  const iat = Number(claims.iat);
  if (!Number.isFinite(iat) || iat * 1000 > Date.now() + CLOCK_SKEW_MS) throw new Error("bad_iat");

  // Replay defence. Only checked when the app actually sent a nonce — an absent nonce
  // on both sides is the documented Apple flow, but a nonce we EXPECT and do not get
  // is a stripped-nonce attack and must fail.
  //
  // The claim holds the HASH: the raw value never leaves the phone and our server, so
  // whoever intercepts the token cannot construct a body that matches it.
  if (nonce !== null && !safeEqual(claims.nonce, hashNonce(nonce))) throw new Error("bad_nonce");

  if (typeof claims.sub !== "string" || claims.sub === "") throw new Error("bad_subject");

  return {
    sub: claims.sub,
    // Lower-cased at the boundary so it can be compared to workers.email, which is
    // lower-case by invariant (002_worker_identity.sql). May legitimately be a
    // @privaterelay.appleid.com address, or absent entirely.
    email: typeof claims.email === "string" && claims.email !== "" ? claims.email.trim().toLowerCase() : null,
    // Apple sends this as a boolean OR the string "true", depending on the flow.
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
  };
}
