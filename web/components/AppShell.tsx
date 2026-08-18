'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { HeaderTools } from '@/components/HeaderTools'
import { SidebarNav } from '@/components/SidebarNav'
import { LOGIN_PATH } from '@/lib/nav'
import { isClientPortalPath } from '@/lib/portal'

/** Landmarks: banner, navigation, main, contentinfo. Skip link targets #main-content. */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations()
  const pathname = usePathname()

  // The client portal gets NO admin chrome at all — no brand link home, no sidebar, no sign
  // out, no language switcher, and above all no link that leads into the admin app. The
  // person reading it works for another company. It renders its own <main>, so this returns
  // the children untouched.
  if (isClientPortalPath(pathname)) return <>{children}</>

  // The sign-in screen gets no chrome: navigating an admin sidebar or pressing "sign out"
  // before there is a session is noise at best and a 401 at worst.
  if (pathname === LOGIN_PATH || pathname === '/login') {
    return (
      <main id="main-content" className="auth-main">
        {children}
      </main>
    )
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t('a11y.skipToContent')}
      </a>

      <header className="app-header">
        <Link className="brand" href="/">
          <span className="brand-name">{t('app.brand')}</span>
          <span className="brand-suffix">{t('app.brandSuffix')}</span>
        </Link>
      </header>

      <SidebarNav />

      {/* Darstellung, Sprache and Abmelden. A SIBLING of the header rather than a child of
          it, because the two have to occupy different grid areas at the two widths: the
          top-right of the header at the desk, and the right of the NAVIGATION row on a
          phone, where they cost no vertical pixels at all. It comes after <SidebarNav /> in
          the DOM so the tab and reading order match the phone layout, which is the one that
          was broken — at desktop width the header row is a single visual line either way.
          See components/HeaderTools.tsx for the measurement that moved it. */}
      <HeaderTools />

      {/* tabIndex -1 so the skip link actually moves focus, not just the scroll position. */}
      <main id="main-content" className="content" tabIndex={-1}>
        {children}
      </main>

      <footer className="app-footer">
        <p>{t('footer.note')}</p>
      </footer>
    </div>
  )
}
