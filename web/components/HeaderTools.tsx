'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useId, useState } from 'react'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'
import { LogoutButton } from '@/components/LogoutButton'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'

/**
 * DARSTELLUNG · SPRACHE · ABMELDEN — the three controls a director touches once, kept
 * reachable everywhere and kept OUT of the top of a phone screen.
 *
 * WHAT IT COST BEFORE. At 390x844 these three held y=52…156 of the header, the header was
 * 169px tall, and the first building name — the first fact on the landing screen — was at
 * y=759 of an 844px viewport (`demo/probe-first-fact.mjs`, and the measurement is in
 * backlog/docs/STATE-GALLERY.md §2 B3). The screen the daily check happens on spent 90 % of
 * its fold on a brand, two settings and a sign-out button.
 *
 * WHAT CHANGED, and it is a MOVE and a COLLAPSE, never a deletion (TASK-179 is explicit:
 * do not delete either control):
 *
 *   ≥768px  unchanged. The three sit in the top-right of the header exactly as before; the
 *           disclosure button is `display: none` and nothing is behind a click.
 *   ≤767px  they move OUT of the header and into the navigation row, on the right of the
 *           nav strip, behind one 44px „Einstellungen" button. The row already existed, so
 *           the whole group now costs ZERO extra vertical pixels, and the header is the
 *           brand alone.
 *
 * IT IS NOT A DIALOG and does not pretend to be one: no focus trap, no scrim, no
 * `role="dialog"`. It is a disclosure — `aria-expanded` + `aria-controls` — and the panel is
 * absolutely positioned so opening it does not push the page the reader is reading. Escape
 * closes it, because a control that can be opened and not dismissed from the keyboard is the
 * complaint the overlay contract in lib/useOverlay.ts exists to answer. Focus is NOT moved
 * on open: the first thing inside is a `<select>`, and landing on it would make a stray
 * arrow key change the theme.
 *
 * ponytail: closing on an outside click is not implemented. CEILING: the panel stays open
 * until Escape, the button, or a navigation. UPGRADE PATH: the same `pointerdown` listener
 * lib/useOverlay.ts already has, lifted out of it — not worth the shared abstraction for one
 * caller, and a settings panel left open costs nothing.
 */
export function HeaderTools() {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    // Capture, for the reason lib/useOverlay.ts gives: a native <select> swallows Escape,
    // and the control that opens this panel must not be able to disable the way out of it.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  return (
    <div className="header-tools">
      <button
        type="button"
        className="btn btn-ghost header-tools-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
      >
        <span aria-hidden="true">⚙</span> {t('app.settings')}
      </button>

      {/* Always in the DOM and always in the tab order at desktop width. On a phone it is
          hidden with `hidden`, not with `visibility`, so a closed panel is out of the
          accessibility tree and out of the tab order — the mistake the map info box made
          with `overflow: hidden` and paid for with ten unreachable links. */}
      <div className="header-actions" id={panelId} data-open={open ? 'yes' : 'no'}>
        {/* System / Dunkel / Hell. The attribute it writes is already on <html> before
            first paint — the inline script in app/layout.tsx. */}
        <ThemeSwitcher />
        <LocaleSwitcher />
        <LogoutButton />
      </div>
    </div>
  )
}
