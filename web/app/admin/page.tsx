'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { loginPathWithReturn } from '@/lib/nav'
import { fetchAccount } from '@/lib/workspaces'

/**
 * `/admin/`, the admin's front door (`/` is the public landing page). Keeps bookmarked map
 * filters; plain `/admin/` opens the account's own workspace, or the sign-in screen.
 */
export default function AdminEntryPage() {
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
