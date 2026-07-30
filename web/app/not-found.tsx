'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'

/**
 * The one user-visible string this app did not own. Without this file Next.js renders its
 * built-in "404: This page could not be found." — hardcoded English, no message key — into
 * out/404.html and out/_not-found/index.html, inside an otherwise fully German shell
 * (decision-8). A mistyped URL was therefore the only way to see English in a German build.
 *
 * ponytail: a heading, a sentence and a link. It renders inside the normal AppShell, so the
 * nav is already there to click; the link exists because a 404 that offers no way out is a
 * dead end for someone who does not think in URLs.
 */
export default function NotFoundPage() {
  const t = useTranslations('notFound')

  return (
    <>
      <h1>{t('heading')}</h1>
      <p className="lede">{t('body')}</p>
      <p>
        <Link href="/">{t('back')}</Link>
      </p>
    </>
  )
}
