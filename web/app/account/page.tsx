'use client'

import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState } from 'react'
import { Field } from '@/components/Field'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
import { ApiError, changePassword } from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'

/**
 * The admin's own account. One job: change the password.
 *
 * The form is NOT in a drawer. A drawer exists to get a form off a screen that also has to
 * show a list; this screen has no list, so a drawer would put the only content on the page
 * one click behind an empty page.
 *
 * There is deliberately no "reset by email" here. The admin identity is a USERNAME, not an
 * address (the login route never validated the field as an email and the form does not
 * pretend it is one), and this deployment has no outbound mail. A reset link we cannot send
 * is a dead end that looks like a feature. Recovery is the operator, on the machine — and
 * that is now said on the screen (`noReset`) instead of only in this comment, because a
 * director hunting for "Passwort vergessen" deserves an answer rather than an absence.
 */
type State =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'done' }
  | { kind: 'error'; text: string }

const MIN = 5 // must match PASSWORD_MIN in server/routes/admin.js

export default function AccountPage() {
  const t = useTranslations('account')
  const tError = useTranslations('error')

  const currentId = useId()
  const nextId = useId()
  const repeatId = useId()
  const statusId = useId()

  const [state, setState] = useState<State>({ kind: 'idle' })

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const current = String(data.get('current') ?? '')
    const next = String(data.get('next') ?? '')
    const repeat = String(data.get('repeat') ?? '')

    // Checked here as well as on the server. The client check exists so a typo costs a
    // keystroke instead of a round trip; the server check is the one that is load-bearing.
    if (next.length < MIN) {
      setState({ kind: 'error', text: t('tooShort', { min: MIN }) })
      return
    }
    if (next !== repeat) {
      setState({ kind: 'error', text: t('mismatch') })
      return
    }

    setState({ kind: 'saving' })
    try {
      await changePassword(current, next)
      form.reset()
      setState({ kind: 'done' })
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setState({ kind: 'error', text: t('wrongCurrent') })
      } else if (cause instanceof ApiError && cause.status === 422) {
        setState({ kind: 'error', text: t('rejected') })
      } else {
        setState({
          kind: 'error',
          text: cause instanceof ApiError ? tError(cause.messageKey as ErrorKey) : t('rejected'),
        })
      }
    }
  }

  return (
    <>
      <PageHeader title={t('heading')} question={t('question')} />

      {/* A password form is a narrow column, not a page-wide panel: a 28rem form inside a
          1200px surface is the empty-container look this redesign is removing. */}
      <div style={{ maxWidth: '34rem' }}>
        <ListPanel title={t('formHeading')} padded>
          <form className="auth-form" onSubmit={onSubmit}>
            <Field id={currentId} label={t('current')} required>
              <input name="current" type="password" autoComplete="current-password" required />
            </Field>

            <Field id={nextId} label={t('next')} required help={t('hint', { min: MIN })}>
              <input
                name="next"
                type="password"
                autoComplete="new-password"
                minLength={MIN}
                required
                aria-describedby={statusId}
              />
            </Field>

            <Field id={repeatId} label={t('repeat')} required>
              <input
                name="repeat"
                type="password"
                autoComplete="new-password"
                minLength={MIN}
                required
              />
            </Field>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={state.kind === 'saving'}>
                {state.kind === 'saving' ? t('saving') : t('submit')}
              </button>
            </div>

            {/* One live region for both outcomes, so a screen reader announces either
                without the page reflowing differently for success and failure. The class
                changes with the outcome; the NODE does not, which keeps the region alive. */}
            <p
              id={statusId}
              role="status"
              aria-live="polite"
              className={state.kind === 'error' ? 'form-error' : 'form-status'}
            >
              {state.kind === 'done' ? t('done') : state.kind === 'error' ? state.text : ''}
            </p>
          </form>
        </ListPanel>

        {/* Stated, not implied. There is no control here to forget a password with, and this
            is why. It must never grow one: no outbound mail exists to send a link over.

            Behind a <details> and NOT deleted: as a permanent four-line paragraph it made
            /account/ the one screen the redesign left HEAVIER on a phone (858 → 1087px,
            REDESIGN-VISUAL.md). The summary is the exact phrase a director hunts for, so
            folding it also makes it findable instead of merely present. */}
        <details className="callout">
          <summary>{t('noResetHeading')}</summary>
          <p>{t('noReset')}</p>
        </details>
      </div>
    </>
  )
}
