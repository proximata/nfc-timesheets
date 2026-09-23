'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { loginPathWithReturn } from '@/lib/nav'
import { fetchAccount } from '@/lib/workspaces'

/** Keep bookmarked map filters; plain home opens the account's own workspace. */
export default function HomePage() {
  const router = useRouter()
  const t = useTranslations('home')
  useEffect(() => {
    const controller = new AbortController()
    void fetchAccount(controller.signal)
      .then(({ admin }) => {
        const query = window.location.search
        router.replace(
          admin.role === 'superadmin'
            ? '/platform/'
            : admin.role === 'flags'
              ? '/flags/'
              : query
                ? `/map/${query}`
                : '/workspace/',
        )
      })
      .catch(() => {
        if (!controller.signal.aborted) router.replace(loginPathWithReturn())
      })
    return () => controller.abort()
  }, [router])
  return <p role="status">{t('loading')}</p>
}
