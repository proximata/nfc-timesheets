// Inbound webhooks from third parties. Today: exactly one, App Store Connect's TestFlight
// build-status notification (lib/appstoreconnect.js has the full "why this exists" story).
//
// `auth: null` on purpose - the caller is Apple's server, not our app or a signed-in
// worker/operator, so there is no X-App-Key and no session cookie to check. Authenticity
// comes from the HMAC signature instead (verifySignature below), which is why this handler
// verifies BEFORE doing anything else and answers 401 with no further detail on mismatch.
import crypto from "node:crypto";
import { fail, RAW_BODY } from "../lib/http.js";
import * as asc from "../lib/appstoreconnect.js";

/** Constant-time hex compare - a plain `===` on the digest would leak timing per byte. */
function signatureMatches(secret, raw, givenHex) {
  const expected = crypto.createHmac("sha256", secret).update(raw, "utf8").digest(); // Buffer
  // Buffer.from(_, "hex") never throws - it silently stops at the first non-hex char - so a
  // malformed header just yields a short/wrong buffer, which the length check below rejects.
  const given = Buffer.from(givenHex, "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

async function handleAppStoreConnect({ body, headers }) {
  const secret = process.env.ASC_WEBHOOK_SECRET;
  if (!secret || secret.trim() === "") {
    // Not configured on this box - answer 404, not 401: there is nothing here to try to
    // authenticate against, so pretending the route doesn't exist is the honest answer.
    fail(404, "not_found");
  }

  const raw = body[RAW_BODY];
  const header = headers["x-apple-signature"];
  if (typeof raw !== "string" || typeof header !== "string" || !header.startsWith("hmacsha256=")) {
    fail(401, "bad_signature");
  }
  const got = header.slice("hmacsha256=".length);
  if (!signatureMatches(secret, raw, got)) {
    fail(401, "bad_signature");
  }

  // Apple needs a timely 2xx or it treats the delivery as failed and retries. The actual
  // work is a couple of small, fast API calls (see lib/appstoreconnect.js) - cheap enough
  // to just await inline rather than ack-then-background it. Any eventType we get is a
  // reason to re-check "is there a VALID build not yet in the group", not something this
  // handler needs to branch on by name - see that file for why (self-healing on any event,
  // including ones we didn't ask for or don't recognise, rather than parsing a payload
  // shape that has already changed once between Apple doc snapshots this session).
  try {
    await asc.syncLatestBuildsToInternalGroup();
  } catch (err) {
    // Never surface Apple's own infrastructure problem as a delivery failure that makes
    // Apple retry into the same error - log and still answer 200. Worst case, the same
    // self-healing sync just runs again on the next webhook delivery or the next push.
    console.error("[asc] sync failed:", err?.message ?? err);
  }

  return { status: 200, body: { ok: true } };
}

export const webhookRoutes = [{ method: "POST", path: "/webhooks/appstoreconnect", auth: null, handler: handleAppStoreConnect }];
