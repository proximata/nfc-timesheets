// One SMS, sent by one fetch, or plainly not sent at all (decision-48).
//
// THE OWNER, VERBATIM: "in admin there must be an option to choose how to onboard a
// worker, so if sms didnt work, there is always a fallback."
//
// THE ONE RULE, and it is the same rule lib/geocode.js lives by: THIS MUST NEVER BLOCK
// ONBOARDING. No credentials, a malformed Account SID, Twilio down, a wrong number, a
// timeout, a rate limit — every one of those ends with the admin holding a working
// enrolment code on screen, because the route builds that body BEFORE it ever calls this
// file (routes/admin.js, sendEnrolmentCodeBySms step order). Nothing here throws.
//
// THE SECOND RULE: NO CREDENTIAL LEAVES THIS FILE. TWILIO_SID and TWILIO_SECRET go into an
// Authorization header, TWILIO_ACCOUNT_SID goes into the URL PATH, so no URL, no fetch
// error message, no request body and no Twilio response body may ever reach a log, a
// Sentry event or a client. Everything that escapes goes through `reason()`, which emits a
// fixed vocabulary and nothing else — verbatim the discipline lib/geocode.js applies to a
// Google URL that carries a key.
//
// THERE IS NO SMS_ENABLED ENV VAR, DELIBERATELY. Two knobs are two ways to be wrong, and a
// boolean typed by hand can contradict reality: `SMS_ENABLED=1` on a box with no Account
// SID is exactly the "silently pretends to send" failure the owner forbade. PRESENCE OF A
// COMPLETE, WELL-SHAPED CREDENTIAL SET IS THE FLAG — the same shape geocode.js gives
// GOOGLE_GEOCODING_KEY ("no_key" -> no pin, never an error). Turning SMS off is removing a
// line from /etc/nfc/env and restarting: the same operation, one fewer thing to disagree.
//
// ponytail: hand-rolled Twilio client, ~30 lines of fetch + URLSearchParams. Ladder:
//   (1) needed — yes, the owner asked for SMS. (2) stdlib — `fetch` IS stdlib in node 22.
//   (4) already-installed dep — none; the Twilio SDK would be the first dependency beyond
//   `pg` + `@sentry/node` (decision-16 as amended by decision-23) and ~40 transitive
//   packages to avoid writing eleven lines. CEILING: no retry, no backoff, no delivery
//   receipts, no inbound SMS, no STOP handling beyond whatever Twilio does for us.
//   UPGRADE PATH: a POST /sms/status webhook with Twilio signature validation writing a
//   `delivered_at` onto sms_deliveries — its own decision, because it opens a public route.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Sentry from "@sentry/node";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The leash lib/geocode.js already uses for its own outbound call. An admin pressing a
// button can wait eight seconds; a request that hangs for a minute is a spinner nobody
// trusts, and the code is already in the response body regardless of what happens here.
const SMS_TIMEOUT_MS = 8_000;

// A TEST SEAM, NOT A FEATURE FLAG. Without it there is no way to exercise the failure
// vocabulary below without spending money or texting a real handset — and "a check whose
// negative case cannot fail is not a check". Same species as lib/apple.js's
// setKeyFetcherForTest and lib/geocode.js's setGeocoderForTest, except it is an env var
// because check-sms-flag.mjs drives the whole server over HTTP rather than importing it.
const apiBase = () => (process.env.TWILIO_API_BASE || "https://api.twilio.com").replace(/\/+$/, "");

// ---- the flag ---------------------------------------------------------------------
//
// EVALUATED PER REQUEST, NEVER CACHED AT BOOT. A boot-time constant means a corrected
// /etc/nfc/env needs a deploy to be believed, and it means a check cannot flip the flag
// between two cases in one process. Reading four env vars is a property lookup.
//
// A VAR THAT IS PRESENT BUT MALFORMED COUNTS AS MISSING. `TWILIO_ACCOUNT_SID=yes` must not
// turn the feature on and then fail at the wire with a 404 from Twilio — that failure would
// arrive as "we tried and it did not work" when the truth is "this box was never configured".

const ACCOUNT_SID_RE = /^AC[0-9a-f]{32}$/i;
const MESSAGING_SERVICE_RE = /^MG[0-9a-f]{32}$/i;
const E164_RE = /^\+[1-9][0-9]{7,14}$/;

const trimmed = (name) => {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
};

/** The Twilio Account SID, or null. It is a URL PATH SEGMENT under every Twilio auth scheme. */
const accountSid = () => {
  const v = trimmed("TWILIO_ACCOUNT_SID");
  return v && ACCOUNT_SID_RE.test(v) ? v : null;
};

/**
 * Basic-auth pair. The username may be an API Key SID (`SK…`, what the vault holds today)
 * or the Account SID itself; both are valid usernames, and neither removes the Account SID
 * from the path. Shape-checked only loosely — length and character class — because a
 * credential we cannot verify offline must not be rejected for looking unfamiliar.
 */
const basicAuth = () => {
  const sid = trimmed("TWILIO_SID");
  const secret = trimmed("TWILIO_SECRET");
  if (!sid || !secret) return null;
  if (!/^[A-Za-z0-9]{20,64}$/.test(sid) || secret.length < 16) return null;
  return { sid, secret };
};

/**
 * Exactly one sender. A Messaging Service SID WINS if both are set: it is the more capable
 * of the two (pools, sender selection, opt-out handling) and picking the number instead
 * would silently ignore configuration somebody deliberately added.
 */
export function sender() {
  const service = trimmed("TWILIO_MESSAGING_SERVICE_SID");
  if (service && MESSAGING_SERVICE_RE.test(service)) {
    return { kind: "messaging_service", field: "MessagingServiceSid", value: service };
  }
  const from = trimmed("TWILIO_FROM");
  if (from && E164_RE.test(from)) return { kind: "number", field: "From", value: from };
  return null;
}

// ---- who the message is FROM, in words (decision-24) ------------------------------
//
// The name in the message body is OPERATOR IDENTITY, and operator identity is
// CONFIGURATION, not source: ops/branding.json is the single source (decision-24), so
// shipping under another name must not require a code change. `smsSenderName` is optional
// and falls back to `appName`.
//
// TWO CANDIDATE PATHS BECAUSE server/ IS FLATTENED ON THE BOX. In the repo this file is
// server/lib/sms.js and branding.json is ../../ops/branding.json; on the VM the same file
// is /srv/nfc/lib/sms.js and ops/ was rsynced to /srv/nfc/ops (deploy.sh step 4), i.e.
// ../ops/branding.json. A single relative path is correct in exactly one of the two places,
// and the one it is wrong in is production.
//
// IF NEITHER RESOLVES, THE FLAG GOES OFF (`sender_name` appears in smsMissing()). It does
// NOT fall back to a literal: a literal here is the rebrand hazard decision-24 exists to
// remove, and signing a stranger's SMS with the wrong company name is worse than not
// sending it. Read once and cached — branding is committed configuration, not state.
const BRANDING_CANDIDATES = [
  path.join(HERE, "..", "..", "ops", "branding.json"), // repo:  server/lib -> ops/
  path.join(HERE, "..", "ops", "branding.json"), //          box:   /srv/nfc/lib -> /srv/nfc/ops/
];

let brandingCache;
export function senderName() {
  if (brandingCache !== undefined) return brandingCache;
  brandingCache = null;
  for (const candidate of BRANDING_CANDIDATES) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8"));
      const name = parsed?.smsSenderName ?? parsed?.appName;
      if (typeof name === "string" && name.trim() !== "") {
        brandingCache = name.trim();
        break;
      }
    } catch {
      // next candidate. A missing or unreadable branding file is a configuration fact,
      // never an exception: this function is called from a request handler.
    }
  }
  return brandingCache;
}

/** Test seam: forget the cached branding read. Used by check-sms-message.mjs. */
export function resetSenderNameCache() {
  brandingCache = undefined;
}

/**
 * WHICH pieces of configuration are absent or malformed. NAMES ONLY — never a value, never
 * a prefix, never a length. Fixed order so a caller can compare arrays.
 *
 * @returns {string[]} [] when SMS is fully configured.
 */
export function smsMissing() {
  const missing = [];
  if (!accountSid()) missing.push("account_sid");
  if (!basicAuth()) missing.push("auth");
  if (!sender()) missing.push("sender");
  if (!senderName()) missing.push("sender_name");
  return missing;
}

/** THE FLAG. True only when every piece above is present AND well-shaped. */
export function smsConfigured() {
  return smsMissing().length === 0;
}

/** The body of GET /admin/sms-status. Names only; nothing here is a secret. */
export function smsStatus() {
  const missing = smsMissing();
  return { configured: missing.length === 0, missing, sender_kind: sender()?.kind ?? null };
}

/**
 * One line on stdout at boot, and NOTHING else — no throw, no process.exit, no Sentry
 * event. decision-23: telemetry may never be required to boot, and by the same argument a
 * feature that is switched off is not a fault. journald already carries stdout.
 */
export function logSmsConfig() {
  const missing = smsMissing();
  console.log(
    missing.length === 0 ?
      `sms: configured (sender: ${sender().kind})`
    : `sms: not configured (missing: ${missing.join(", ")})`,
  );
}

// ---- the message ------------------------------------------------------------------
//
// Rendered in German (decision-8), SERVER-SIDE. This string never goes through next-intl —
// that is the web bundle's business and a phone carrier is not a browser.
//
// GSM-7, ONE SEGMENT. The German typographic quotes „ " are NOT in GSM 03.38, and a single
// one of them flips the whole message to UCS-2: the limit halves from 160 to 70, a 106
// character message becomes two segments, and the bill and the out-of-order risk both
// double. ä ö ü ß Ä Ö Ü are in the basic set and are fine. check-sms-message.mjs asserts
// this with a seeded RED case, because it is exactly the sort of thing a well-meaning copy
// edit reintroduces.

// GSM 03.38 basic set. `\x1b` (the escape prefix) is deliberately absent — an ESC in the
// input is not a character, it is a framing error.
const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
// The extension table. Each of these costs TWO septets, not one.
const GSM7_EXTENDED = new Set("^{}\\[~]|€");

/** Every character is representable in GSM 03.38 (basic or extension table). */
export function isGsm7(text) {
  for (const ch of String(text)) {
    if (!GSM7_BASIC.has(ch) && !GSM7_EXTENDED.has(ch)) return false;
  }
  return true;
}

/** Septets, counting extension-table characters as two. Meaningless unless isGsm7(). */
export function septets(text) {
  let n = 0;
  for (const ch of String(text)) n += GSM7_EXTENDED.has(ch) ? 2 : 1;
  return n;
}

export const GSM7_SINGLE_SEGMENT = 160;

/** True when the text fits one GSM-7 SMS — i.e. costs one message and cannot arrive split. */
export function isOneSegment(text) {
  return isGsm7(text) && septets(text) <= GSM7_SINGLE_SEGMENT;
}

// Vienna, ALWAYS. "14:32" has to be the 14:32 the director would say on the telephone, not
// UTC and not whatever locale the VM happens to boot with. Vienna is UTC+1/+2, so a code
// issued at 23:50 CEST on the last Sunday of October expires on a day with 25 hours, and
// the only way that renders correctly is by formatting an absolute TIMESTAMPTZ in the
// business zone — the same rule the panel's dayTime() follows.
const VIENNA_DAY = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  day: "2-digit",
  month: "2-digit",
});
const VIENNA_TIME = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "27.08." — de-AT renders "27.08.2026"; the year is noise on a 5-day credential. */
export function viennaDay(at) {
  return VIENNA_DAY.format(at).replace(/\.?$/, ".");
}

/** "14:32", Vienna wall clock, 24h. */
export function viennaTime(at) {
  return VIENNA_TIME.format(at).replace(/\u202f|\u00a0/g, " ").trim();
}

/**
 * The enrolment-code message. `display` is the hyphenated form the admin reads aloud
 * ("K7QF-3MZ2"), so the SMS and the screen say the same thing character for character.
 */
export function renderEnrolmentSms({ name, display, expiresAt }) {
  return (
    `${name}: Ihr Zugangscode lautet ${display}. ` +
    `Gültig bis ${viennaDay(expiresAt)} um ${viennaTime(expiresAt)} Uhr. ` +
    "Bitte in der App eingeben."
  );
}

/** The OTP message. No expiry timestamp: ten minutes is easier to act on than a clock time. */
export function renderOtpSms({ name, code, ttlMinutes }) {
  return `${name}: Ihr Anmeldecode lautet ${code}. Gültig ${ttlMinutes} Minuten. Nicht weitergeben.`;
}

// ---- the wire ---------------------------------------------------------------------

/**
 * Never let a Twilio URL, a credential or a raw response body become a log line. Only the
 * words below ever escape. Same function, same vocabulary, same reasoning as
 * lib/geocode.js's reason().
 */
function reason(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "timeout";
  const code = err?.cause?.code;
  if (typeof code === "string") return `network:${code}`;
  if (err?.name === "TypeError") return "network";
  return "unknown";
}

/**
 * Send one SMS. NEVER THROWS, ALWAYS ANSWERS — the shape is identical on every path so no
 * caller has to branch on null.
 *
 * REFUSES TO CONSTRUCT THE CALL AT ALL when the Account SID or the sender is missing:
 * without an Account SID there is no URL to POST to, and without a sender Twilio would
 * reject the request after we had already spent a round trip telling it a phone number.
 * Callers reach 503 long before this (routes check `smsConfigured()` first) — this is the
 * defence in depth that makes "silently pretends to send" unreachable even from a caller
 * that forgot.
 *
 * @returns {Promise<{status: "sent"|"failed", reason?: string, provider_sid?: string, provider_code?: number|null}>}
 */
export async function sendSms(toE164, text) {
  const account = accountSid();
  const auth = basicAuth();
  const from = sender();
  // A typed refusal, not an exception and not a pretend success.
  if (!account || !auth || !from) return { status: "failed", reason: "not_configured" };
  if (!E164_RE.test(String(toE164 ?? ""))) return { status: "failed", reason: "invalid_to" };

  const url = `${apiBase()}/2010-04-01/Accounts/${encodeURIComponent(account)}/Messages.json`;
  const form = new URLSearchParams({ To: toE164, Body: text, [from.field]: from.value });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        // Basic auth with the SK key pair. Buffer, not btoa: the secret may contain
        // characters outside latin1 and btoa throws on those.
        authorization: `Basic ${Buffer.from(`${auth.sid}:${auth.secret}`, "utf8").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(SMS_TIMEOUT_MS),
    });

    // Twilio answers 4xx/5xx with a JSON body carrying a numeric `code` (21211 invalid To,
    // 21610 unsubscribed, 20003 auth). That NUMBER is a public error class and is worth
    // keeping; the `message` beside it can quote the request and is not.
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const providerCode = Number.isInteger(payload?.code) ? payload.code : null;
      captureSendFault("sms rejected", res.status === 401 || res.status === 403 ? "auth" : "rejected", providerCode);
      return { status: "failed", reason: `http_${res.status}`, provider_code: providerCode };
    }

    // STATUS 'sent' IS WRITTEN ONLY ON A 2xx THAT CARRIED AN SM… SID. A 200 with no sid is
    // not a message; recording it as sent would be the silent pretence the owner forbade.
    const sid = typeof payload?.sid === "string" && payload.sid.startsWith("SM") ? payload.sid : null;
    if (!sid) {
      captureSendFault("sms accepted without a message sid", "malformed_response", null);
      return { status: "failed", reason: "malformed_response", provider_code: null };
    }
    return { status: "sent", provider_sid: sid };
  } catch (err) {
    const why = reason(err);
    captureSendFault("sms failed", why, null);
    return { status: "failed", reason: why, provider_code: null };
  }
}

/**
 * Sentry gets the VOCABULARY WORD and the numeric provider code, and nothing else — no
 * recipient, no body, no URL, no credential. Wrapped so there is exactly one place that
 * decides what a send failure is allowed to say (decision-23, lib/scrub.js).
 */
function captureSendFault(message, why, providerCode) {
  Sentry.captureException(new Error(message), {
    tags: {
      "ts.sms.reason": why,
      ...(providerCode === null || providerCode === undefined ? {} : { "ts.sms.provider_code": String(providerCode) }),
    },
  });
}
