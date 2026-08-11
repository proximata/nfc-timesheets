import type { Metadata } from 'next'
import { createTranslator } from 'next-intl'
import type { ReactNode } from 'react'
import { AppShell } from '@/components/AppShell'
import { IntlProvider } from '@/components/IntlProvider'
import { ResponsiveTableLabels } from '@/components/ResponsiveTableLabels'
import { DEFAULT_LOCALE, htmlLang, MESSAGES } from '@/lib/locale'
import './globals.css'

// Metadata is emitted once at build time into static HTML, so it can only ever use the
// build-time default locale. `createTranslator` is next-intl's non-hook API — no request
// config, no server runtime, which is what `output: 'export'` allows (decision-16).
const t = createTranslator({ locale: DEFAULT_LOCALE, messages: MESSAGES[DEFAULT_LOCALE] })

export const metadata: Metadata = {
  title: t('meta.title'),
  description: t('meta.description'),
  // Internal payroll tool. Never index, even if the VM is publicly reachable.
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  // Static export prerenders with the build-time default locale; IntlProvider rewrites
  // document.documentElement.lang on the client when the active locale changes.
  return (
    <html lang={htmlLang(DEFAULT_LOCALE)}>
      <body>
        <IntlProvider>
          {/* decision-28: the panel works on a phone; there is no desktop-only blocker. */}
          <ResponsiveTableLabels />
          <AppShell>{children}</AppShell>
        </IntlProvider>
      </body>
    </html>
  )
}
