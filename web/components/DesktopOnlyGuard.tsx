'use client'

import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { DESKTOP_MIN_WIDTH_PX } from '@/lib/nav'
import { isClientPortalPath } from '@/lib/portal'

/**
 * decision-7: desktop-first, no mobile layout. Below the breakpoint the admin UI is replaced
 * by a blocker message.
 *
 * ponytail: the swap is done in CSS (`globals.css`, `.desktop-only` / `.mobile-blocker`), not
 * with `matchMedia` state. `display: none` also removes a subtree from the accessibility tree,
 * so nothing leaks to a screen reader either, and a pure-CSS swap has no hydration mismatch
 * and no flash of the wrong branch on first paint. Ceiling: children still mount and would
 * still run their effects on a phone. If a screen ever starts a costly fetch on mount, add a
 * `useIsDesktop()` matchMedia hook and gate that screen's data layer with it — not this
 * component.
 */
export function DesktopOnlyGuard({ children }: { children: ReactNode }) {
  const t = useTranslations('desktopOnly')
  const pathname = usePathname()

  // DELIBERATE, SINGLE EXCEPTION TO decision-7. decision-7 makes the ADMIN panel desktop
  // only, because the director does payroll at a desk. The client portal is not the admin
  // panel and not the director: a client's point of contact opens that link out of a
  // WhatsApp or Outlook message, on a phone, and a blocker telling them to find a laptop
  // would make the feature useless for its only audience. That page is therefore built to
  // work at 320px and is exempt here. Nothing else is.
  if (isClientPortalPath(pathname)) return <>{children}</>

  return (
    <>
      <div className="mobile-blocker">
        <div className="mobile-blocker-card">
          <h1>{t('heading')}</h1>
          <p>{t('body')}</p>
          <p className="mobile-blocker-requirement">
            {t('requirement', { width: DESKTOP_MIN_WIDTH_PX })}
          </p>
        </div>
      </div>
      <div className="desktop-only">{children}</div>
    </>
  )
}
