'use client'

import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  ApiError,
  type FreshEnrolmentCode,
  fetchWorkers,
  issueEnrolmentCode,
  revokeEnrolmentCode,
  saveWorker,
  type Worker,
} from '@/lib/api'
import { codeStateOf } from '@/lib/enrolment'
import type { ErrorKey } from '@/lib/locale'
import { centsToPlainEuros, parseEuroToCents } from '@/lib/money'
import { LOGIN_PATH } from '@/lib/nav'
import { BUSINESS_TIME_ZONE } from '@/lib/shifts'

/**
 * Workers screen — create, edit and lock out the people who file hours.
 *
 * The email column is not a contact detail. Sign in with Apple hands the server an email
 * address and the server only lets a worker in if an ACTIVE row already carries it
 * (decision-22), so on an iPhone this form is the whole enrolment path and `active` is the
 * lockout switch. Everything here is one client component with `useState` and `fetch`
 * because the bundle is a static export (decision-16): no server component may fetch this.
 *
 * The second enrolment path is the code column (decision-26): the director creates a short
 * code FOR A PERSON, reads it out, and the worker types it once on a phone that has no
 * Apple ID. It is an alternative to Sign in with Apple, NOT a replacement — the email
 * address is still what gets an iPhone in, which is why nothing here calls it optional.
 */

/** How often the code column re-checks the clock. Codes live an hour; 30s is plenty. */
const CODE_TICK_MS = 30_000

/** Shape check only, mirroring server/lib/validate.js. Deliverability is not knowable here. */
const EMAIL_RE = /^[^\s@,]+@[^\s@,.]+(\.[^\s@,.]+)+$/

/**
 * Mirrors `optionalPhone` in server/lib/validate.js: digits and dialling punctuation only,
 * 4..40 characters. Deliberately not a country-specific format — the crew has Austrian
 * mobiles, landlines and foreign numbers, and a stricter rule would reject real ones.
 */
const PHONE_RE = /^[0-9+()/.\s-]{4,40}$/

type Draft = {
  /** Absent = create. Present = update that row. */
  id?: number
  name: string
  email: string
  /** Contact detail only. Never a credential — see `phoneHint`. */
  phone: string
  /** Euros as typed. Converted to integer cents at submit, never held as a float. */
  rate: string
  active: boolean
}

const EMPTY_DRAFT: Draft = { name: '', email: '', phone: '', rate: '', active: true }

function draftOf(worker: Worker): Draft {
  return {
    id: worker.id,
    name: worker.name,
    email: worker.email ?? '',
    phone: worker.phone ?? '',
    rate: centsToPlainEuros(worker.hourly_rate_cents),
    active: worker.active,
  }
}

/** Message keys inside the `workers` namespace, so the field errors stay translatable. */
type ErrorMessage =
  | 'errorNameRequired'
  | 'errorEmailShape'
  | 'errorEmailTaken'
  | 'errorPhoneShape'
  | 'errorRateInvalid'
  | 'errorRejected'

type FieldErrors = {
  name?: ErrorMessage
  email?: ErrorMessage
  phone?: ErrorMessage
  rate?: ErrorMessage
}

export default function WorkersPage() {
  const t = useTranslations('workers')
  const tError = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()

  const nameId = useId()
  const emailId = useId()
  const emailHintId = useId()
  const phoneId = useId()
  const phoneHintId = useId()
  const rateId = useId()
  const rateHintId = useId()
  const activeId = useId()
  const errorId = useId()
  const statusId = useId()
  const formHeadingId = useId()
  const codeHeadingId = useId()
  const codeValueId = useId()
  const codeOnceId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const codePanelRef = useRef<HTMLElement>(null)

  // null = still loading. [] = loaded and genuinely empty, which is the first-run state.
  const [workers, setWorkers] = useState<Worker[] | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ErrorMessage | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  /** The code just created, shown once. Unrecoverable afterwards — see `issueEnrolmentCode`. */
  const [freshCode, setFreshCode] = useState<FreshEnrolmentCode | null>(null)
  /** Result of the last copy / revoke action, announced in a permanent live region. */
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  /** Ticks so an expiry that has passed stops being reported as a live code. */
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CODE_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  // A code appearing is the whole point of the click, and it renders ABOVE the row that
  // was clicked. Focus follows it, so a keyboard or screen-reader user lands on the code
  // and its copy button instead of hunting for something that silently scrolled into view.
  useEffect(() => {
    if (freshCode !== null) codePanelRef.current?.focus()
  }, [freshCode])

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
    const phone = draft.phone.trim()
    const cents = parseEuroToCents(draft.rate)

    // Client-side validation is UX only — server/lib/validate.js decides for real.
    const errors: FieldErrors = {}
    if (name === '') errors.name = 'errorNameRequired'
    if (email !== '' && !EMAIL_RE.test(email)) errors.email = 'errorEmailShape'
    if (phone !== '' && !PHONE_RE.test(phone)) errors.phone = 'errorPhoneShape'
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
        phone,
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
   * Clipboard access fails on an insecure origin and can be refused by the browser. Not
   * fatal: the code is on screen in full, so the fallback is to say so rather than leave
   * the director believing a copy happened and pasting something else into a message.
   */
  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setNotice({ ok: true, text: t('codeCopied') })
    } catch {
      setNotice({ ok: false, text: t('codeCopyFailed') })
    }
  }

  /** Create a code for this person, replacing whatever they had. Shown once, right here. */
  async function issueCode(worker: Worker) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setFreshCode(null)
    try {
      setFreshCode(await issueEnrolmentCode(worker.id))
      await load()
    } catch (cause) {
      if (!handleAuthLoss(cause)) setNotice({ ok: false, text: t('codeIssueFailed') })
    } finally {
      setBusy(false)
    }
  }

  /** The control for a code that reached the wrong person. Immediate, and idempotent. */
  async function revokeCode(worker: Worker) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    // Only this worker's panel: another worker's code is still valid and is still the one
    // and only sighting of it, so wiping it off the screen would destroy it for nothing.
    if (freshCode?.worker.id === worker.id) setFreshCode(null)
    try {
      await revokeEnrolmentCode(worker.id)
      setNotice({ ok: true, text: t('codeRevoked', { name: worker.name }) })
      await load()
    } catch (cause) {
      if (!handleAuthLoss(cause)) setNotice({ ok: false, text: t('codeRevokeFailed') })
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
      // Every column of the row goes back on the wire: the route UPDATEs all of them, so
      // an omitted phone number here would be silently erased by a Deactivate click.
      await saveWorker({
        id: worker.id,
        name: worker.name,
        email: worker.email ?? '',
        phone: worker.phone ?? '',
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

  // Vienna, explicitly — not the browser's zone. A code expiring "at 15:32" has to mean the
  // same 15:32 the director would say on the phone.
  const dayTime = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BUSINESS_TIME_ZONE,
    })

  /** Words, never a colour: this has to survive greyscale and a screen reader. */
  function codeStatusText(worker: Worker): string {
    switch (codeStateOf(worker, now)) {
      case 'live':
        // Non-null by construction: `live` is only reachable with an expiry set.
        return t('codeLive', { expires: dayTime(worker.enrolment_code_expires_at ?? '') })
      case 'expired':
        return t('codeExpired', { expires: dayTime(worker.enrolment_code_expires_at ?? '') })
      case 'redeemed':
        return t('codeRedeemed', { date: dayTime(worker.enrolment_code_redeemed_at ?? '') })
      default:
        return t('codeNone')
    }
  }

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

          {/* The phone number is NOT a login. A director who assumes it is would enrol the
              whole crew with numbers and nobody could sign in, so both fields carry the
              distinction in their label AND in their hint. */}
          <div className="field">
            <label htmlFor={phoneId}>{t('fieldPhone')}</label>
            <input
              id={phoneId}
              type="tel"
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
              maxLength={40}
              autoComplete="off"
              aria-describedby={`${phoneHintId} ${phoneId}-error`}
              aria-invalid={fieldErrors.phone !== undefined}
              disabled={busy}
            />
            <p className="field-hint" id={phoneHintId}>
              {t('phoneHint')}
            </p>
            <p className="field-error" id={`${phoneId}-error`} role="alert">
              {fieldErrors.phone === undefined ? '' : t(fieldErrors.phone)}
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

        {/* THE WARNING COMES FIRST. "Shown only once" is useless underneath a code that has
            already scrolled past, so it stands here permanently, above the buttons that
            create one. It also says what a code is FOR, because the same paragraph has to
            stop a director concluding that the email address is now optional. */}
        <p className="notice">{t('codeStandingNote')}</p>

        {/* Permanent live region for copy / revoke results, outside the table so that
            re-rendering a row never destroys and recreates it. */}
        <p className={notice?.ok === false ? 'form-error' : 'form-status'} role="status">
          {notice === null ? '' : notice.text}
        </p>

        {/* The one and only sighting of the code. Not a dialog: the director reads it out
            over the phone, and a modal that hid the row it belongs to would be in the way.
            Focused on appearance (above), so it is not announced twice by also being a
            live region. */}
        {freshCode === null ? null : (
          <section
            className="notice share-panel"
            ref={codePanelRef}
            tabIndex={-1}
            aria-labelledby={codeHeadingId}
            aria-describedby={codeOnceId}
          >
            <p id={codeHeadingId}>
              <strong>{t('codeReadyHeading', { name: freshCode.worker.name })}</strong>
            </p>
            <code className="code-block" id={codeValueId}>
              {freshCode.code}
            </code>
            <p className="form-actions">
              <button
                type="button"
                className="button-primary"
                aria-describedby={codeValueId}
                onClick={() => copyCode(freshCode.code)}
              >
                {t('codeCopy')}
              </button>
            </p>
            <p>{t('codeExplain', { name: freshCode.worker.name })}</p>
            <p>{t('codeValidUntil', { expires: dayTime(freshCode.expires_at) })}</p>
            <p id={codeOnceId}>{t('codeOnce')}</p>
          </section>
        )}

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
                <th scope="col">{t('colPhone')}</th>
                <th scope="col">{t('colRate')}</th>
                <th scope="col">{t('colStatus')}</th>
                <th scope="col">{t('colCode')}</th>
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
                    {worker.phone === null ? (
                      <span className="cell-muted">{t('noPhone')}</span>
                    ) : (
                      // tel: so a director on a laptop with a softphone can just click it.
                      <a href={`tel:${worker.phone.replace(/[^0-9+]/g, '')}`}>{worker.phone}</a>
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
                  {/* Revoke sits in the open next to create, at the same weight. It is the
                      control used when a code went to the wrong person, and burying it in a
                      menu would cost seconds exactly when they matter. */}
                  <td>
                    <p className="cell-code">{codeStatusText(worker)}</p>
                    <div className="cell-actions">
                      {worker.active ? (
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => issueCode(worker)}
                        >
                          {codeStateOf(worker, now) === 'live' ? t('codeReissue') : t('codeIssue')}
                          <span className="visually-hidden">
                            {t('forWorker', { name: worker.name })}
                          </span>
                        </button>
                      ) : (
                        <span className="cell-muted">{t('codeInactive')}</span>
                      )}
                      {codeStateOf(worker, now) === 'live' ? (
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => revokeCode(worker)}
                        >
                          {t('codeRevoke')}
                          <span className="visually-hidden">
                            {t('forWorker', { name: worker.name })}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </td>
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
