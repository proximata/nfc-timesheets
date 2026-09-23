'use client'

import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Field } from '@/components/Field'
import { TrialRequestsInbox } from '@/components/TrialRequestsInbox'
import { ApiError } from '@/lib/api'
import { loginPathWithReturn } from '@/lib/nav'
import {
  fetchManagedWorkspaces,
  invitationUrl,
  type ManagedWorkspace,
  provisionWorkspace,
  renewInvitation,
} from '@/lib/workspaces'

export default function PlatformPage() {
  const t = useTranslations('workspace')
  const errors = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<ManagedWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [invite, setInvite] = useState('')
  const [copied, setCopied] = useState(false)
  const requestId = useRef('')
  const load = useCallback(async () => {
    try {
      setWorkspaces((await fetchManagedWorkspaces()).workspaces)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) router.replace(loginPathWithReturn())
      setError(
        cause instanceof ApiError && cause.code === 'owner_email_taken'
          ? t('ownerEmailTaken')
          : cause instanceof ApiError
            ? errors(cause.messageKey)
            : errors('server'),
      )
    } finally {
      setLoading(false)
    }
  }, [errors, router, t])
  useEffect(() => {
    void load()
  }, [load])
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    if (!requestId.current) requestId.current = crypto.randomUUID()
    setPending(true)
    setError('')
    setInvite('')
    setCopied(false)
    try {
      const result = await provisionWorkspace({
        name: String(values.get('name')),
        email: String(values.get('email')),
        locale: String(values.get('locale')),
        request_id: requestId.current,
      })
      if (result.invitation_token) setInvite(invitationUrl(result.invitation_token))
      requestId.current = ''
      form.reset()
      await load()
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'owner_email_taken'
          ? t('ownerEmailTaken')
          : cause instanceof ApiError
            ? errors(cause.messageKey)
            : errors('server'),
      )
    } finally {
      setPending(false)
    }
  }
  async function renew(id: number) {
    setPending(true)
    setInvite('')
    setError('')
    setCopied(false)
    try {
      setInvite(invitationUrl((await renewInvitation(id)).invitation_token))
      await load()
    } catch {
      setError(t('renewFailed'))
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="workspace-page">
      <header>
        <p className="workspace-eyebrow">{t('platformEyebrow')}</p>
        <h1>{t('companies')}</h1>
        <p className="lede">{t('platformHint')}</p>
      </header>
      <p role="alert" className="form-error">
        {error}
      </p>
      <section className="workspace-panel">
        <h2>{t('createCompany')}</h2>
        <form className="workspace-provision-form" onSubmit={create}>
          <Field id="company-name" label={t('companyName')}>
            <input name="name" required maxLength={200} disabled={pending} />
          </Field>
          <Field id="company-email" label={t('ownerEmail')}>
            <input name="email" type="email" required maxLength={320} disabled={pending} />
          </Field>
          <Field id="company-locale" label={t('companyLanguage')}>
            <select name="locale" disabled={pending}>
              <option value="de">{t('german')}</option>
              <option value="en">{t('english')}</option>
            </select>
          </Field>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? t('saving') : t('createAccess')}
          </button>
        </form>
      </section>
      {invite && (
        <section className="workspace-callout">
          <div>
            <h2>{t('invitationReady')}</h2>
            <p>{t('invitationHint')}</p>
            <Field id="invitation-link" label={t('invitationLink')}>
              <input readOnly value={invite} onFocus={(event) => event.target.select()} />
            </Field>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void navigator.clipboard
                .writeText(invite)
                .then(() => setCopied(true))
                .catch(() => setError(t('copyManually')))
            }}
          >
            {copied ? t('copied') : t('copyLink')}
          </button>
        </section>
      )}
      <section className="workspace-panel">
        <h2>{t('companyList')}</h2>
        {loading ? (
          <p role="status">{t('loading')}</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('companyName')}</th>
                  <th>{t('ownerEmail')}</th>
                  <th>{t('status')}</th>
                  <th>{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((company) => (
                  <tr key={company.id}>
                    <td>{company.name}</td>
                    <td>{company.owner_email ?? t('existingAccount')}</td>
                    <td>
                      {company.activated_at
                        ? t('activated')
                        : company.invitation_expires_at
                          ? t('inviteExpires', {
                              date: format.dateTime(new Date(company.invitation_expires_at), {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                                timeZone: 'Europe/Vienna',
                              }),
                            })
                          : t('existingAccount')}
                    </td>
                    <td>
                      {company.invitation_expires_at && !company.activated_at && (
                        <button
                          className="btn btn-ghost"
                          type="button"
                          onClick={() => {
                            void renew(company.id)
                          }}
                          disabled={pending}
                        >
                          {t('renewInvite')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <TrialRequestsInbox />
    </div>
  )
}
