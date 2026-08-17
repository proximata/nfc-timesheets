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
 * Twelve flat entries became three visible groups plus two unlabelled blocks. ALL TWELVE
 * SURVIVE — nothing is hidden, nothing is behind a "more". Grouping is the fix for a
 * sidebar you read; hiding routes would be a different, worse screen.
 *
 * Order is still the order the director works through them: what is happening now, then the
 * records behind it, then the money, then himself.
 *
 * /material-requests/ stays TOP-LEVEL and is deliberately not filed under Stammdaten: a
 * worker is standing in a building WAITING on that queue, which makes it a today problem,
 * not a catalogue one.
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
      { href: '/contracts/', labelKey: 'contractManagement' },
      { href: '/inventory/', labelKey: 'inventory' },
    ],
  },
  {
    headingKey: 'groupReports',
    items: [
      { href: '/payroll/', labelKey: 'payroll' },
      { href: '/pl/', labelKey: 'plDashboard' },
      { href: '/analytics/', labelKey: 'buildingAnalytics' },
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
 * The one page a NON-EMPLOYEE ever opens: a client's point of contact reading their own
 * building's cleaning record. It is deliberately NOT in PRIMARY_NAV and there is no link to
 * it from the admin app — it is reached only through the link the director sends.
 *
 * It gets no admin chrome and, unlike every other screen, no desktop guard: see
 * components/AppShell.tsx and components/DesktopOnlyGuard.tsx. Link shape: lib/portal.ts.
 */
export const CLIENT_PORTAL_PATH = '/reinigung/'
