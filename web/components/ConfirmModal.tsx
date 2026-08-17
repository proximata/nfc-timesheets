'use client'

import { useTranslations } from 'next-intl'
import { type ReactNode, useId } from 'react'
import { Modal } from '@/components/Modal'

export type ConfirmModalProps = {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  /** What happens if they say yes, in plain words. Named as the dialog's description. */
  body: ReactNode
  confirmLabel: string
  /** Defaults to the shared "Abbrechen". */
  cancelLabel?: string
  /** Irreversible → the confirm button carries the danger tint AND the word already says so. */
  destructive?: boolean
  /** True while the action is in flight; disables both buttons but never Escape. */
  busy?: boolean
}

/**
 * Plain yes/no for the irreversible: revoke an enrolment code, deactivate a worker,
 * deactivate a building, refuse a material request, delete a contact.
 *
 * It wraps Modal rather than duplicating it. It exists because five callers otherwise carry
 * the same ten lines of pending-action state, and because the destructive confirm is exactly
 * where an aria-describedby gets forgotten.
 *
 * The consequence goes in `body` as a SENTENCE. "Sind Sie sicher?" tells the reader nothing
 * they did not already know; "Der Code funktioniert danach nicht mehr" does.
 */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive,
  busy,
}: ConfirmModalProps) {
  const t = useTranslations('overlay')
  const bodyId = useId()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      describedBy={bodyId}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {cancelLabel ?? t('cancel')}
          </button>
          <button
            type="button"
            className={destructive ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p id={bodyId}>{body}</p>
    </Modal>
  )
}
