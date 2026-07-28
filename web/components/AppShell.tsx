'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'
import { LogoutButton } from '@/components/LogoutButton'
import { SidebarNav } from '@/components/SidebarNav'
import { LOGIN_PATH } from '@/lib/nav'

/** Landmarks: banner, navigation, main, contentinfo. Skip link targets #main-content. */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations()
  const pathname = usePathname()

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
        <div className="header-actions">
          <LocaleSwitcher />
          <LogoutButton />
        </div>
      </header>

      <SidebarNav />

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
