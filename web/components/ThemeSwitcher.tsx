'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useId, useState } from 'react'
import {
  applyTheme,
  isThemeSetting,
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
  const id = useId()
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
    <div className="theme-switcher">
      <label htmlFor={id}>{t('label')}</label>
      <select
        id={id}
        value={setting ?? 'system'}
        onChange={(event) => {
          const next = event.target.value
          if (!isThemeSetting(next)) return
          storeTheme(next)
          setSetting(next)
        }}
      >
        {THEME_SETTINGS.map((value) => (
          <option key={value} value={value}>
            {t(value)}
          </option>
        ))}
      </select>
    </div>
  )
}
