'use client'

import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState } from 'react'
import { ApiError, changePassword } from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'

/**
 * The admin's own account. One job: change the password.
 *
 * There is deliberately no "reset by email" here. The admin identity is a USERNAME, not an
 * address (the login route never validated the field as an email and now the form does not
 * pretend it is one), and this deployment has no outbound mail. A reset link we cannot send
 * is a dead end that looks like a feature. Recovery is the operator, on the machine, and
 * that is written down rather than implied.
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
    <section>
      <h1>{t('heading')}</h1>
      <p className="lede">{t('question')}</p>

      <form className="auth-form" onSubmit={onSubmit} style={{ maxWidth: '28rem' }}>
        <label htmlFor={currentId}>{t('current')}</label>
        <input
          id={currentId}
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />

        <label htmlFor={nextId}>{t('next')}</label>
        <input
          id={nextId}
          name="next"
          type="password"
          autoComplete="new-password"
          minLength={MIN}
          required
          aria-describedby={statusId}
        />

        <label htmlFor={repeatId}>{t('repeat')}</label>
        <input
          id={repeatId}
          name="repeat"
          type="password"
          autoComplete="new-password"
          minLength={MIN}
          required
        />

        <p className="hint">{t('hint', { min: MIN })}</p>

        <button type="submit" disabled={state.kind === 'saving'}>
          {state.kind === 'saving' ? t('saving') : t('submit')}
        </button>

        {/* One live region for both outcomes, so a screen reader announces either without
            the page reflowing differently for success and failure. */}
        <p id={statusId} role="status" aria-live="polite" className="form-status">
          {state.kind === 'done' ? t('done') : state.kind === 'error' ? state.text : ''}
        </p>
      </form>
    </section>
  )
}
