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
  { href: '/payroll/', labelKey: 'payroll' },
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

/** decision-7: below this viewport width the admin UI is replaced by a blocker. */
export const DESKTOP_MIN_WIDTH_PX = 1024
