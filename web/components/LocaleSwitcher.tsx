'use client'

import { useTranslations } from 'next-intl'
import { useLocaleSetting } from '@/components/IntlProvider'
import { PreferenceSegments } from '@/components/PreferenceSegments'

/** Proves the locale swap end-to-end: one control, one provider, every string re-renders. */
export function LocaleSwitcher() {
  const t = useTranslations('locale')
  const { locale, setLocale } = useLocaleSetting()

  return (
    <PreferenceSegments
      label={t('label')}
      value={locale}
      onChange={setLocale}
      options={(['de', 'en'] as const).map((code) => ({
        value: code,
        label: t(code),
        content: code.toUpperCase(),
      }))}
    />
  )
}
