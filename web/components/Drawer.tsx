'use client'

import { useTranslations } from 'next-intl'
import { type ReactNode, useId } from 'react'
import { useOverlay } from '@/lib/useOverlay'

export type DrawerProps = {
  open: boolean
  /** Called by Escape, by the scrim, and by the header's ✕. Never called by a save. */
  onClose: () => void
  /** The drawer's ONE job, in the user's language. Becomes the dialog's accessible name. */
  title: string
  /** Optional context line above the title: "Schritt 1 von 2", or whose shift this is. */
  step?: string
  /** The action buttons. Cancel first, primary last, both already translated. */
  footer?: ReactNode
  /** Marks the drawer busy while a save is in flight. Does NOT disable Escape. */
  busy?: boolean
  children: ReactNode
}

/**
 * WHERE EVERY WRITE HAPPENS. One drawer, one job — a drawer behind a mode flag is precisely
 * how two validation rules drift apart and start disagreeing about what a shift is.
 *
 * Focus moves in on open, is trapped while open and is restored on close: lib/useOverlay.ts.
 * The drawer is UNMOUNTED when closed, so nothing inside it is ever in the tab order of the
 * page behind it.
 *
 * Result messages do NOT live in here. Escape closes this at any moment, including mid-save,
 * and a message that closes with the thing it is reporting on has not been read. Put the
 * outcome in the page's own aria-live region.
 */
export function Drawer({ open, onClose, title, step, footer, busy, children }: DrawerProps) {
  const t = useTranslations('overlay')
  const titleId = useId()
  const ref = useOverlay(open, onClose)

  if (!open) return null

  return (
    <>
      {/*
        A button, not a div: a scrim that closes on click is a control, and Biome is right to
        insist a click target be one. aria-hidden + tabIndex -1 keeps it out of both the
        accessibility tree and the tab order, because the keyboard equivalent is Escape and a
        nameless "close" stop before every dialog is noise.
      */}
      <button type="button" className="scrim" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      <aside
        ref={ref}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <header>
          <div>
            {step ? <p className="step">{step}</p> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            <span aria-hidden="true">✕</span>
            <span className="visually-hidden">{t('close')}</span>
          </button>
        </header>
        <div className="body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </aside>
    </>
  )
}
