'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { PreferenceSegments } from '@/components/PreferenceSegments'
import {
  applyTheme,
  readStoredTheme,
  storeTheme,
  THEME_SETTINGS,
  type ThemeSetting,
} from '@/lib/theme'

/**
 * System / Dunkel / Hell. Three states, because the OS preference wins until the director
 * says otherwise, and a two-state toggle cannot express "whatever the phone is doing".
 *
 * `setting` starts as null — "not read yet" — and NOTHING is applied while it is null. The
 * inline script in app/layout.tsx has already put the right attribute on <html> before first
 * paint; re-applying a default here before localStorage has been read would undo it for one
 * frame and produce exactly the white flash the inline script exists to prevent. It also
 * keeps the prerendered HTML and the first client render identical, so no hydration mismatch.
 */
export function ThemeSwitcher() {
  const t = useTranslations('theme')
  const [setting, setSetting] = useState<ThemeSetting | null>(null)

  useEffect(() => {
    setSetting(readStoredTheme())
  }, [])

  useEffect(() => {
    if (setting === null) return
    applyTheme(setting)
    if (setting !== 'system') return

    // Following the OS means following it while the page is open: macOS flips at sunset.
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: light)')
        : null
    if (!media) return
    const onChange = () => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [setting])

  return (
    <PreferenceSegments
      label={t('label')}
      value={setting ?? 'system'}
      onChange={(next) => {
        storeTheme(next)
        setSetting(next)
      }}
      options={THEME_SETTINGS.map((value) => ({
        value,
        label: t(value),
        content: (
          <>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {value === 'system' ? (
                <>
                  <rect x="3" y="4" width="18" height="13" rx="2" />
                  <path d="M8 21h8m-4-4v4" />
                </>
              ) : value === 'light' ? (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
                </>
              ) : (
                <path d="M20 15.5A9 9 0 0 1 8.5 4a9 9 0 1 0 11.5 11.5Z" />
              )}
            </svg>
            {t(value)}
          </>
        ),
      }))}
    />
  )
}
