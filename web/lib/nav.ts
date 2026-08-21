import type { NavKey } from '@/lib/locale'

export type NavItem = {
  href: string
  labelKey: NavKey
}

/**
 * Group headings. Real `nav.*` message keys since the redesign fragments were folded into
 * de.json/en.json, so a typo here fails `pnpm typecheck` like any other key.
 */
export type NavGroupKey = Extract<
  NavKey,
  'groupToday' | 'groupMasterData' | 'groupReports' | 'groupAccount'
>

export type NavGroup = {
  headingKey: NavGroupKey
  /** true → the heading is `.visually-hidden`. It is still a real, named group. */
  hidden?: boolean
  /** true → pushed to the bottom of the sidebar with margin-top:auto. */
  pinBottom?: boolean
  items: readonly NavItem[]
}

/**
 * NINE destinations, down from twelve (decision-39). Order is still the order the director
 * works through them: what is happening now, then the records behind it, then the money,
 * then himself.
 *
 * /material-requests/ stays TOP-LEVEL and is deliberately not filed under Stammdaten: a
 * worker is standing in a building WAITING on that queue, which makes it a today problem,
 * not a catalogue one.
 *
 * THREE ROUTES LEFT THIS LIST AND NONE OF THEM WAS DELETED. `/contracts/`, `/analytics/`
 * and `/inventory/` are object-scoped or catalogue-scoped: no ranked journey starts by
 * opening one of them cold, and every one of them is now reached from the object that needs
 * it, carrying that object's id. A route nobody can reach is a deleted feature, so the ways
 * in are named here and asserted by `pnpm check` ("every non-nav route keeps a way in"),
 * which goes red if the last one is removed:
 *
 *   /contracts/   ← Objektpanel · /pl/ flagged row · /pl/ methodNoContract ·
 *                   /locations/ contract cell · /analytics/ panel
 *   /analytics/   ← Objektpanel
 *   /inventory/   ← /material-requests/ panel action · /material-requests/ drawer hint
 *
 * REVERSIBLE IN A MINUTE: this is one array, and putting an entry back is one line. It is
 * taste, and it is recorded as taste in IA-PLAN §2.2.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    headingKey: 'groupToday',
    hidden: true,
    items: [
      { href: '/', labelKey: 'dashboard' },
      { href: '/shifts/', labelKey: 'shifts' },
      { href: '/material-requests/', labelKey: 'materialRequests' },
    ],
  },
  {
    headingKey: 'groupMasterData',
    items: [
      { href: '/workers/', labelKey: 'workers' },
      { href: '/locations/', labelKey: 'locations' },
      { href: '/clients/', labelKey: 'clients' },
    ],
  },
  {
    headingKey: 'groupReports',
    items: [
      { href: '/payroll/', labelKey: 'payroll' },
      { href: '/pl/', labelKey: 'plDashboard' },
    ],
  },
  {
    headingKey: 'groupAccount',
    hidden: true,
    pinBottom: true,
    items: [{ href: '/account/', labelKey: 'account' }],
  },
]

/**
 * Routes that exist, are reachable, and are deliberately NOT in the sidebar (decision-39).
 *
 * Kept as data, not as a comment, because `pnpm check` reads it: each of these must keep at
 * least one inbound link from a screen that is not itself.
 */
export const OFF_NAV_ROUTES: readonly string[] = [
  '/contracts/',
  '/analytics/',
  '/inventory/',
  '/operators/',
  /**
   * Was reachable by URL only (LOOK.md C1 / LOOK-PHONE.md #2): named in neither this list
   * nor NAV_GROUPS, so `pnpm check`'s "every non-nav route keeps a way in" guard never
   * looked at it — a vacuous check, the fifth one this project has shipped. Way in:
   * /locations/ panel header, same treatment as /operators/ on /workers/.
   */
  '/tags/',
]

/**
 * Derived, and kept so nothing that imports the flat list breaks. One line, and it removes
 * the temptation to grep-and-replace across files owned by other agents.
 */
export const PRIMARY_NAV: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items)

/**
 * Roadmap stubs: rendered locked and never navigable, so a director can see what is coming
 * without clicking into a 404.
 *
 * EMPTY, and the empty case is load-bearing: everything that was here shipped. SidebarNav
 * renders the whole "Kommt später" block only when this has entries, because a heading
 * over an empty list reads as a screen that failed to load. Adding a key here is still the
 * way to announce a future screen — the machinery is intact, it just has nothing to say.
 */
export const FUTURE_NAV: readonly NavKey[] = []

/** The sign-in screen. Rendered without the admin shell (no nav, no sign-out control). */
export const LOGIN_PATH = '/login/'

/**
 * Where a 401/403 sends the director: `/login/`, carrying the screen and filters he was on
 * (C6, LOOK.md). Before this, every `handleAuthLoss` sent him to a bare `LOGIN_PATH` and the
 * period he had open — payroll's month, shifts' filters — was gone once he signed back in.
 *
 * `window.location`, not `usePathname`/`useSearchParams`: this is a static export
 * (decision-16) and the latter forces a Suspense boundary on every screen that calls it
 * (lib/filters.ts already made this call for the filter params themselves).
 */
export function loginPathWithReturn(): string {
  if (typeof window === 'undefined') return LOGIN_PATH
  const here = window.location.pathname + window.location.search
  if (!here || here === LOGIN_PATH) return LOGIN_PATH
  return `${LOGIN_PATH}?returnTo=${encodeURIComponent(here)}`
}

/**
 * Only a same-origin, path-absolute return target is honoured (`/payroll/?period=lastMonth`,
 * never `//evil.example/` or a bare `evil.example`, which a browser treats as protocol-
 * relative) - this value comes off the URL bar, which is not a trusted input.
 */
function safeReturnTo(raw: string | null): string | null {
  if (!raw?.startsWith('/') || raw.startsWith('//')) return null
  return raw
}

/**
 * The other end of `loginPathWithReturn`: what `/login/` reads back off its own URL.
 * Lives here, not on the login page, so "read the query string directly" stays a violation
 * `pnpm check` catches on every `app/*` page (decision-38/39) without an exception carved
 * out for this one screen.
 */
export function returnToFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  return safeReturnTo(new URLSearchParams(window.location.search).get('returnTo'))
}

/**
 * The one page a NON-EMPLOYEE ever opens: a client's point of contact reading their own
 * building's cleaning record. It is deliberately NOT in PRIMARY_NAV and there is no link to
 * it from the admin app — it is reached only through the link the director sends.
 *
 * It gets no admin chrome and, unlike every other screen, no desktop guard: see
 * components/AppShell.tsx and components/DesktopOnlyGuard.tsx. Link shape: lib/portal.ts.
 */
export const CLIENT_PORTAL_PATH = '/reinigung/'
