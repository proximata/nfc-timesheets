'use client'

import { useTranslations } from 'next-intl'
import { useId } from 'react'
import { useLocaleSetting } from '@/components/IntlProvider'
import { isLocale, LOCALES } from '@/lib/locale'

/** Proves the locale swap end-to-end: one control, one provider, every string re-renders. */
export function LocaleSwitcher() {
  const t = useTranslations('locale')
  const { locale, setLocale } = useLocaleSetting()
  const id = useId()

  return (
    <div className="locale-switcher">
      <label htmlFor={id}>{t('label')}</label>
      <select
        id={id}
        value={locale}
        onChange={(event) => {
          if (isLocale(event.target.value)) setLocale(event.target.value)
        }}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {t(code)}
          </option>
        ))}
      </select>
    </div>
  )
}
