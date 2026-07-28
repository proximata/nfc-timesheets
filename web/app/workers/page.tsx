'use client'

import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import { ApiError, fetchWorkers, saveWorker, type Worker } from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'
import { centsToEuroInput, parseEuroToCents } from '@/lib/money'
import { LOGIN_PATH } from '@/lib/nav'

/**
 * Workers screen — create, edit and lock out the people who file hours.
 *
 * The email column is not a contact detail. Sign in with Apple hands the server an email
 * address and the server only lets a worker in if an ACTIVE row already carries it
 * (decision-22), so this form is the entire enrolment path and `active` is the lockout
 * switch. Everything here is one client component with `useState` and `fetch` because the
 * bundle is a static export (decision-16): no server component may fetch this data.
 */

/** Shape check only, mirroring server/lib/validate.js. Deliverability is not knowable here. */
const EMAIL_RE = /^[^\s@,]+@[^\s@,.]+(\.[^\s@,.]+)+$/

type Draft = {
  /** Absent = create. Present = update that row. */
  id?: number
  name: string
  email: string
  /** Euros as typed. Converted to integer cents at submit, never held as a float. */
  rate: string
  active: boolean
}

const EMPTY_DRAFT: Draft = { name: '', email: '', rate: '', active: true }

function draftOf(worker: Worker): Draft {
  return {
    id: worker.id,
    name: worker.name,
    email: worker.email ?? '',
    rate: centsToEuroInput(worker.hourly_rate_cents),
    active: worker.active,
  }
}

/** Message keys inside the `workers` namespace, so the field errors stay translatable. */
type ErrorMessage =
  | 'errorNameRequired'
  | 'errorEmailShape'
  | 'errorEmailTaken'
  | 'errorRateInvalid'
  | 'errorRejected'

type FieldErrors = { name?: ErrorMessage; email?: ErrorMessage; rate?: ErrorMessage }

export default function WorkersPage() {
  const t = useTranslations('workers')
  const tError = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()

  const nameId = useId()
  const emailId = useId()
  const emailHintId = useId()
  const rateId = useId()
  const rateHintId = useId()
  const activeId = useId()
  const errorId = useId()
  const statusId = useId()
  const formHeadingId = useId()
  const nameRef = useRef<HTMLInputElement>(null)

  // null = still loading. [] = loaded and genuinely empty, which is the first-run state.
  const [workers, setWorkers] = useState<Worker[] | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ErrorMessage | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  /** A dead session must not render an empty table that looks like "no workers yet". */
  const handleAuthLoss = useCallback(
    (cause: unknown): boolean => {
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        router.replace(LOGIN_PATH)
        return true
      }
      return false
    },
    [router],
  )

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setWorkers(await fetchWorkers(signal))
        setLoadError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (handleAuthLoss(cause)) return
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
      }
    },
    [handleAuthLoss],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  function editWorker(worker: Worker) {
    setDraft(draftOf(worker))
    setFieldErrors({})
    setFormError(null)
    setSaved(false)
    nameRef.current?.focus()
  }

  function cancelEdit() {
    setDraft(EMPTY_DRAFT)
    setFieldErrors({})
    setFormError(null)
    nameRef.current?.focus()
  }

  /** Maps a failed upsert onto the field it belongs to. 409 can only be the email index. */
  function reportSaveFailure(cause: unknown) {
    if (handleAuthLoss(cause)) return
    if (cause instanceof ApiError && cause.status === 409) {
      setFieldErrors({ email: 'errorEmailTaken' })
      setFormError('errorEmailTaken')
      return
    }
    setFormError(
      cause instanceof ApiError && cause.status >= 400 && cause.status < 500
        ? 'errorRejected'
        : null,
    )
    if (cause instanceof ApiError && (cause.status === 0 || cause.status >= 500)) {
      setFieldErrors({})
      setLoadError(cause.messageKey)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const name = draft.name.trim()
    const email = draft.email.trim()
    const cents = parseEuroToCents(draft.rate)

    // Client-side validation is UX only — server/lib/validate.js decides for real.
    const errors: FieldErrors = {}
    if (name === '') errors.name = 'errorNameRequired'
    if (email !== '' && !EMAIL_RE.test(email)) errors.email = 'errorEmailShape'
    if (cents === null) errors.rate = 'errorRateInvalid'
    setFieldErrors(errors)
    setFormError(null)
    setSaved(false)
    if (Object.keys(errors).length > 0 || cents === null) return

    setBusy(true)
    try {
      await saveWorker({
        ...(draft.id === undefined ? {} : { id: draft.id }),
        name,
        email,
        hourly_rate_cents: cents,
        active: draft.active,
      })
      setDraft(EMPTY_DRAFT)
      setSaved(true)
      await load()
      // The submit button is disabled while saving, so focus would otherwise fall to
      // <body>. Put it back where the next worker gets typed.
      nameRef.current?.focus()
    } catch (cause) {
      reportSaveFailure(cause)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Soft delete / undo. Row buttons stay enabled and re-entry is guarded instead, so a
   * click never yanks focus out from under the keyboard user mid-request.
   */
  async function toggleActive(worker: Worker) {
    if (busy) return
    setBusy(true)
    setSaved(false)
    setFormError(null)
    try {
      await saveWorker({
        id: worker.id,
        name: worker.name,
        email: worker.email ?? '',
        hourly_rate_cents: worker.hourly_rate_cents,
        active: !worker.active,
      })
      await load()
    } catch (cause) {
      reportSaveFailure(cause)
    } finally {
      setBusy(false)
    }
  }

  const editing = draft.id !== undefined
  const formErrorText = formError === null ? '' : t(formError)

  return (
    <>
      <h1>{t('heading')}</h1>
      <p className="lede">{t('intro')}</p>

      <section aria-labelledby={formHeadingId}>
        <h2 id={formHeadingId}>{editing ? t('editHeading') : t('createHeading')}</h2>

        <form className="worker-form" onSubmit={onSubmit} noValidate>
          {/* Permanent live regions: a text change inside an existing region is announced
              far more reliably than a node that appears and disappears. */}
          <p className="form-error" id={errorId} role="alert">
            {formErrorText}
          </p>
          <p className="form-status" id={statusId} role="status">
            {saved ? t('saved') : ''}
          </p>

          <div className="field">
            <label htmlFor={nameId}>{t('fieldName')}</label>
            <input
              id={nameId}
              ref={nameRef}
              type="text"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              maxLength={120}
              autoComplete="off"
              aria-describedby={`${nameId}-error`}
              aria-invalid={fieldErrors.name !== undefined}
              disabled={busy}
            />
            <p className="field-error" id={`${nameId}-error`} role="alert">
              {fieldErrors.name === undefined ? '' : t(fieldErrors.name)}
            </p>
          </div>

          <div className="field">
            <label htmlFor={emailId}>{t('fieldEmail')}</label>
            <input
              id={emailId}
              type="email"
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
              maxLength={320}
              autoComplete="off"
              aria-describedby={`${emailHintId} ${emailId}-error`}
              aria-invalid={fieldErrors.email !== undefined}
              disabled={busy}
            />
            <p className="field-hint" id={emailHintId}>
              {t('emailHint')}
            </p>
            <p className="field-error" id={`${emailId}-error`} role="alert">
              {fieldErrors.email === undefined ? '' : t(fieldErrors.email)}
            </p>
          </div>

          <div className="field">
            <label htmlFor={rateId}>{t('fieldRate')}</label>
            <input
              id={rateId}
              type="text"
              inputMode="decimal"
              value={draft.rate}
              onChange={(event) => setDraft({ ...draft, rate: event.target.value })}
              aria-describedby={`${rateHintId} ${rateId}-error`}
              aria-invalid={fieldErrors.rate !== undefined}
              disabled={busy}
            />
            <p className="field-hint" id={rateHintId}>
              {t('rateHint')}
            </p>
            <p className="field-error" id={`${rateId}-error`} role="alert">
              {fieldErrors.rate === undefined ? '' : t(fieldErrors.rate)}
            </p>
          </div>

          <div className="field field-check">
            <input
              id={activeId}
              type="checkbox"
              checked={draft.active}
              onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
              disabled={busy}
            />
            <label htmlFor={activeId}>{t('fieldActive')}</label>
          </div>

          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={busy}>
              {busy ? t('submitting') : editing ? t('submitSave') : t('submitCreate')}
            </button>
            {editing ? (
              <button type="button" className="button-secondary" onClick={cancelEdit}>
                {t('cancel')}
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section aria-labelledby="workers-list-heading">
        <h2 id="workers-list-heading">{t('listHeading')}</h2>

        {loadError !== null ? (
          <p className="form-error" role="alert">
            {tError(loadError)}
          </p>
        ) : null}

        {workers === null ? (
          <p role="status">{t('loading')}</p>
        ) : workers.length === 0 ? (
          <p>{t('emptyBody')}</p>
        ) : (
          <table className="data-table" aria-busy={busy}>
            <caption className="visually-hidden">{t('tableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('colName')}</th>
                <th scope="col">{t('colEmail')}</th>
                <th scope="col">{t('colRate')}</th>
                <th scope="col">{t('colStatus')}</th>
                <th scope="col">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.id} className={worker.active ? undefined : 'row-inactive'}>
                  <th scope="row">{worker.name}</th>
                  <td>
                    {worker.email === null ? (
                      <span className="cell-muted">{t('noEmail')}</span>
                    ) : (
                      worker.email
                    )}
                  </td>
                  <td>
                    {format.number(worker.hourly_rate_cents / 100, {
                      style: 'currency',
                      currency: 'EUR',
                    })}
                  </td>
                  {/* Text, not a colour: the status has to survive greyscale and a screen reader. */}
                  <td>{worker.active ? t('statusActive') : t('statusInactive')}</td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => editWorker(worker)}
                    >
                      {t('edit')}
                      <span className="visually-hidden">
                        {t('forWorker', { name: worker.name })}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => toggleActive(worker)}
                    >
                      {worker.active ? t('deactivate') : t('activate')}
                      <span className="visually-hidden">
                        {t('forWorker', { name: worker.name })}
                      </span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
