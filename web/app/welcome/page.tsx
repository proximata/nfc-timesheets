'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type FormEvent, useEffect, useState } from 'react'
import { Field } from '@/components/Field'
import { useLocaleSetting } from '@/components/IntlProvider'
import {
  acceptWorkspaceInvitation,
  clearInvitationFragment,
  readInvitationFragment,
} from '@/lib/workspaces'

export default function WelcomePage() {
  const t = useTranslations('workspace')
  const router = useRouter()
  const { locale, setLocale } = useLocaleSetting()
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setToken(readInvitationFragment())
  }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    if (password !== form.get('confirm')) {
      setError(t('passwordMismatch'))
      return
    }
    setPending(true)
    setError('')
    try {
      await acceptWorkspaceInvitation(token, password)
      clearInvitationFragment()
      router.replace('/setup/')
    } catch {
      setError(t('inviteFailed'))
      setPending(false)
    }
  }
  return (
    <div className="auth-card">
      <p className="workspace-eyebrow">{t('welcomeEyebrow')}</p>
      <h1>{t('welcomeTitle')}</h1>
      <p className="lede">{t('welcomeHint')}</p>
      <Field id="welcome-language" label={t('companyLanguage')}>
        <select
          value={locale}
          onChange={(event) => setLocale(event.target.value === 'en' ? 'en' : 'de')}
        >
          <option value="de">{t('german')}</option>
          <option value="en">{t('english')}</option>
        </select>
      </Field>
      <form className="auth-form" onSubmit={submit}>
        <p role="alert" className="form-error">
          {error}
        </p>
        <Field id="welcome-password" label={t('password')} help={t('passwordHint')}>
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={1024}
            disabled={pending}
          />
        </Field>
        <Field id="welcome-confirm" label={t('confirmPassword')}>
          <input
            type="password"
            name="confirm"
            autoComplete="new-password"
            required
            minLength={12}
            disabled={pending}
          />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={pending || !token}>
          {pending ? t('saving') : t('activate')}
        </button>
      </form>
      <p className="workspace-note">{token ? t('invitePrivacy') : t('missingInvite')}</p>
      <Link href="/login/">{t('existingLogin')}</Link>
    </div>
  )
}
