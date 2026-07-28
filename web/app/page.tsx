'use client'

import { useTranslations } from 'next-intl'

export default function DashboardPage() {
  const t = useTranslations('home')

  return (
    <>
      <h1>{t('heading')}</h1>
      <p className="lede">{t('intro')}</p>

      <section aria-labelledby="scaffold-heading">
        <h2 id="scaffold-heading">{t('scaffoldHeading')}</h2>
        <p>{t('scaffoldBody')}</p>
      </section>
    </>
  )
}
