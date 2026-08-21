'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useRef } from 'react'
import { FUTURE_NAV, NAV_GROUPS } from '@/lib/nav'

const FUTURE_HINT_ID = 'nav-future-hint'

export function SidebarNav() {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const navRef = useRef<HTMLElement>(null)

  /**
   * PHONE #6 (LOOK-PHONE.md): below 768px `.sidebar` becomes a horizontally scrolling strip
   * (globals.css) that always opened scrolled to its LEFT edge, showing "Übersicht·Schichten"
   * regardless of which of the nine entries was current — on seven of nine screens the
   * `aria-current="page"` mark was 300–500px off to the right, out of view. A screen reader
   * was told (`aria-current` is rendered); a director looking at the screen was not.
   *
   * `scrollIntoView({ inline: 'nearest' })` is a no-op when the link is already visible —
   * on desktop, where `.sidebar` never scrolls at all, this runs and changes nothing. `block:
   * 'nearest'` for the same reason on the vertical axis: the strip's OWN vertical position
   * must never move, only its horizontal scroll offset.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is not read inside; it is the TRIGGER. The element to scroll to is found fresh off the DOM (aria-current) on every run, not derived from pathname, because NAV_GROUPS already maps hrefs to labels in lib/nav.ts and re-deriving that here would be a second copy of it.
  useEffect(() => {
    const current = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [pathname])

  return (
    <nav className="sidebar" aria-label={t('primaryLabel')} ref={navRef}>
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
