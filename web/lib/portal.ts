import type { Locale } from '@/lib/locale'
import { CLIENT_PORTAL_PATH } from '@/lib/nav'

/**
 * The client-facing cleaning record: how the shared link is shaped, and how the page reads
 * the token back out of it.
 *
 * `POST /admin/portal-grants` answers with `path: "/portal/<token>"`, but that path is the
 * JSON API route — a browser opening it gets a JSON body, not a page. The page a client
 * contact opens is this static export's `/reinigung/`, which fetches `/portal/<token>`
 * itself. So the admin panel must hand out THIS url, never the API path.
 *
 * The token travels in the URL FRAGMENT, not in a query string. A fragment is never put on
 * the wire: it reaches no access log, no reverse proxy, no `Referer` header and no link
 * preview crawler that a messaging app runs on a pasted URL. Since the token IS the
 * credential (server/routes/portal.js), that is worth the two extra lines. A query string
 * is still ACCEPTED on read, so a link mangled by a mail client that drops `#` still works.
 */

/** Same shape the server enforces: 32 CSPRNG bytes as base64url. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

/** The fragment/query key. One letter, because the director sees the whole URL. */
const TOKEN_KEY = 'k'

/**
 * The portal is always German: the reader is an Austrian client contact, not the director,
 * and there is no language switcher on that page to correct a wrong guess (decision-8).
 */
export const CLIENT_PORTAL_LOCALE: Locale = 'de'

/** `trailingSlash: true` gives `/reinigung/`; Next's router reports it without the slash. */
export function isClientPortalPath(pathname: string | null): boolean {
  return pathname === CLIENT_PORTAL_PATH || pathname === CLIENT_PORTAL_PATH.replace(/\/$/, '')
}

/**
 * `origin` + `"/portal/<token>"` -> the link to send the contact. Returns `null` if the
 * response path is not the shape documented above, so a changed API can never make the
 * admin panel hand out a URL that silently does not work.
 */
export function clientPortalUrl(origin: string, apiPath: string): string | null {
  const token = /^\/portal\/([^/?#]+)$/.exec(apiPath)?.[1]
  if (token === undefined || !TOKEN_RE.test(token)) return null
  return `${origin}${CLIENT_PORTAL_PATH}#${TOKEN_KEY}=${token}`
}

/**
 * The token this page was opened with, or `null`.
 *
 * Shape-checked here, at the trust boundary, before anything is sent to the API: a garbage
 * fragment is answered from this page instead of turning into a request that spends the
 * caller's rate-limit budget. `null` and "unknown token" are shown identically anyway.
 */
export function portalTokenFrom(hash: string, search: string): string | null {
  const fromHash = new URLSearchParams(hash.replace(/^#/, '')).get(TOKEN_KEY)
  const token = fromHash ?? new URLSearchParams(search).get(TOKEN_KEY)
  return token !== null && TOKEN_RE.test(token) ? token : null
}
