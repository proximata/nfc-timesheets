// Redaction at the telemetry boundary, browser side. Pure functions, zero imports.
//
// decision-70: every platform has exactly ONE scrub file and they are MIRRORS —
// server/lib/scrub.js, NFCTimeSheets/Scrub.swift, android core/Scrub.kt, and this one.
// The four grow together in the same commit. web/scripts/check.mjs asserts the denylist
// below is byte-identical to the server's, so a fifth key added there fails the build
// here until it is added here too.
//
// WHY A BROWSER COPY IS NOT REDUNDANT: this is the ADMIN panel. The person using it can
// see every worker's pay, and the SDK's own automatic capture attaches things nobody
// wrote down on purpose — `fetch`/`xhr` breadcrumbs carry the full request URL, console
// breadcrumbs carry whatever was logged, and a `/portal/<token>` link is a live bearer
// credential (routes/portal.js). "Remember not to log it" is not a control.

// Key names whose VALUE is never allowed out, wherever they appear in a payload.
// MIRROR of SECRET_KEY_RE in server/lib/scrub.js — keep byte-identical.
//
// `^code$` is ANCHORED on purpose: an enrolment code arrives as `{"code": "12345"}`
// (decision-63), so the bare key has to go, but an unanchored /code/ would also delete
// `http.response.status_code` and `err.code` — the only fields that make a 4xx
// diagnosable, to hide a value that is not in them.
const SECRET_KEY_RE =
  /(token|cookie|passwd|password|secret|authorization|hash|app[-_]?key|apple[-_]?sub|nonce|e-?mail|hourly|rate_cents|^code$|enrol{1,2}ment[-_]?code)/i

/** Keys whose value is a URL and therefore gets the full URL treatment (query dropped). */
const URL_KEY_RE = /(^|\.)(url|href|target|full|path|uri)$/i

/** Keys whose value is a BARE QUERY STRING, deleted outright. See the server's note. */
const QUERY_KEY_RE = /(^|\.)(query|query_string|search|querystring)$/i

/** The portal token IS the credential, so it goes wherever it is embedded. */
const PORTAL_TOKEN_RE = /(\/portal\/)[^/?#\s]+/g

const MAX_URL_LEN = 300
const MAX_DEPTH = 8

/** Strip a client-portal token out of any string that might embed one. */
export function redactPortalToken(value: unknown): string {
  return String(value ?? '').replace(PORTAL_TOKEN_RE, '$1<redacted>')
}

/**
 * A URL reduced to what is safe to write down: PATH ONLY, portal token redacted.
 *
 * The query is dropped wholesale rather than filtered. On this panel the query is where
 * the filter state lives (lib/filters.ts) — harmless today, but "which parameters are
 * secret" is a list that goes stale, and the failure mode of getting it wrong is a
 * credential in a bug report. Dropping all of it has no such failure mode.
 */
export function redactUrl(url: unknown): string {
  const raw = String(url ?? '')
  // `split` always yields at least one element, but tsconfig has noUncheckedIndexedAccess,
  // so the fallbacks are for the type checker rather than for a reachable case.
  const path = (raw.split('#')[0] ?? '').split('?')[0] ?? ''
  return redactPortalToken(path).slice(0, MAX_URL_LEN)
}

/** Walk any Sentry payload and strip it in place. Generic, so it survives SDK additions. */
function deepScrub(node: unknown, depth: number): void {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === 'string') node[i] = redactPortalToken(node[i])
      else deepScrub(node[i], depth + 1)
    }
    return
  }

  const record = node as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (SECRET_KEY_RE.test(key) || QUERY_KEY_RE.test(key)) {
      delete record[key]
      continue
    }
    const value = record[key]
    if (typeof value === 'string') {
      record[key] = URL_KEY_RE.test(key) ? redactUrl(value) : redactPortalToken(value)
    } else {
      deepScrub(value, depth + 1)
    }
  }
}

/**
 * `beforeSend` / `beforeSendTransaction`. Returns the same object, mutated.
 *
 * The explicit deletes are the ones the generic walk cannot infer: `data` is the request
 * body, `cookies` the parsed jar, `query_string` a plain string under a harmless-looking
 * key. `user.username`/`name` go because an id is meaningless outside our database and a
 * name is not.
 */
export function scrubEvent<T>(event: T): T {
  if (!event || typeof event !== 'object') return event

  const e = event as Record<string, unknown>
  const request = e.request as Record<string, unknown> | undefined
  if (request) {
    delete request.data
    delete request.cookies
    delete request.query_string
  }
  const user = e.user as Record<string, unknown> | undefined
  if (user) {
    delete user.username
    delete user.ip_address
    delete user.name
  }

  deepScrub(event, 0)
  return event
}

/** `beforeSendLog`. Attribute values are flat, so key-name filtering is the whole job. */
export function scrubLogAttributes(
  attributes: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (SECRET_KEY_RE.test(key)) continue
    out[key] = typeof value === 'string' ? redactPortalToken(value) : value
  }
  return out
}

/**
 * `beforeBreadcrumb`. Returns null to DROP the crumb.
 *
 * A portal request is dropped rather than redacted: the crumb's only content is the URL,
 * and without the token it says nothing the transaction does not already say.
 */
export function scrubBreadcrumb<T>(breadcrumb: T): T | null {
  if (!breadcrumb || typeof breadcrumb !== 'object') return breadcrumb
  const data = (breadcrumb as Record<string, unknown>).data as Record<string, unknown> | undefined
  const url = data?.url
  if (typeof url === 'string' && url.includes('/portal/')) return null
  deepScrub(breadcrumb, 0)
  return breadcrumb
}

/** The denylist source, exported so web/scripts/check.mjs can prove the mirror holds. */
export const SCRUB_PATTERNS = {
  secretKey: SECRET_KEY_RE.source,
  urlKey: URL_KEY_RE.source,
  queryKey: QUERY_KEY_RE.source,
  portalToken: PORTAL_TOKEN_RE.source,
} as const
