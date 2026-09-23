'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { AddressSearch } from '@/components/AddressSearch'
import { Field } from '@/components/Field'
import { useLocaleSetting } from '@/components/IntlProvider'
import { useWorkspace } from '@/components/useWorkspace'
import { ApiError, saveLocation, saveWorker } from '@/lib/api'
import { completedSetup, saveCompany } from '@/lib/workspaces'

export default function SetupPage() {
  const t = useTranslations('workspace')
  const errors = useTranslations('error')
  const { setLocale } = useLocaleSetting()
  const { data, error, loading, reload } = useWorkspace()
  const [step, setStep] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [address, setAddress] = useState('')
  const requestId = useRef('')
  const done = data ? completedSetup(data) : [false, false, false, false]
  const current =
    step ??
    Math.max(
      0,
      done.findIndex((value) => !value),
    )
  useEffect(() => {
    if (data && step === null)
      setStep(
        Math.max(
          0,
          completedSetup(data).findIndex((value) => !value),
        ),
      )
  }, [data, step])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '')
    setPending(true)
    setSaveError('')
    setFeedback(false)
    if (!requestId.current) requestId.current = crypto.randomUUID()
    try {
      if (current === 0) {
        const locale = form.get('locale') === 'en' ? 'en' : 'de'
        await saveCompany(name, locale)
        setLocale(locale)
      } else if (current === 1) {
        await saveLocation({
          request_id: requestId.current,
          slug: `site-${requestId.current}`,
          name,
          address,
          active: true,
        })
      } else if (current === 2) {
        const rate = Number(String(form.get('rate') ?? '').replace(',', '.'))
        if (!Number.isFinite(rate) || rate <= 0 || rate > 10000) {
          setSaveError(t('invalidRate'))
          return
        }
        await saveWorker({
          request_id: requestId.current,
          name,
          hourly_rate_cents: Math.round(rate * 100),
          email: '',
          phone: '',
          active: true,
        })
      }
      requestId.current = ''
      setFeedback(true)
      setStep(Math.min(current + 1, 3))
      reload()
    } catch (cause) {
      setSaveError(cause instanceof ApiError ? errors(cause.messageKey) : errors('server'))
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="workspace-page setup-page">
      <header>
        <p className="workspace-eyebrow">{t('setupEyebrow')}</p>
        <h1>{t('setupTitle')}</h1>
        <p className="lede">{t('setupIntro')}</p>
      </header>
      <p role="alert" className="form-error">
        {saveError || (error ? errors(error) : '')}
      </p>
      <p role="status">{feedback ? t('saved') : ''}</p>
      {loading && <p role="status">{t('loading')}</p>}
      {data && !loading && !error && (
        <>
          <ol className="setup-steps">
            {(['companyStep', 'locationsStep', 'workersStep', 'readyStep'] as const).map(
              (key, index) => (
                <li key={key}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setStep(index)
                      setFeedback(false)
                      setSaveError('')
                      requestId.current = ''
                    }}
                    aria-current={current === index ? 'step' : undefined}
                  >
                    <span className="setup-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span>
                      {t(key)}
                      <small>{done[index] ? t('completed') : t('toDo')}</small>
                    </span>
                  </button>
                </li>
              ),
            )}
          </ol>
          <section className="workspace-panel setup-content">
            {current < 3 ? (
              <form key={current} className="auth-form" onSubmit={submit}>
                <h2>
                  {t(
                    (['companyStep', 'locationsStep', 'workersStep'] as const)[current] ??
                      'companyStep',
                  )}
                </h2>
                <p>
                  {t(
                    (['companyHint', 'locationHint', 'workerHint'] as const)[current] ??
                      'companyHint',
                  )}
                </p>
                {current > 0 && (
                  <p className="workspace-note">
                    {t(current === 1 ? 'existingLocations' : 'existingWorkers', {
                      count: current === 1 ? data.setup.locations : data.setup.workers,
                    })}
                  </p>
                )}
                <Field
                  id="setup-name"
                  label={t(
                    current === 0 ? 'companyName' : current === 1 ? 'buildingName' : 'workerName',
                  )}
                >
                  <input
                    name="name"
                    required
                    maxLength={current === 2 ? 120 : 160}
                    defaultValue={current === 0 ? data.company.name : ''}
                    disabled={pending}
                    autoComplete={current === 0 ? 'organization' : 'off'}
                  />
                </Field>
                {current === 0 && (
                  <Field id="setup-locale" label={t('companyLanguage')}>
                    <select name="locale" defaultValue={data.company.locale} disabled={pending}>
                      <option value="de">{t('german')}</option>
                      <option value="en">{t('english')}</option>
                    </select>
                  </Field>
                )}
                {current === 1 && (
                  <>
                    <Field id="setup-address" label={t('address')} help={t('addressHint')}>
                      <input
                        value={address}
                        onChange={(event) => setAddress(event.target.value)}
                        required
                        maxLength={300}
                        autoComplete="street-address"
                        disabled={pending}
                      />
                    </Field>
                    <AddressSearch value={address} onSelect={setAddress} disabled={pending} />
                  </>
                )}
                {current === 2 && (
                  <Field id="setup-rate" label={t('hourlyRate')} help={t('rateSetupHint')}>
                    <input
                      name="rate"
                      inputMode="decimal"
                      required
                      placeholder={t('ratePlaceholder')}
                      disabled={pending}
                    />
                  </Field>
                )}
                <div className="workspace-actions">
                  <button className="btn btn-primary" type="submit" disabled={pending}>
                    {pending ? t('saving') : t('saveContinue')}
                  </button>
                  {done[current] && (
                    <button
                      className="btn btn-ghost"
                      type="button"
                      disabled={pending}
                      onClick={() => setStep(Math.min(current + 1, 3))}
                    >
                      {t('continue')}
                    </button>
                  )}
                </div>
                {current > 0 && (
                  <Link href={current === 1 ? '/locations/' : '/workers/'}>
                    {t(current === 1 ? 'manageLocations' : 'manageWorkers')}
                  </Link>
                )}
              </form>
            ) : (
              <>
                <h2>{t('readyTitle')}</h2>
                <p>{t('readyHint')}</p>
                <ul className="workspace-checklist">
                  {(
                    [
                      {
                        key: 'operatorCheck',
                        ready: data.setup.operators > 0,
                        href: '/operators/',
                      },
                      {
                        key: 'tagCheck',
                        ready: data.setup.verified_zones > 0,
                        href: '/locations/',
                      },
                      {
                        key: 'loginCheck',
                        ready: data.setup.joined_workers > 0,
                        href: '/workers/',
                      },
                      { key: 'shiftCheck', ready: data.setup.shifts > 0, href: '/shifts/' },
                    ] as const
                  ).map((item) => (
                    <li key={item.key}>
                      <span className={item.ready ? 'setup-status done' : 'setup-status'}>
                        {t(item.ready ? 'completed' : 'toDo')}
                      </span>
                      <div>
                        <h3>{t(item.key)}</h3>
                        <p>{t(`${item.key}Hint`)}</p>
                        <Link href={item.href}>{t(`${item.key}Action`)}</Link>
                      </div>
                    </li>
                  ))}
                </ul>
                <button type="button" className="btn btn-ghost" onClick={reload}>
                  {t('checkAgain')}
                </button>
              </>
            )}
          </section>
          <div className="workspace-actions">
            <Link href="/workspace/">{t('backOverview')}</Link>
            <span className="workspace-note">{t('resumeHint')}</span>
          </div>
        </>
      )}
    </div>
  )
}
