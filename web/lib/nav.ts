import type { NavKey } from '@/lib/locale'

export type NavItem = {
  href: string
  labelKey: NavKey
}

/**
 * Live screens, in the order the director works through them: what is happening now, then
 * the records behind it, then the money.
 *
 * The four that used to sit in FUTURE_NAV are here now — /material-requests/, /pl/,
 * /contracts/ and /analytics/ exist and are navigable. Material requests sit next to
 * /shifts/ rather than next to /inventory/ on purpose: a worker is standing in a building
 * WAITING on that queue, which makes it a today problem, not a catalogue one.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  { href: '/', labelKey: 'dashboard' },
  { href: '/shifts/', labelKey: 'shifts' },
  { href: '/material-requests/', labelKey: 'materialRequests' },
  { href: '/workers/', labelKey: 'workers' },
  { href: '/locations/', labelKey: 'locations' },
  { href: '/clients/', labelKey: 'clients' },
  { href: '/inventory/', labelKey: 'inventory' },
  { href: '/contracts/', labelKey: 'contractManagement' },
  { href: '/payroll/', labelKey: 'payroll' },
  { href: '/pl/', labelKey: 'plDashboard' },
  { href: '/analytics/', labelKey: 'buildingAnalytics' },
  { href: '/account/', labelKey: 'account' },
]

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
 * The one page a NON-EMPLOYEE ever opens: a client's point of contact reading their own
 * building's cleaning record. It is deliberately NOT in PRIMARY_NAV and there is no link to
 * it from the admin app — it is reached only through the link the director sends.
 *
 * It gets no admin chrome and, unlike every other screen, no desktop guard: see
 * components/AppShell.tsx and components/DesktopOnlyGuard.tsx. Link shape: lib/portal.ts.
 */
export const CLIENT_PORTAL_PATH = '/reinigung/'
