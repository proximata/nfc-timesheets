'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { logout } from '@/lib/api'
import { LOGIN_PATH } from '@/lib/nav'

/**
 * Sign out. The session lives in an httpOnly cookie, so only the server can revoke it —
 * but a failed call must not strand the user in a shell they can no longer use, so the
 * redirect to the login screen happens either way.
 */
export function LogoutButton() {
  const t = useTranslations('login')
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      className="button-secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await logout()
        } catch {
          // Already signed out, or the server is unreachable. Either way: go to sign-in.
        }
        router.push(LOGIN_PATH)
      }}
    >
      {t('logout')}
    </button>
  )
}
