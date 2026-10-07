import type { Metadata } from 'next'
import { createTranslator } from 'next-intl'
import { LandingPage } from '@/components/LandingPage'
import { DEFAULT_LOCALE, MESSAGES } from '@/lib/locale'

const t = createTranslator({ locale: DEFAULT_LOCALE, messages: MESSAGES[DEFAULT_LOCALE] })

// The public landing page. The root layout marks the whole app noindex (the admin is an
// internal tool); this is the one route that is meant to be found.
export const metadata: Metadata = {
  title: t('landing.metaTitle'),
  description: t('landing.metaDescription'),
  robots: { index: true, follow: true },
}

export default function RootPage() {
  return <LandingPage />
}
