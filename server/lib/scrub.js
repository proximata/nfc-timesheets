// Redaction at the telemetry boundary. Pure functions, zero imports, zero deps.
//
// WHY THIS FILE EXISTS AT ALL: "remember not to log the token" is not a control. This
// is EU/Austrian payroll data about real people, so the rule has to hold for code
// nobody has written yet, including the Sentry SDK's own automatic capture
// (`requestDataIntegration` attaches headers and bodies, the http breadcrumb attaches
// URLs). Everything that leaves this process — a journald line, a Sentry event, a
// Sentry log attribute, a breadcrumb — goes through one of the functions below.
// A leak here is a GDPR problem, not a bug.
//
// THE DENYLIST, and why each entry is on it:
//   Apple identity_token / nonce  - a live credential; replaying one mints a session
//   apple_sub                     - stable per-person identifier, PII in its own right
//   ts_worker / ts_session cookie - a live session; a log line is a session hijack
//   X-App-Key                     - the shared build secret
//   password / scrypt hash        - obvious
//   email                         - PII, and under Hide My Email still an identifier
//   hourly_rate_cents             - pay data, admin-only even inside the product
//   /portal/<token>               - the token IS the credential (routes/portal.js)
//
// `redactUrl` was previously a private helper in server.js used for the 500 log line.
// It lives here now so the access log, the 500 line and the Sentry hooks share ONE
// implementation. Two copies would be two chances to get it wrong.

// Key names whose VALUE is never allowed out, wherever they appear in a payload.
// Matched case-insensitively against the key, on purpose: `identity_token`,
// `identityToken`, `X-App-Key`, `set-cookie` and `password_hash` all have to hit.
const SECRET_KEY_RE =
  /(token|cookie|passwd|password|secret|authorization|hash|app[-_]?key|apple[-_]?sub|nonce|e-?mail|hourly|rate_cents)/i;

// Keys whose value is a URL and therefore gets the full URL treatment (query dropped).
const URL_KEY_RE = /(^|\.)(url|href|target|full|path|uri)$/i;

// Keys whose value is a BARE QUERY STRING, deleted outright.
//
// THIS IS A MEASURED LEAK, not a precaution. The auto-instrumented `http.server` span
// carries the query TWICE: once inside `http.url`/`url.full` (caught by URL_KEY_RE above,
// which drops it) and once ON ITS OWN as `http.query`. That second copy matched neither
// list, so it went out verbatim. Observed on the wire:
//
//   "http.query": "token=SHOULDNOTAPPEAR&email=ivan@example.com"
//
// redactUrl cannot help here — the value has no `?` to split on, so it passes through
// untouched. And filtering it parameter-by-parameter would be the exact stale allowlist
// redactUrl exists to avoid. So the value goes, wholesale, like every other query string.
//
// ANCHORED on the last dotted segment on purpose: an unanchored /query/ would also delete
// `db.query.text`, which is parameterised SQL with no values in it and is worth keeping.
const QUERY_KEY_RE = /(^|\.)(query|query_string|search|querystring)$/i;

// `[^/?#\s]+` stops at the next path segment, the query, the fragment, or whitespace —
// so it still works when the path is embedded in a bigger string (a span name, a log
// line, a stack frame). Quotes are deliberately NOT excluded: a real token is base64url,
// but the segment is attacker-controlled and over-redacting a hostile URL costs nothing
// while under-redacting one is the failure this file exists to prevent.
const PORTAL_TOKEN_RE = /(\/portal\/)[^/?#\s]+/g;

// A single log line or span name must not be able to flood journald or a Sentry event.
const MAX_URL_LEN = 300;
const MAX_DEPTH = 8;

/** Strip a client-portal token out of any string that might embed one. */
export function redactPortalToken(value) {
  return String(value ?? "").replace(PORTAL_TOKEN_RE, "$1<redacted>");
}

/**
 * A URL reduced to what is safe to write down: PATH ONLY, portal token redacted.
 *
 * The query string is dropped wholesale rather than filtered. Today only `/t?l=<uuid>`
 * carries one and it is not sensitive — but "which query parameters are secret" is a
 * list that goes stale, and the failure mode of getting it wrong is a credential in a
 * log file. Dropping the whole thing has no such failure mode.
 */
export function redactUrl(url) {
  const raw = String(url ?? "");
  const path = raw.split("#")[0].split("?")[0];
  return redactPortalToken(path).slice(0, MAX_URL_LEN);
}

/**
 * Walk any Sentry payload and strip it in place.
 *
 * Deliberately generic: it does not need to know where in the event shape a value sits,
 * so it keeps working when the SDK adds a field, and it covers span attributes
 * (`http.url` on the auto-instrumented `http.server` span carries the full request URL,
 * portal token and all) as well as the obvious `event.request.headers`.
 */
function deepScrub(node, depth) {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === "string") node[i] = redactPortalToken(node[i]);
      else deepScrub(node[i], depth + 1);
    }
    return;
  }

  for (const key of Object.keys(node)) {
    if (SECRET_KEY_RE.test(key) || QUERY_KEY_RE.test(key)) {
      delete node[key];
      continue;
    }
    const value = node[key];
    if (typeof value === "string") {
      node[key] = URL_KEY_RE.test(key) ? redactUrl(value) : redactPortalToken(value);
    } else {
      deepScrub(value, depth + 1);
    }
  }
}

/**
 * `beforeSend` / `beforeSendTransaction`. Returns the same object, mutated.
 *
 * The three explicit deletes are the ones the generic walk cannot infer: `data` is the
 * REQUEST BODY (which is where an Apple identity_token arrives), `cookies` is the parsed
 * cookie jar, `query_string` is the raw query the generic pass would otherwise keep
 * because it is a plain string under a harmless-looking key.
 */
export function scrubEvent(event) {
  if (!event || typeof event !== "object") return event;

  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
  }
  if (event.user) {
    // id only. A worker id is meaningless outside our database; a name or an address
    // is not (decision-22 keeps both out of the session object for the same reason).
    delete event.user.username;
    delete event.user.ip_address;
    delete event.user.name;
  }

  deepScrub(event, 0);
  return event;
}

/** `beforeSendLog`. Attribute values are flat, so key-name filtering is the whole job. */
export function scrubLogAttributes(attributes) {
  const out = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (SECRET_KEY_RE.test(key)) continue;
    out[key] = typeof value === "string" ? redactPortalToken(value) : value;
  }
  return out;
}

/**
 * `beforeBreadcrumb`. Returns null to DROP the crumb.
 *
 * A portal request is dropped rather than redacted: the crumb's only content is the URL,
 * and without the token it says nothing a transaction does not already say.
 */
export function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb || typeof breadcrumb !== "object") return breadcrumb;
  const url = breadcrumb.data?.url;
  if (typeof url === "string" && url.includes("/portal/")) return null;
  deepScrub(breadcrumb, 0);
  return breadcrumb;
}
