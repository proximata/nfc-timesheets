'use client'

import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { DESKTOP_MIN_WIDTH_PX } from '@/lib/nav'

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
