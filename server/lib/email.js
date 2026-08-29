// One email, sent by one fetch, or plainly not sent at all (decision-64 §4).
//
// THIS FILE IS lib/sms.js's STRUCTURE, not a new idea: a per-request configuration
// predicate, a fixed failure vocabulary, a rendered message, and one `fetch`. Where the two
// differ it is because the provider differs, never because a second style crept in.
//
// THE ONE RULE, the same one lib/sms.js and lib/geocode.js live by: NOTHING HERE THROWS. No
// key, a malformed key, Resend down, a bad address, a timeout — every one of those ends as a
// typed refusal the caller can record, never as an exception on a request path.
//
// THE SECOND RULE: NO CREDENTIAL LEAVES THIS FILE. RESEND_API_KEY goes into an Authorization
// header, so no URL, no fetch error message, no request body and no Resend response body may
// ever reach a log, a Sentry event or a client. Everything that escapes goes through
// `reason()`, which emits a fixed vocabulary and nothing else.
//
// THERE IS NO EMAIL_ENABLED ENV VAR, DELIBERATELY — verbatim lib/sms.js's argument. Two knobs
// are two ways to be wrong, and a boolean typed by hand can contradict reality. PRESENCE OF A
// COMPLETE, WELL-SHAPED CONFIGURATION IS THE FLAG. (The `email_login` feature flag, migration
// 021, is a different question: not "can this box send" but "is this door offered".)
//
// ponytail: hand-rolled Resend client, ~25 lines of fetch + JSON. Ladder: (1) needed — yes,
//   decision-64 §4 picks a provider and the owner asked for the door. (2) stdlib — `fetch` IS
//   stdlib in node 22. (4) already-installed dep — none; `resend` would be the first
//   dependency beyond `pg` + `@sentry/node` (decision-16 as amended by decision-23), which is
//   exactly why Twilio is hand-rolled too.
//   CEILING: no retry, no backoff, no delivery/bounce webhooks, no HTML part, no
//   List-Unsubscribe, and NO DELIVERY LOG — nothing here writes a row anywhere, so a bounced
//   OTP is invisible to the panel in a way a failed SMS is not (011's sms_deliveries).
//   UPGRADE PATH: an `email_deliveries` table shaped like 011's plus a Resend webhook with a
//   signature check — its own decision record, because it opens a public route.
import * as Sentry from "@sentry/node";
import { senderName } from "./sms.js";

// The same leash lib/sms.js and lib/geocode.js put on their outbound calls.
const EMAIL_TIMEOUT_MS = 8_000;

// A TEST SEAM, NOT A FEATURE FLAG — the same species as lib/sms.js's TWILIO_API_BASE. It is
// an env var rather than a setter because the checks drive the whole server over HTTP.
const apiBase = () => (process.env.RESEND_API_BASE || "https://api.resend.com").replace(/\/+$/, "");

// ---- the configuration predicate ---------------------------------------------------
//
// EVALUATED PER REQUEST, NEVER CACHED AT BOOT (lib/sms.js's rule): a corrected /etc/nfc/env
// must not need a deploy to be believed, and a check must be able to flip it between two
// cases inside one process.
//
// A VAR THAT IS PRESENT BUT MALFORMED COUNTS AS MISSING. `RESEND_API_KEY=yes` must not turn
// the feature on and then fail at the wire with a 401 from Resend — that failure would
// arrive as "we tried and it did not work" when the truth is "this box was never configured".

// Resend issues keys as `re_` + an opaque base62/underscore/hyphen blob. Shape-checked
// loosely — prefix, character class and a length floor — because a credential we cannot
// verify offline must not be rejected for looking unfamiliar (lib/sms.js's basicAuth note).
const RESEND_KEY_RE = /^re_[A-Za-z0-9_-]{16,}$/;
// The SAME deliberately-loose address shape lib/validate.js and migration 020 use.
const EMAIL_RE = /^[^\s@,]+@[^\s@,.]+(\.[^\s@,.]+)+$/;

const trimmed = (name) => {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
};

/** The Resend API key, or null. Never returned to a caller, never logged. */
const apiKey = () => {
  const v = trimmed("RESEND_API_KEY");
  return v && RESEND_KEY_RE.test(v) ? v : null;
};

/**
 * The FROM address. Resend rejects a send without one and will not invent a default, so a
 * box with a key and no verified sender is not configured — the same reason lib/sms.js
 * counts a missing TWILIO_FROM/MessagingServiceSid as missing rather than sending anyway.
 */
export function fromAddress() {
  const v = trimmed("RESEND_FROM");
  return v && EMAIL_RE.test(v) ? v.toLowerCase() : null;
}

/**
 * WHICH pieces of configuration are absent or malformed. NAMES ONLY — never a value, never a
 * prefix, never a length. Fixed order so a caller can compare arrays.
 *
 * `sender_name` is decision-24's rule applied unchanged: the operator name in the message is
 * CONFIGURATION (ops/branding.json), so it is reused from lib/sms.js's `senderName()` rather
 * than read a second time here — one branding reader, one cache, one rebrand hazard removed
 * instead of two. If branding cannot be read the flag goes OFF; it never falls back to a
 * literal company name.
 *
 * @returns {string[]} [] when email is fully configured.
 */
export function emailMissing() {
  const missing = [];
  if (!apiKey()) missing.push("api_key");
  if (!fromAddress()) missing.push("from");
  if (!senderName()) missing.push("sender_name");
  return missing;
}

/** THE PREDICATE. True only when every piece above is present AND well-shaped. */
export function emailConfigured() {
  return emailMissing().length === 0;
}

/** Names only; nothing here is a secret. Shaped like `smsStatus()` for the same reason. */
export function emailStatus() {
  const missing = emailMissing();
  return { configured: missing.length === 0, missing };
}

/**
 * One line on stdout at boot and NOTHING else — no throw, no process.exit, no Sentry event.
 * decision-23: telemetry may never be required to boot, and a feature that is switched off is
 * not a fault.
 */
export function logEmailConfig() {
  const missing = emailMissing();
  console.log(missing.length === 0 ? "email: configured" : `email: not configured (missing: ${missing.join(", ")})`);
}

// ---- the message -------------------------------------------------------------------
//
// PLAIN TEXT, NOT HTML (decision-64's brief: "the simplest correct thing"). This app has no
// HTML-email infrastructure — no template engine, no inliner, no dark-mode CSS, no preview
// harness — and an OTP is six digits and one sentence. An HTML part would be a second copy of
// the same words that can silently disagree with the text part, plus a rendering surface to
// test on clients nobody here owns.
//
// GERMAN, SERVER-SIDE (decision-8), exactly like renderOtpSms: this string never goes through
// next-intl — that is the web bundle's business and a mail client is not a browser. No GSM-7
// constraint applies (that was a per-segment SMS billing rule), so proper typography is fine.

/**
 * The OTP email. Subject carries the code as well, because most clients show the subject in
 * the notification and the whole point is that the person does not have to open anything.
 *
 * No expiry timestamp, verbatim renderOtpSms's reasoning: ten minutes is easier to act on
 * than a clock time.
 */
export function renderOtpEmail({ name, code, ttlMinutes }) {
  return {
    subject: `${name}: Anmeldecode ${code}`,
    text:
      `Ihr Anmeldecode lautet ${code}.\n\n` +
      `Gültig ${ttlMinutes} Minuten. Bitte nicht weitergeben.\n\n` +
      `Wenn Sie diesen Code nicht angefordert haben, ignorieren Sie diese Nachricht.\n\n` +
      `${name}\n`,
  };
}

// ---- the one-time code --------------------------------------------------------------
//
// SIX DIGITS, TEN MINUTES, FIVE ATTEMPTS — the SAME code object lib/sms.js mints, and
// deliberately so (decision-64 §3: "a 6-digit numeric OTP, matching the existing SMS OTP
// shape"). 012's arithmetic carries over unchanged because it is bounded by ATTEMPTS, not by
// channel: a guess is checked against THE ONE challenge minted for that address in the same
// request, so there is no union to attack.
//
// NOTHING IS RETYPED HERE. routes/auth.js's email handlers call lib/sms.js's `newOtpCode`,
// `normaliseOtp`, `OTP_TTL_MS`, `OTP_TTL_MINUTES` and `OTP_MAX_ATTEMPTS` directly — two
// copies of a credential's length or its attempt cap is how they drift, and a drift here
// would silently invalidate the arithmetic in 012's header. Those names are about a ONE-TIME
// CODE, not about a carrier, so living in sms.js is a naming accident and not a reason to
// duplicate them; moving them to a lib/otp.js is the tidy-up, not this task.

// ---- the wire ------------------------------------------------------------------------

/**
 * Never let a URL, a credential or a raw provider response become a log line. Only the words
 * below ever escape — the same function, vocabulary and reasoning as lib/sms.js's `reason()`.
 */
function reason(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "timeout";
  const code = err?.cause?.code;
  if (typeof code === "string") return `network:${code}`;
  if (err?.name === "TypeError") return "network";
  return "unknown";
}

/**
 * Send one email. NEVER THROWS, ALWAYS ANSWERS — the shape is identical on every path so no
 * caller has to branch on null.
 *
 * REFUSES TO CONSTRUCT THE CALL AT ALL when the key or the from-address is missing. Callers
 * reach 503 long before this (routes check `emailConfigured()` first); this is the defence in
 * depth that makes "silently pretends to send" unreachable even from a caller that forgot.
 *
 * @returns {Promise<{status: "sent"|"failed", reason?: string, provider_id?: string}>}
 */
export async function sendEmail(to, { subject, text }) {
  const key = apiKey();
  const from = fromAddress();
  const name = senderName();
  if (!key || !from || !name) return { status: "failed", reason: "not_configured" };
  if (!EMAIL_RE.test(String(to ?? ""))) return { status: "failed", reason: "invalid_to" };

  try {
    const res = await fetch(`${apiBase()}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      // `from` is rendered as `Name <address>` so the recipient sees the operator, not a
      // bare mailbox. The name comes from ops/branding.json (decision-24) and the address
      // from the env, so a rebrand is configuration on both halves.
      body: JSON.stringify({ from: `${name} <${from}>`, to: [to], subject, text }),
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      captureSendFault("email rejected", res.status === 401 || res.status === 403 ? "auth" : "rejected");
      return { status: "failed", reason: `http_${res.status}` };
    }

    // STATUS 'sent' IS WRITTEN ONLY ON A 2xx THAT CARRIED AN ID, verbatim lib/sms.js's rule
    // about an SM… sid: a 200 with no id is not a message, and recording it as sent would be
    // the silent pretence the owner forbade.
    const id = typeof payload?.id === "string" && payload.id !== "" ? payload.id : null;
    if (!id) {
      captureSendFault("email accepted without an id", "malformed_response");
      return { status: "failed", reason: "malformed_response" };
    }
    return { status: "sent", provider_id: id };
  } catch (err) {
    const why = reason(err);
    captureSendFault("email failed", why);
    return { status: "failed", reason: why };
  }
}

/**
 * Sentry gets the VOCABULARY WORD and nothing else — no recipient, no body, no URL, no
 * credential. Wrapped so there is exactly one place that decides what a send failure may say
 * (decision-23, lib/scrub.js).
 */
function captureSendFault(message, why) {
  Sentry.captureException(new Error(message), { tags: { "ts.email.reason": why } });
}
