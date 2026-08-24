'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import { ConfirmModal } from '@/components/ConfirmModal'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
import {
  ApiError,
  deactivateOperator,
  type FreshOperatorCode,
  fetchOperators,
  fetchSmsStatus,
  issueOperatorEnrolmentCode,
  type Operator,
  reactivateOperator,
  revokeOperatorEnrolmentCode,
  type SmsStatus,
  saveOperator,
  sendOperatorEnrolmentCodeBySms,
} from '@/lib/api'
import { codeStateOf } from '@/lib/enrolment'
import { filterHref } from '@/lib/filters'
import type { ErrorKey } from '@/lib/locale'
import { loginPathWithReturn } from '@/lib/nav'
import { normaliseIdentityPhone } from '@/lib/phone'
import { BUSINESS_TIME_ZONE } from '@/lib/shifts'

/**
 * Operators — a person recognised by phone, who reads and writes tags and never clocks in
 * (decision-45). Off-nav (decision-39 §6), reached only from the link `/workers/` carries.
 *
 * CREATE ONLY. `POST /admin/operators` has no update branch (routes/admin.js's own comment:
 * a phone that needs to change is a new identity claim, not an edit of an old one), so unlike
 * `/workers/` there is no edit mode, no `draftOf()`, and the Drawer's title never changes.
 *
 * `POST /operator/workers` — "create a worker from the phone" — is not this screen's job and
 * is not built anywhere in this tree: OPERATOR-MODEL.md §8 flags it as blocked on decision-41
 * (PROPOSED), and TASK-214 names the read-only "also a worker" link as the whole extent of
 * the worker relationship this screen shows.
 */

const WORKERS_PATH = '/workers/'

/** Mirrors the workers screen: 30 s is plenty against a 5-day code lifetime. */
const CODE_TICK_MS = 30_000

type Draft = { name: string; phone: string }

const EMPTY_DRAFT: Draft = { name: '', phone: '' }

type ErrorMessage =
  | 'errorNameRequired'
  | 'errorPhoneRequired'
  | 'errorPhoneInvalid'
  | 'errorPhoneClaimed'
  | 'errorRejected'

type FieldErrors = { name?: ErrorMessage; phone?: ErrorMessage }

/** The one irreversible action waiting for a plain yes/no. */
type Pending = { kind: 'revoke' | 'reissue' | 'deactivate'; operator: Operator }

export default function OperatorsPage() {
  const t = useTranslations('operators')
  const tError = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()

  const formId = useId()
  const nameId = useId()
  const phoneId = useId()
  const codeHeadingId = useId()
  const codeValueId = useId()
  const codeOnceId = useId()
  const codePanelRef = useRef<HTMLElement>(null)

  const [operators, setOperators] = useState<Operator[] | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  /** null = the drawer is closed. There is no edit mode on this screen. */
  const [draft, setDraft] = useState<Draft | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ErrorMessage | null>(null)
  const [saveError, setSaveError] = useState<ErrorKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  /** The code just created, shown once. Unrecoverable afterwards. */
  const [freshCode, setFreshCode] = useState<FreshOperatorCode | null>(null)
  /**
   * `GET /admin/sms-status`, the same fail-closed picker `/workers/` already uses
   * (decision-48 extended to operators): null = not loaded yet, and the SMS button stays
   * disabled until it is — never guessed from the static bundle.
   */
  const [smsInfo, setSmsInfo] = useState<SmsStatus | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CODE_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  // Focus follows the fresh code the same way it does on /workers/ — the director is
  // reading it out over the phone, not hunting for something that silently appeared.
  useEffect(() => {
    if (freshCode !== null) codePanelRef.current?.focus()
  }, [freshCode])

  const handleAuthLoss = useCallback(
    (cause: unknown): boolean => {
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        router.replace(loginPathWithReturn())
        return true
      }
      return false
    },
    [router],
  )

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [ops, sms] = await Promise.all([
          fetchOperators(signal),
          // FAILS CLOSED, exactly like /workers/: an old server, a proxy hiccup or offline
          // never render as "configured" — the button ends up disabled with the same
          // sentence a real 503 would produce.
          fetchSmsStatus(signal).catch((cause) => {
            if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
            return { configured: false, missing: [], sender_kind: null } as SmsStatus
          }),
        ])
        setOperators(ops)
        setSmsInfo(sms)
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

  function openCreate() {
    setDraft(EMPTY_DRAFT)
    setFieldErrors({})
    setFormError(null)
    setSaveError(null)
    setNotice(null)
  }

  /** Escape, the scrim and Cancel all land here. Focus restoration is the Drawer's job. */
  function closeDrawer() {
    setDraft(null)
    setFieldErrors({})
    setFormError(null)
    setSaveError(null)
  }

  /** Maps a failed create onto the field it belongs to. 409 can only be phone_claimed. */
  function reportSaveFailure(cause: unknown) {
    if (handleAuthLoss(cause)) return
    if (cause instanceof ApiError && cause.status === 409 && cause.code === 'phone_claimed') {
      setFieldErrors({ phone: 'errorPhoneClaimed' })
      setFormError('errorPhoneClaimed')
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
      setSaveError(cause.messageKey)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || draft === null) return

    const name = draft.name.trim()
    const phone = normaliseIdentityPhone(draft.phone)

    // Client-side validation is UX only — server/lib/validate.js's identityPhone decides
    // for real, and the collision check is server-only, structurally, forever (§7).
    const errors: FieldErrors = {}
    if (name === '') errors.name = 'errorNameRequired'
    if (phone === null)
      errors.phone = draft.phone.trim() === '' ? 'errorPhoneRequired' : 'errorPhoneInvalid'
    setFieldErrors(errors)
    setFormError(null)
    setSaveError(null)
    if (Object.keys(errors).length > 0 || phone === null) return

    setBusy(true)
    try {
      await saveOperator({ name, phone })
      setNotice({ ok: true, text: t('saved') })
      closeDrawer()
      await load()
    } catch (cause) {
      reportSaveFailure(cause)
    } finally {
      setBusy(false)
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setNotice({ ok: true, text: t('codeCopied') })
    } catch {
      setNotice({ ok: false, text: t('codeCopyFailed') })
    }
  }

  /** Create a code for this person, replacing whatever they had. Shown once, right here. */
  async function issueCode(operator: Operator) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setFreshCode(null)
    try {
      setFreshCode(await issueOperatorEnrolmentCode(operator.id))
      await load()
    } catch (cause) {
      if (!handleAuthLoss(cause)) setNotice({ ok: false, text: t('codeIssueFailed') })
    } finally {
      setBusy(false)
    }
  }

  /**
   * "SMS senden" for an operator — byte-identical action to `/workers/`'s `sendCodeBySms`,
   * against `sendOperatorEnrolmentCodeBySms`. A failed send still lands a working code in
   * the SAME standing panel `issueCode` uses above, never a second UI for the same fact.
   *
   * ponytail: unlike `/workers/`, this screen does not persist "last SMS attempt" beside
   * the row (`Operator` carries no `sms_last_status`/`sms_last_at` — no server join exists
   * for it). The one-shot notice banner below is the whole result surface. Ceiling: the
   * outcome of an SMS is invisible again after the notice clears or the page reloads.
   * Upgrade path if that turns out to matter: join `sms_deliveries` onto `/admin/data`'s
   * operator rows the same way it is already joined onto workers.
   */
  async function sendCodeBySms(operator: Operator) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setFreshCode(null)
    try {
      const result = await sendOperatorEnrolmentCodeBySms(operator.id)
      setFreshCode({ operator: result.operator, code: result.code, expires_at: result.expires_at })
      setNotice(
        result.delivery.status === 'sent'
          ? {
              ok: true,
              text: t('smsHandedOver', {
                phone: result.delivery.phone_e164,
                time: dayTime(new Date().toISOString()),
              }),
            }
          : { ok: false, text: t('smsFailed', { reason: result.delivery.reason }) },
      )
      await load()
    } catch (cause) {
      if (handleAuthLoss(cause)) return
      if (cause instanceof ApiError && cause.code === 'no_phone_identity') {
        setNotice({ ok: false, text: t('smsNoPhone') })
      } else if (cause instanceof ApiError && cause.status === 503) {
        setNotice({ ok: false, text: t('smsNotConfigured') })
      } else if (cause instanceof ApiError && cause.status === 429) {
        setNotice({ ok: false, text: t('smsTooMany') })
      } else {
        setNotice({ ok: false, text: t('smsSendFailed') })
      }
    } finally {
      setBusy(false)
    }
  }

  /** The control for a code read aloud to the wrong person. Immediate, and idempotent. */
  async function revokeCode(operator: Operator) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    if (freshCode?.operator.id === operator.id) setFreshCode(null)
    try {
      await revokeOperatorEnrolmentCode(operator.id)
      setNotice({ ok: true, text: t('codeRevoked', { name: operator.name }) })
      await load()
    } catch (cause) {
      if (!handleAuthLoss(cause)) setNotice({ ok: false, text: t('codeRevokeFailed') })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Soft delete — reversible now (TASK-219). POST /admin/operators stays create-only (no
   * upsert, no `active: true` branch: the comment on createOperator server-side is still
   * true — a phone that needs to change is a new identity claim), but a dedicated
   * POST /admin/operators/:id/reactivate is the way back, in `reactivate()` above.
   * `deactivateConfirmBody` no longer claims the action is final — it isn't, any more.
   */
  async function deactivate(operator: Operator) {
    if (busy) return
    setBusy(true)
    setFormError(null)
    try {
      await deactivateOperator(operator.id)
      await load()
    } catch (cause) {
      if (!handleAuthLoss(cause))
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
    } finally {
      setBusy(false)
    }
  }

  /**
   * The way back (TASK-219). No confirmation: reversing a reversible action needs none —
   * same posture as /workers/'s inactive → active toggle, which also skips the modal.
   * POST /admin/operators/:id/reactivate never touches phone_identities; the claim never
   * left on deactivation in the first place (server-side comment on deleteOperator).
   */
  async function reactivate(operator: Operator) {
    if (busy) return
    setBusy(true)
    setFormError(null)
    try {
      await reactivateOperator(operator.id)
      await load()
    } catch (cause) {
      if (!handleAuthLoss(cause))
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
    } finally {
      setBusy(false)
    }
  }

  /**
   * The modal is dismissed BEFORE the action runs, on purpose — see /workers/'s identical
   * comment: issuing a code moves focus to the fresh-code panel, and restoring focus to the
   * opener AFTER that would steal it back.
   */
  function confirmPending() {
    if (pending === null) return
    const { kind, operator } = pending
    setPending(null)
    if (kind === 'revoke') void revokeCode(operator)
    else if (kind === 'reissue') void issueCode(operator)
    else void deactivate(operator)
  }

  // Vienna, explicitly — not the browser's zone. Same reasoning as /workers/.
  const dayTime = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BUSINESS_TIME_ZONE,
    })

  /** Words, never a colour: this has to survive greyscale and a screen reader. */
  function codeStatusText(operator: Operator): string {
    switch (codeStateOf(operator, now)) {
      case 'live':
        return t('codeLive', { expires: dayTime(operator.enrolment_code_expires_at ?? '') })
      case 'expired':
        return t('codeExpired', { expires: dayTime(operator.enrolment_code_expires_at ?? '') })
      case 'redeemed':
        return t('codeRedeemed', { date: dayTime(operator.enrolment_code_redeemed_at ?? '') })
      default:
        return t('codeNone')
    }
  }

  const phonePreview = draft === null ? null : normaliseIdentityPhone(draft.phone)

  /** decision-48's picker, applied to operators: disabled with the reason in words beside
      it — never hidden — exactly like /workers/'s smsButtonDisabled. */
  function smsButtonDisabled(operator: Operator, sms: SmsStatus | null): boolean {
    return sms === null || !sms.configured || operator.phone_e164 === null
  }

  return (
    <>
      <PageHeader
        title={t('heading')}
        question={t('question')}
        action={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            {t('createHeading')}
          </button>
        }
      />

      {/* Permanent live regions, on the PAGE and never inside an overlay — see /workers/'s
          identical comment: an overlay that closes on success takes its own message with it. */}
      <p className="form-error" role="alert">
        {loadError === null ? '' : tError(loadError)}
      </p>
      <p className={notice?.ok === false ? 'form-error' : 'form-status'} role="status">
        {notice === null ? '' : notice.text}
      </p>

      <p className="note">{t('codeStandingNote')}</p>

      {/* The one and only sighting of the code. Same NOT-a-dialog shape as /workers/: the
          director reads it out over the phone while looking at that person's row. */}
      {freshCode === null ? null : (
        <section
          className="note share-panel"
          ref={codePanelRef}
          tabIndex={-1}
          aria-labelledby={codeHeadingId}
          aria-describedby={codeOnceId}
        >
          <p id={codeHeadingId}>
            <strong>{t('codeReadyHeading', { name: freshCode.operator.name })}</strong>
          </p>
          <code className="code" id={codeValueId}>
            {freshCode.code}
          </code>
          <p>{t('codeValidUntil', { expires: dayTime(freshCode.expires_at) })}</p>
          <p className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              aria-describedby={codeValueId}
              onClick={() => copyCode(freshCode.code)}
            >
              {t('codeCopy')}
            </button>
          </p>
          <p id={codeOnceId}>{t('codeOnce')}</p>
        </section>
      )}

      <ListPanel title={t('listHeading')}>
        {/* A FAILED LOAD MUST NOT GO ON SAYING "loading". This branch is reached whenever the
            page has no data, and a failed fetch leaves it with no data FOR EVER — so with the
            database stopped, the director got a red error line and, beneath it, a permanent
            "Wird geladen …" in brighter and larger type than the error. Two contradicting
            statements at once, the louder of them false. Desaturated it was worse: the failure
            read as the LESS important of the two, which is colour carrying the whole signal
            instead of being the second one. Measured by stopping postgresql on production and
            photographing this screen (ops/break-infra.sh § 2 puts the box in that state).
            Saying it HERE, and not only in the alert banner, is what makes it reachable: on
            /objekte that banner sits ~370px above this table, so a director reading the table
            never saw it at all. */}
        {operators === null ? (
          <p role="status">{loadError === null ? t('loading') : tError(loadError)}</p>
        ) : operators.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <table className="data-table" aria-busy={busy}>
            <caption className="visually-hidden">{t('tableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('colName')}</th>
                <th scope="col">{t('colPhone')}</th>
                <th scope="col">{t('colAlsoWorker')}</th>
                <th scope="col">{t('colStatus')}</th>
                <th scope="col">{t('colCode')}</th>
                <th scope="col">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {operators.map((operator) => (
                <tr key={operator.id} className={operator.active ? undefined : 'is-muted'}>
                  <th scope="row">{operator.name}</th>
                  {/* Always a number: createOperator's one writable CTE either claims a
                      phone alongside the operator row or creates neither — there is no
                      operator row this screen can ever load with no phone. */}
                  <td>{operator.phone_e164}</td>
                  <td>
                    {operator.linked_worker_id === null ? (
                      <span className="cell-muted">{t('alsoWorkerNone')}</span>
                    ) : (
                      <Link href={filterHref(WORKERS_PATH, { worker: operator.linked_worker_id })}>
                        {operator.linked_worker_name}
                        <span className="visually-hidden">{t('alsoWorkerHint')}</span>
                      </Link>
                    )}
                  </td>
                  <td>{operator.active ? t('statusActive') : t('statusInactive')}</td>
                  <td>
                    <p className="cell-code">{codeStatusText(operator)}</p>
                    <div className="cell-actions">
                      {operator.active ? (
                        <button
                          type="button"
                          className="btn btn-quiet"
                          onClick={() =>
                            codeStateOf(operator, now) === 'live'
                              ? setPending({ kind: 'reissue', operator })
                              : issueCode(operator)
                          }
                        >
                          {codeStateOf(operator, now) === 'live'
                            ? t('codeReissue')
                            : t('codeIssue')}
                          <span className="visually-hidden">
                            {t('forOperator', { name: operator.name })}
                          </span>
                        </button>
                      ) : (
                        <span className="cell-muted">{t('codeInactive')}</span>
                      )}
                      {codeStateOf(operator, now) === 'live' ? (
                        <button
                          type="button"
                          className="btn btn-quiet"
                          onClick={() => setPending({ kind: 'revoke', operator })}
                        >
                          {t('codeRevoke')}
                          <span className="visually-hidden">
                            {t('forOperator', { name: operator.name })}
                          </span>
                        </button>
                      ) : null}
                      {operator.active ? (
                        <button
                          type="button"
                          className="btn btn-quiet"
                          disabled={smsButtonDisabled(operator, smsInfo)}
                          aria-disabled={smsButtonDisabled(operator, smsInfo)}
                          onClick={() => sendCodeBySms(operator)}
                        >
                          {t('smsSend')}
                          <span className="visually-hidden">
                            {t('forOperator', { name: operator.name })}
                          </span>
                        </button>
                      ) : null}
                    </div>
                    {operator.active && smsInfo !== null && !smsInfo.configured ? (
                      <p className="cell-muted">{t('smsNotConfigured')}</p>
                    ) : null}
                  </td>
                  <td className="cell-actions">
                    {operator.active ? (
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={() => setPending({ kind: 'deactivate', operator })}
                      >
                        {t('deactivate')}
                        <span className="visually-hidden">
                          {t('forOperator', { name: operator.name })}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={() => void reactivate(operator)}
                      >
                        {t('activate')}
                        <span className="visually-hidden">
                          {t('forOperator', { name: operator.name })}
                        </span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ListPanel>

      {/* CREATE ONLY — no title branch, no `id` on the draft. See the file header. */}
      <Drawer
        open={draft !== null}
        onClose={closeDrawer}
        title={t('createHeading')}
        busy={busy}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeDrawer}>
              {t('cancel')}
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
              {busy ? t('submitting') : t('submitCreate')}
            </button>
          </>
        }
      >
        {draft === null ? null : (
          <form id={formId} onSubmit={onSubmit} noValidate>
            <p className="form-error" role="alert">
              {formError !== null ? t(formError) : saveError !== null ? tError(saveError) : ''}
            </p>

            <Field
              id={nameId}
              label={t('fieldName')}
              required
              error={fieldErrors.name === undefined ? undefined : t(fieldErrors.name)}
            >
              <input
                type="text"
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                maxLength={120}
                autoComplete="off"
                disabled={busy}
              />
            </Field>

            <Field
              id={phoneId}
              label={t('fieldPhone')}
              required
              help={
                phonePreview === null ? t('phoneHint') : t('phonePreview', { phone: phonePreview })
              }
              error={fieldErrors.phone === undefined ? undefined : t(fieldErrors.phone)}
            >
              <input
                type="tel"
                required
                value={draft.phone}
                onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                maxLength={40}
                autoComplete="off"
                disabled={busy}
              />
            </Field>
          </form>
        )}
      </Drawer>

      {/* Plain yes/no for the three actions that cannot be taken back by pressing the same
          button again — same shared-modal shape as /workers/. */}
      <ConfirmModal
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={confirmPending}
        title={
          pending === null
            ? ''
            : t(
                pending.kind === 'revoke'
                  ? 'revokeConfirmTitle'
                  : pending.kind === 'reissue'
                    ? 'reissueConfirmTitle'
                    : 'deactivateConfirmTitle',
                { name: pending.operator.name },
              )
        }
        body={
          pending === null
            ? ''
            : t(
                pending.kind === 'revoke'
                  ? 'revokeConfirmBody'
                  : pending.kind === 'reissue'
                    ? 'reissueConfirmBody'
                    : 'deactivateConfirmBody',
              )
        }
        confirmLabel={
          pending === null
            ? ''
            : pending.kind === 'revoke'
              ? t('codeRevoke')
              : pending.kind === 'reissue'
                ? t('codeReissue')
                : t('deactivate')
        }
        destructive
        busy={busy}
      />
    </>
  )
}
