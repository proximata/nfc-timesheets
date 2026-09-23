import type { Metadata } from 'next'
import { createTranslator } from 'next-intl'
import type { ReactNode } from 'react'
import { DEFAULT_LOCALE, MESSAGES } from '@/lib/locale'

const t = createTranslator({ locale: DEFAULT_LOCALE, messages: MESSAGES[DEFAULT_LOCALE] })

export const metadata: Metadata = {
  title: t('landing.metaTitle'),
  description: t('landing.metaDescription'),
  robots: { index: true, follow: true },
}

export default function ProductLayout({ children }: { children: ReactNode }) {
  return children
}
