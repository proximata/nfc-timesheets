'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { FUTURE_NAV, NAV_GROUPS } from '@/lib/nav'

const FUTURE_HINT_ID = 'nav-future-hint'

export function SidebarNav() {
  const t = useTranslations('nav')
  const pathname = usePathname()

  return (
    <nav className="sidebar" aria-label={t('primaryLabel')}>
      {NAV_GROUPS.map((group) => {
        const headingId = `nav-${group.headingKey}`
        const className = group.pinBottom ? 'nav-group nav-group-bottom' : 'nav-group'
        return (
          <div className={className} key={group.headingKey}>
            {/*
              Group labels are <p>, not headings: they sit inside the nav landmark and would
              otherwise put an h2 ahead of the page's h1 in DOM order. aria-labelledby gives
              the lists the same grouping semantics without touching the heading outline.

              A group with no visible label uses .visually-hidden and NEVER display:none —
              a hidden heading is still the group's accessible name.
            */}
            <p
              className={group.hidden ? 'nav-group-heading visually-hidden' : 'nav-group-heading'}
              id={headingId}
            >
              {t(group.headingKey)}
            </p>
            <ul className="nav-list" aria-labelledby={headingId}>
              {group.items.map((item) => {
                const current = pathname === item.href
                return (
                  <li key={item.href}>
                    <Link
                      className="nav-link"
                      href={item.href}
                      aria-current={current ? 'page' : undefined}
                    >
                      {t(item.labelKey)}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}

      {/* The whole block disappears when nothing is queued up. A "Kommt später" heading over
          an empty list reads as a sidebar that failed to load, which is the one impression a
          navigation must never give. See FUTURE_NAV in lib/nav.ts. */}
      {FUTURE_NAV.length === 0 ? null : (
        <div className="nav-group">
          <p className="nav-group-heading" id="nav-future-heading">
            {t('futureHeading')}
          </p>
          {/*
            aria-disabled rather than `disabled`: a `disabled` button is removed from the tab
            order, so a keyboard user would never learn these roadmap items exist. This stays
            focusable and announces itself as disabled. There is no click handler because
            there is nothing to do.
          */}
          <ul className="nav-list" aria-labelledby="nav-future-heading">
            {FUTURE_NAV.map((labelKey) => (
              <li key={labelKey}>
                <button
                  type="button"
                  className="nav-link nav-link-locked"
                  aria-disabled="true"
                  aria-describedby={FUTURE_HINT_ID}
                >
                  <span className="nav-lock" aria-hidden="true">
                    🔒
                  </span>
                  <span className="nav-label">{t(labelKey)}</span>
                  <span className="nav-tooltip" aria-hidden="true">
                    {t('futureTooltip')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p id={FUTURE_HINT_ID} className="visually-hidden">
            {t('futureTooltip')}
          </p>
        </div>
      )}
    </nav>
  )
}
