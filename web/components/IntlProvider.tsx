'use client'

import { usePathname } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { DEFAULT_LOCALE, htmlLang, isLocale, type Locale, MESSAGES } from '@/lib/locale'
import { CLIENT_PORTAL_LOCALE, isClientPortalPath } from '@/lib/portal'

const STORAGE_KEY = 'nfcts.locale'

type LocaleSetting = {
  locale: Locale
  setLocale: (locale: Locale) => void
}

// next-intl's own `useLocale()` reads the locale but cannot change it. This context is the
// setter half, and nothing else.
const LocaleSettingContext = createContext<LocaleSetting>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
})

/**
 * Wraps the app in next-intl and keeps `<html lang>` in sync with the active locale.
 *
 * The first render always uses DEFAULT_LOCALE so the prerendered static HTML and the first
 * client render agree (no hydration mismatch). A stored preference is applied in an effect
 * straight after mount.
 */
export function IntlProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)
  const pathname = usePathname()

  // The client portal is pinned to German and ignores both the build-time default and the
  // admin's stored preference: its reader is an Austrian client contact who never chose a
  // language and has no switcher to correct one (decision-8). The admin's own preference is
  // left untouched in storage, so switching screens does not reset it.
  const active = isClientPortalPath(pathname) ? CLIENT_PORTAL_LOCALE : locale

  useEffect(() => {
    // Mount-only: read the persisted preference exactly once.
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isLocale(stored)) setLocaleState(stored)
  }, [])

  useEffect(() => {
    document.documentElement.lang = htmlLang(active)
  }, [active])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }, [])

  return (
    <LocaleSettingContext.Provider value={{ locale, setLocale }}>
      {/* timeZone is fixed: this is a single-city payroll tool (Vienna), and pinning it keeps
          any future date formatting identical between the prerender and the browser. */}
      <NextIntlClientProvider locale={active} messages={MESSAGES[active]} timeZone="Europe/Vienna">
        {children}
      </NextIntlClientProvider>
    </LocaleSettingContext.Provider>
  )
}

/** Read + change the active locale. Only the language switcher should need the setter. */
export function useLocaleSetting(): LocaleSetting {
  return useContext(LocaleSettingContext)
}
