'use client'

import { useTranslations } from 'next-intl'

export function MicrosoftPlaceholder() {
  const t = useTranslations('integrations')
  return (
    <div className="callout">
      <button type="button" className="btn btn-ghost" aria-disabled="true">
        {t('microsoftSignIn')} · {t('soon')}
      </button>
      <p>{t('signInNote')}</p>
    </div>
  )
}
