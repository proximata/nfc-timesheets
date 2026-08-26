// App Store Connect API client - just enough to add a newly-processed Xcode Cloud build
// to the TestFlight "me" internal-testing group. This is the fix for the deadlock found
// 2026-08-26: doing this from NFCTimeSheets/ci_scripts/ci_post_xcodebuild.sh cannot work
// because that hook runs BEFORE Xcode Cloud uploads the build to Apple, so the build the
// script wants to add to a group cannot exist in the API yet. Apple's own webhook fires
// AFTER upload/processing finishes (routes/webhooks.js), which is the earliest correct
// point to do this from - and it's independent of the Xcode Cloud run entirely, so it can
// never fail an archive again.
//
// Optional integration (decision-23 pattern, same as lib/geocode.js / lib/sms.js): every
// export here degrades to a clear log line and a no-op if the three APP_STORE_CONNECT_*
// env vars are unset. Never in REQUIRED_ENV, never blocks boot.

import crypto from "node:crypto";

const APP_ID = "6792530780"; // NFC TimeSheets - stable, visible in any App Store Connect URL for this app
const INTERNAL_GROUP_ID = "7f583737-4a08-42c6-bc40-d98465f87466"; // TestFlight "me" group

const apiBase = () => (process.env.APPSTORECONNECT_API_BASE || "https://api.appstoreconnect.apple.com").replace(
  /\/+$/,
  "",
);

function trimmed(name) {
  const v = process.env[name];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** True iff all three App Store Connect API key env vars are present and non-blank. */
export function ascConfigured() {
  return Boolean(trimmed("APP_STORE_CONNECT_KEY_ID") && trimmed("APP_STORE_CONNECT_ISSUER_ID") && trimmed("APP_STORE_CONNECT_KEY_BASE64"));
}

/** One line at boot naming what's absent, never a value or a length - mirrors logSmsConfig. */
export function logAscConfig() {
  if (ascConfigured()) {
    console.log("[asc] App Store Connect API key present - TestFlight auto-group-add is active");
    return;
  }
  console.log(
    "[asc] App Store Connect API key not set (APP_STORE_CONNECT_KEY_ID/ISSUER_ID/KEY_BASE64) - " +
      "new Xcode Cloud builds must be added to the TestFlight group by hand",
  );
}

/**
 * Sign a fresh ES256 JWT for the App Store Connect API. Node's `dsaEncoding: "ieee-p1363"`
 * asks openssl for the raw fixed-width r||s signature JOSE wants directly - no manual DER
 * parsing needed (the shell version of this, since deleted, had to hand-roll that).
 */
function mintToken() {
  const keyId = trimmed("APP_STORE_CONNECT_KEY_ID");
  const issuerId = trimmed("APP_STORE_CONNECT_ISSUER_ID");
  const pem = Buffer.from(trimmed("APP_STORE_CONNECT_KEY_BASE64"), "base64").toString("utf8");

  const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = b64url(Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" })));
  const payload = b64url(
    Buffer.from(JSON.stringify({ iss: issuerId, exp: Math.floor(Date.now() / 1000) + 1200, aud: "appstoreconnect-v1" })),
  );
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: pem,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${b64url(signature)}`;
}

async function ascFetch(path, init = {}) {
  const res = await fetch(`${apiBase()}/v1/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${mintToken()}`, ...(init.headers ?? {}) },
  });
  return res;
}

/**
 * Most recent builds for this app that finished processing (processingState VALID), each
 * with its current TestFlight group membership already attached.
 *
 * `include=betaGroups` - NOT a per-build `GET builds/{id}/relationships/betaGroups` call,
 * which looks like the obvious way to ask this and is what the first version of this file
 * did. Proven wrong against the live API (2026-08-26): that relationship link only allows
 * CREATE/DELETE, not GET - Apple's 403 says so explicitly ("Allowed operations are: CREATE,
 * DELETE"). The JSON:API `include` param sidesteps it entirely by embedding each build's
 * betaGroups directly in this one response instead of a link you're expected to follow.
 */
async function recentValidBuilds(limit = 5) {
  const url = `builds?filter[app]=${APP_ID}&filter[processingState]=VALID&sort=-uploadedDate&limit=${limit}&include=betaGroups`;
  const res = await ascFetch(url);
  if (!res.ok) throw new Error(`GET builds failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.data ?? [];
}

/** True iff `build` (as returned by recentValidBuilds, include=betaGroups already resolved) is already a member of the internal TestFlight group. */
function inInternalGroup(build) {
  return (build.relationships?.betaGroups?.data ?? []).some((g) => g.id === INTERNAL_GROUP_ID);
}

async function addToInternalGroup(buildId) {
  const res = await ascFetch(`betaGroups/${INTERNAL_GROUP_ID}/relationships/builds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: [{ type: "builds", id: buildId }] }),
  });
  if (res.status !== 204) throw new Error(`POST betaGroups/builds failed: ${res.status} ${await res.text()}`);
}

/**
 * Called from the webhook handler once Apple reports a build-status change. Checks the
 * most recent VALID builds and adds any that are not yet in the internal group - not just
 * the one build the event mentioned, so a missed or out-of-order delivery still self-heals
 * on the next event. Idempotent: a build already in the group is skipped, not re-added.
 * Returns the list of build ids it actually added, for logging.
 */
export async function syncLatestBuildsToInternalGroup() {
  if (!ascConfigured()) {
    console.log("[asc] sync skipped - API key not configured");
    return [];
  }
  const builds = await recentValidBuilds();
  const added = [];
  for (const build of builds) {
    if (inInternalGroup(build)) continue;
    await addToInternalGroup(build.id);
    added.push(build.id);
  }
  if (added.length > 0) {
    console.log(`[asc] added build(s) to TestFlight internal group: ${added.join(", ")}`);
  }
  return added;
}
