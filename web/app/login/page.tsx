'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState } from 'react'
import { Field } from '@/components/Field'
import { ApiError, login } from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'

/** `null` = no error. `'failed'` = bad credentials, deliberately indistinguishable causes. */
type LoginError = { kind: 'failed' } | { kind: 'api'; key: ErrorKey } | null

/**
 * Password sign-in for the admin panel (decision-20). Replaces the admin PIN entirely.
 *
 * The session is an httpOnly cookie set by the server, so this page never sees, stores or
 * forwards a credential after the request completes.
 *
 * This is the FIRST screen a new operator sees, and it renders outside the admin shell: no
 * nav, no sign-out, no locale switcher — navigating an admin sidebar before there is a
 * session is noise at best and a 401 at worst. So the card carries the product's own name
 * instead, which is the only thing here that says whose panel this is.
 *
 * THE FIELD IS A USERNAME. `type="text"` + `autoComplete="username"`, never `type="email"`:
 * the live identity is `schimmer`, and a browser that validates it as an address locks the
 * operator out of their own panel with a message we did not write.
 */
export default function LoginPage() {
  const t = useTranslations('login')
  const tApp = useTranslations('app')
  const tError = useTranslations('error')
  const router = useRouter()

  const emailId = useId()
  const passwordId = useId()
  const errorId = useId()

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<LoginError>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')

    setPending(true)
    setError(null)
    try {
      await login(email, password)
      router.push('/')
    } catch (cause) {
      // One message for every rejected credential — no "unknown user" vs "wrong password"
      // oracle. Only transport/server faults, which say nothing about the account, differ.
      if (cause instanceof ApiError && (cause.status === 0 || cause.status >= 500)) {
        setError({ kind: 'api', key: cause.messageKey })
      } else {
        setError({ kind: 'failed' })
      }
      setPending(false)
    }
  }

  const errorText = error === null ? '' : error.kind === 'failed' ? t('failed') : tError(error.key)

  return (
    <div className="auth-card">
      {/* Not a link: home is behind the session that does not exist yet. */}
      <p className="brand">
        <span className="brand-name">{tApp('brand')}</span>
        <span className="brand-suffix">{tApp('brandSuffix')}</span>
      </p>

      <h1>{t('heading')}</h1>
      <p className="lede">{t('intro')}</p>

      <form className="auth-form" onSubmit={onSubmit}>
        {/*
          Always in the DOM rather than mounted on failure: an assistive technology announces
          a text change inside an existing live region far more reliably than a node that
          appears and disappears. Empty until there is something to say.
        */}
        <p className="form-error" id={errorId} role="alert">
          {errorText}
        </p>

        {/* No required markers: both fields are mandatory, and a form where every field
            carries an asterisk has told the reader nothing. */}
        <Field id={emailId} label={t('email')}>
          <input
            name="email"
            type="text"
            autoComplete="username"
            required
            // biome-ignore lint/a11y/noAutofocus: single-purpose page, the form IS the page.
            autoFocus
            aria-describedby={errorId}
            aria-invalid={error !== null}
            disabled={pending}
          />
        </Field>

        <Field id={passwordId} label={t('password')}>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-describedby={errorId}
            aria-invalid={error !== null}
            disabled={pending}
          />
        </Field>

        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? t('submitting') : t('submit')}
        </button>
      </form>
    </div>
  )
}
