'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { Field } from '@/components/Field'
import { ApiError, login } from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'
import { returnToFromLocation } from '@/lib/nav'

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
  // The screen he was reading and its filters (C6, LOOK.md) - so a successful sign-in
  // returns him to the period he lost, not to the dashboard.
  //
  // TWO READS, NOT ONE, AND THE SECOND IS THE LOAD-BEARING ONE. The initialiser alone was
  // what shipped, and it is WRONG on the only path a director ever takes. Measured on the
  // live box (demo/probe-c6-c5.mjs): a DIRECT load of `/login/?returnTo=…` showed the
  // sentence, and a 401 on `/payroll/?period=2026-07` — whose `handleAuthLoss` calls
  // `router.replace(loginPathWithReturn())` — ended on that exact URL with the sentence
  // ABSENT and then signed him back in to `/`. A `useState` initialiser runs DURING the
  // render that the client-side navigation triggers, and Next commits the new URL to
  // `window.history` after that render, so the browser's URL still held the OLD
  // screen's query string (`?period=2026-07`, no `returnTo`) and `safeReturnTo` returned
  // null. The bug was invisible to `demo/check-login-return.mjs` because that check calls
  // the two pure functions against a stubbed `window` and greps the screens' source: both
  // halves are correct, and the feature was still broken end to end.
  //
  // The effect runs after commit, when the browser's URL IS the new one, so it repairs the
  // navigated case; the initialiser still covers the direct-load and no-JS-yet case, and
  // keeps the sentence from flashing in one frame late there. Not `useSearchParams()`:
  // this is a static export and that hook forces a Suspense boundary (see the note on
  // `loginPathWithReturn` in lib/nav.ts).
  const [returnTo, setReturnTo] = useState<string | null>(() => returnToFromLocation())
  useEffect(() => {
    const fromUrl = returnToFromLocation()
    if (fromUrl !== null) setReturnTo(fromUrl)
  }, [])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')

    setPending(true)
    setError(null)
    try {
      await login(email, password)
      router.push(returnTo ?? '/')
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
      {/* Only when a 401/403 sent him here (loginPathWithReturn) - never on a first, cold
          visit, where it would be a lie. */}
      {returnTo !== null && <p className="lede">{t('sessionExpired')}</p>}
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
