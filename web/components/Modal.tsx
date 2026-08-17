'use client'

import { useTranslations } from 'next-intl'
import { type ReactNode, useId } from 'react'
import { useOverlay } from '@/lib/useOverlay'

export type ModalProps = {
  open: boolean
  onClose: () => void
  /** Becomes the dialog's accessible name. */
  title: string
  /** Action buttons, already translated. */
  footer?: ReactNode
  /**
   * id of the element that describes the dialog, exposed as aria-describedby. ConfirmModal
   * passes the id of its body paragraph; a destructive confirmation whose consequence is
   * only visible on screen is a confirmation a screen-reader user answers blind.
   */
  describedBy?: string
  busy?: boolean
  children: ReactNode
}

/**
 * A small centred dialog. Same focus contract as Drawer (lib/useOverlay.ts): focus in on
 * open, trapped while open, restored on close, Escape and the scrim both close.
 *
 * Use it for a short, self-contained exchange. It is NOT the place for anything the user has
 * to read while looking at the row it belongs to — the fresh enrolment code stays an inline
 * panel next to its row for exactly that reason: the director reads it aloud over the phone
 * while looking at that person's name, and a centred modal covers the row.
 */
export function Modal({ open, onClose, title, footer, describedBy, busy, children }: ModalProps) {
  const t = useTranslations('overlay')
  const titleId = useId()
  const ref = useOverlay<HTMLDivElement>(open, onClose)

  if (!open) return null

  return (
    <>
      <button type="button" className="scrim" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <div className="body">
          <h2 id={titleId}>{title}</h2>
          {children}
        </div>
        <footer>
          {footer ?? (
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {t('close')}
            </button>
          )}
        </footer>
      </div>
    </>
  )
}
