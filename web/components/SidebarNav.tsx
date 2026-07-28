'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { FUTURE_NAV, PRIMARY_NAV } from '@/lib/nav'

const FUTURE_HINT_ID = 'nav-future-hint'

export function SidebarNav() {
  const t = useTranslations('nav')
  const pathname = usePathname()

  return (
    <nav className="sidebar" aria-label={t('primaryLabel')}>
      {/* Group labels are <p>, not headings: they sit inside the nav landmark and would
          otherwise put an h2 ahead of the page's h1 in DOM order. aria-labelledby gives the
          lists the same grouping semantics without touching the heading outline. */}
      <p className="nav-heading" id="nav-primary-heading">
        {t('primaryHeading')}
      </p>
      <ul className="nav-list" aria-labelledby="nav-primary-heading">
        {PRIMARY_NAV.map((item) => {
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

      <p className="nav-heading" id="nav-future-heading">
        {t('futureHeading')}
      </p>
      {/*
        aria-disabled rather than `disabled`: a `disabled` button is removed from the tab order,
        so a keyboard user would never learn these roadmap items exist. This stays focusable and
        announces itself as disabled. There is no click handler because there is nothing to do.
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
    </nav>
  )
}
