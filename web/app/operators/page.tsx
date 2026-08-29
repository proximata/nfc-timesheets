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
  clearOperatorLoginEmail,
  deactivateOperator,
  type FeatureFlag,
  type FreshOperatorCode,
  fetchFlags,
  fetchOperators,
  fetchSmsStatus,
  issueOperatorEnrolmentCode,
  type Operator,
  reactivateOperator,
  revokeOperatorEnrolmentCode,
  SMS_LOGIN_FLAG,
  type SmsStatus,
  saveOperator,
  sendOperatorEnrolmentCodeBySms,
  setOperatorLoginEmail,
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
 * CREATE, PLUS ONE EDITABLE FIELD. `POST /admin/operators` still has no update branch
 * (routes/admin.js's own comment: a phone that needs to change is a new identity claim, not an
 * edit of an old one), so there is no general edit mode and no `draftOf()`. The ONE exception
 * is the LOGIN ADDRESS (decision-64 §6): an address is a DOOR added to an existing identity
 * rather than the identity itself, and it has its own claim/release routes
 * (PUT/DELETE /admin/operators/:id/email), so it must be editable after the fact — otherwise
 * every operator created before decision-64 could never be given one. Hence the drawer has
 * two modes and the title branches on which one is open.
 *
 * `POST /operator/workers` — "create a worker from the phone" — is not this screen's job and
 * is not built anywhere in this tree: OPERATOR-MODEL.md §8 flags it as blocked on decision-41
 * (PROPOSED), and TASK-214 names the read-only "also a worker" link as the whole extent of
 * the worker relationship this screen shows.
 */

const WORKERS_PATH = '/workers/'

/** Mirrors the workers screen: 30 s is plenty against a 5-day code lifetime. */
const CODE_TICK_MS = 30_000

/**
 * `operatorId` absent = CREATE (name + phone + an optional address). Present = the
 * address-only edit of that existing operator; `name` is carried for the drawer's title and
 * `phone` is unused in that mode.
 */
type Draft = {
  operatorId?: number
  name: string
  phone: string
  /** THE LOGIN ADDRESS (`email_identities`, decision-64). '' = none / clear it. */
  loginEmail: string
  /** As loaded, never edited — tells `onSubmit` whether a write is needed at all. */
  originalLoginEmail: string | null
}

const EMPTY_DRAFT: Draft = { name: '', phone: '', loginEmail: '', originalLoginEmail: null }

/** Mirrors `server/lib/validate.js`'s deliberately-loose shape check. UX only. */
const EMAIL_RE = /^[^\s@,]+@[^\s@,.]+(\.[^\s@,.]+)+$/

type ErrorMessage =
  | 'errorNameRequired'
  | 'errorPhoneRequired'
  | 'errorPhoneInvalid'
  | 'errorPhoneClaimed'
  | 'errorLoginEmailInvalid'
  | 'errorLoginEmailClaimed'
  | 'errorRejected'
  | 'loginEmailNotSaved'

type FieldErrors = { name?: ErrorMessage; phone?: ErrorMessage; loginEmail?: ErrorMessage }

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
  const loginEmailId = useId()
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
  /**
   * The `sms_login` flag (decision-59 §3), a second gate orthogonal to the one above:
   * that one says whether Twilio is configured on this box, this says whether the SMS door
   * is switched on at all. Starts false and fails closed — with the flag off the send
   * route answers 503, so an optimistic button would break on press.
   */
  const [smsLogin, setSmsLogin] = useState(false)
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
        const [ops, sms, flags] = await Promise.all([
          fetchOperators(signal),
          // FAILS CLOSED, exactly like /workers/: an old server, a proxy hiccup or offline
          // never render as "configured" — the button ends up disabled with the same
          // sentence a real 503 would produce.
          fetchSmsStatus(signal).catch((cause) => {
            if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
            return { configured: false, missing: [], sender_kind: null } as SmsStatus
          }),
          // decision-59 §3, identical to /workers/: the `sms_login` flag is a SECOND gate
          // beside Twilio's, and an empty list on any failure reads as the flag being off.
          fetchFlags(signal).catch((cause) => {
            if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
            return [] as FeatureFlag[]
          }),
        ])
        setOperators(ops)
        setSmsInfo(sms)
        setSmsLogin(flags.some((flag) => flag.name === SMS_LOGIN_FLAG && flag.enabled))
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

  /** The address-only mode (decision-64 §6). Opened per row, never from the page header. */
  function openEmailEdit(operator: Operator) {
    setDraft({
      operatorId: operator.id,
      name: operator.name,
      phone: operator.phone_e164 ?? '',
      loginEmail: operator.login_email ?? '',
      originalLoginEmail: operator.login_email,
    })
    setFieldErrors({})
    setFormError(null)
    setSaveError(null)
    setNotice(null)
  }

  /**
   * Maps a failed write onto the field it belongs to. On CREATE a 409 can only be
   * phone_claimed (createOperator's own comment: `phone_identities_pkey` is its sole 23505
   * source); on the address write it can only be email_claimed. Both name NOBODY.
   */
  function reportSaveFailure(cause: unknown) {
    if (handleAuthLoss(cause)) return
    if (cause instanceof ApiError && cause.status === 409 && cause.code === 'phone_claimed') {
      setFieldErrors({ phone: 'errorPhoneClaimed' })
      setFormError('errorPhoneClaimed')
      return
    }
    if (cause instanceof ApiError && cause.status === 409 && cause.code === 'email_claimed') {
      setFieldErrors({ loginEmail: 'errorLoginEmailClaimed' })
      setFormError('errorLoginEmailClaimed')
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
    const editing = draft.operatorId !== undefined
    const phone = editing ? draft.phone : normaliseIdentityPhone(draft.phone)

    // Lower-cased and trimmed — the same two steps `identityEmail` does server-side, so an
    // untouched field compares equal to `originalLoginEmail` (already lower-case) and spends
    // no write at all.
    const rawEmail = draft.loginEmail.trim().toLowerCase()
    const loginEmail = rawEmail === '' ? null : rawEmail

    // Client-side validation is UX only — server/lib/validate.js decides for real, and the
    // collision check is server-only, structurally, forever (§7).
    const errors: FieldErrors = {}
    if (!editing) {
      if (name === '') errors.name = 'errorNameRequired'
      if (phone === null)
        errors.phone = draft.phone.trim() === '' ? 'errorPhoneRequired' : 'errorPhoneInvalid'
    }
    if (loginEmail !== null && !EMAIL_RE.test(loginEmail)) {
      errors.loginEmail = 'errorLoginEmailInvalid'
    }
    setFieldErrors(errors)
    setFormError(null)
    setSaveError(null)
    if (Object.keys(errors).length > 0 || phone === null) return

    setBusy(true)
    try {
      /*
       * THE ADDRESS IS ALWAYS ITS OWN WRITE (PUT/DELETE .../email), never folded into
       * `POST /admin/operators` — decision-64 §6 keeps the claim on its own route, exactly as
       * decision-45 does for the login phone on /workers/. On CREATE that means the operator
       * row lands FIRST and the address second, so a refused address leaves a real operator
       * behind rather than losing the whole form; the drawer stays open bound to that new id,
       * and a retry writes only what failed.
       */
      const operatorId = editing
        ? (draft.operatorId as number)
        : (await saveOperator({ name, phone })).id

      const emailChanged = loginEmail !== draft.originalLoginEmail
      if (emailChanged) {
        try {
          if (loginEmail === null) await clearOperatorLoginEmail(operatorId)
          else await setOperatorLoginEmail(operatorId, loginEmail)
        } catch (cause) {
          reportSaveFailure(cause)
          if (formErrorIsNotClaim(cause)) setFormError('loginEmailNotSaved')
          setDraft({ ...draft, operatorId })
          await load()
          return
        }
      }

      setNotice({
        ok: true,
        text: !emailChanged
          ? t(editing ? 'loginEmailSavedPlain' : 'saved')
          : `${t(editing ? 'loginEmailSavedPlain' : 'saved')} ${
              loginEmail === null
                ? t('loginEmailCleared')
                : t('loginEmailSaved', { email: loginEmail })
            }`,
      })
      closeDrawer()
      await load()
    } catch (cause) {
      reportSaveFailure(cause)
    } finally {
      setBusy(false)
    }
  }

  /**
   * A 409 already binds itself to the address field with its own sentence; anything else is a
   * half-applied save and needs saying in words rather than being swallowed by „gespeichert“.
   */
  function formErrorIsNotClaim(cause: unknown): boolean {
    return !(cause instanceof ApiError && cause.status === 409)
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
      it — never hidden — exactly like /workers/'s smsButtonDisabled. Two gates, not one
      (decision-59 §3): Twilio configured AND the `sms_login` flag on. The operator's own
      /auth/operator-sms/* routes are gated by that same flag server-side, so a button that
      ignored it would 503 on press. */
  function smsButtonDisabled(operator: Operator, sms: SmsStatus | null): boolean {
    return sms === null || !sms.configured || !smsLogin || operator.phone_e164 === null
  }

  /** Why it is greyed out, in words. The FLAG is named before Twilio when both are off:
      it is the deliberate state someone chose in this panel and can undo on /flags/,
      whereas „nicht eingerichtet" sends a director chasing credentials for no reason. */
  function smsDisabledNote(sms: SmsStatus | null): string | null {
    if (sms === null) return null
    if (!smsLogin) return t('smsLoginOff')
    if (!sms.configured) return t('smsNotConfigured')
    return null
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
                  <td>
                    {operator.phone_e164}
                    {/* The LOGIN ADDRESS (decision-64 §6) rides in the phone cell rather than
                        in a seventh column: this table already carries six and the two are
                        the same fact — „how does this person get in“ — in two channels. */}
                    <p className={operator.login_email === null ? 'cell-muted' : 'cell-code'}>
                      {operator.login_email === null
                        ? t('loginEmailNone')
                        : t('loginEmailRow', { email: operator.login_email })}
                    </p>
                    {operator.active ? (
                      <div className="cell-actions">
                        <button
                          type="button"
                          className="btn btn-quiet"
                          onClick={() => openEmailEdit(operator)}
                        >
                          {t('loginEmailEdit')}
                          <span className="visually-hidden">
                            {t('forOperator', { name: operator.name })}
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </td>
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
                    {operator.active && smsDisabledNote(smsInfo) !== null ? (
                      <p className="cell-muted">{smsDisabledNote(smsInfo)}</p>
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

      {/* TWO MODES: create, or the address-only edit of one existing operator. See the file
          header for why that one field is editable and nothing else is. */}
      <Drawer
        open={draft !== null}
        onClose={closeDrawer}
        title={
          draft?.operatorId === undefined
            ? t('createHeading')
            : t('loginEmailHeading', { name: draft.name })
        }
        busy={busy}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeDrawer}>
              {t('cancel')}
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
              {busy
                ? t('submitting')
                : draft?.operatorId === undefined
                  ? t('submitCreate')
                  : t('submitSave')}
            </button>
          </>
        }
      >
        {draft === null ? null : (
          <form id={formId} onSubmit={onSubmit} noValidate>
            <p className="form-error" role="alert">
              {formError !== null ? t(formError) : saveError !== null ? tError(saveError) : ''}
            </p>

            {/* Name and phone ARE the identity and are set once, at creation — so in the
                address-only mode they are not rendered at all rather than rendered disabled:
                a greyed control invites a director to look for the way to enable it. */}
            {draft.operatorId !== undefined ? null : (
              <>
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
                    phonePreview === null
                      ? t('phoneHint')
                      : t('phonePreview', { phone: phonePreview })
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
              </>
            )}

            {/* THE LOGIN ADDRESS (decision-64 §6) — optional in both modes, and always its own
                write. Clearing it releases the claim. */}
            <Field
              id={loginEmailId}
              label={t('fieldLoginEmail')}
              optional
              help={t('loginEmailHint')}
              error={fieldErrors.loginEmail === undefined ? undefined : t(fieldErrors.loginEmail)}
            >
              <input
                type="email"
                value={draft.loginEmail}
                onChange={(event) => setDraft({ ...draft, loginEmail: event.target.value })}
                maxLength={320}
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
