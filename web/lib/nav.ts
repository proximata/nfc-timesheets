import type { NavKey } from '@/lib/locale'

export type NavItem = {
  href: string
  labelKey: NavKey
}

/** Live screens. Built by TASK-15..22. */
export const PRIMARY_NAV: readonly NavItem[] = [
  { href: '/', labelKey: 'dashboard' },
  { href: '/shifts/', labelKey: 'shifts' },
  { href: '/workers/', labelKey: 'workers' },
  { href: '/locations/', labelKey: 'locations' },
  { href: '/clients/', labelKey: 'clients' },
  { href: '/payroll/', labelKey: 'payroll' },
  { href: '/inventory/', labelKey: 'inventory' },
]

/** v2 roadmap stubs (TASK-24). Rendered locked, never navigable. No pages exist. */
export const FUTURE_NAV: readonly NavKey[] = [
  'materialRequests',
  'plDashboard',
  'contractManagement',
  'buildingAnalytics',
]

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

/** decision-7: below this viewport width the admin UI is replaced by a blocker. */
export const DESKTOP_MIN_WIDTH_PX = 1024
