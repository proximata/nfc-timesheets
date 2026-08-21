'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import { ConfirmModal } from '@/components/ConfirmModal'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { FilterChips } from '@/components/FilterChips'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
import { WorkerPanel } from '@/components/WorkerPanel'
import {
  ApiError,
  type FreshEnrolmentCode,
  fetchWorkerSnapshot,
  issueEnrolmentCode,
  revokeEnrolmentCode,
  saveWorker,
  type Worker,
  type WorkerSnapshot,
} from '@/lib/api'
import { codeStateOf } from '@/lib/enrolment'
import { useFilters } from '@/lib/filters'
import type { ErrorKey } from '@/lib/locale'
import { centsToPlainEuros, parseEuroToCents } from '@/lib/money'
import { loginPathWithReturn } from '@/lib/nav'
import { BUSINESS_TIME_ZONE } from '@/lib/shifts'

/**
 * Workers screen — who may file hours, and how that person gets into the app.
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
 *
 * REDESIGN (B1): the list is read-only and every write happens in the drawer or behind a
 * confirmation. The fresh enrolment code deliberately did NOT become a modal: the director
 * reads it aloud over the phone while looking at that person's row, and a centred modal
 * covers the row. It stays an inline panel that focus moves to.
 */

/** How often the code column re-checks the clock. A code lives 5 days; 30 s is plenty. */
const CODE_TICK_MS = 30_000

/** Shape check only, mirroring server/lib/validate.js. Deliverability is not knowable here. */
const EMAIL_RE = /^[^\s@,]+@[^\s@,.]+(\.[^\s@,.]+)+$/

/**
 * Mirrors `optionalPhone` in server/lib/validate.js: digits and dialling punctuation only,
 * 4..40 characters. Deliberately not a country-specific format — the crew has Austrian
 * mobiles, landlines and foreign numbers, and a stricter rule would reject real ones.
 */
const PHONE_RE = /^[0-9+()/.\s-]{4,40}$/

/** /operators/ left the sidebar (decision-39) and this is its permanent way in. */
const OPERATORS_PATH = '/operators/'

type Draft = {
  /** Absent = create. Present = update that row. */
  id?: number
  name: string
  email: string
  /** Contact detail only. Never a credential — see `phoneHint`. */
  phone: string
  /**
   * Euros as typed. Converted to integer cents at submit by string slicing, never held as
   * a float and never multiplied (lib/money.ts).
   *
   * REQUIRED, and strictly positive (decision-41). `workers.hourly_rate_cents` lost its
   * DEFAULT and gained `CHECK (> 0)` in migration 006, so "nobody has told us yet" is a
   * state the database no longer admits and this form must not be able to produce.
   */
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
    // Always a real figure now: 006 refuses to store anything else, and it refused to
    // apply at all until the one rate-less row in production was dealt with by a human.
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
  | 'errorRateRequired'
  | 'errorRateInvalid'
  | 'errorRejected'

type FieldErrors = {
  name?: ErrorMessage
  email?: ErrorMessage
  phone?: ErrorMessage
  rate?: ErrorMessage
}

/** The one irreversible-or-destructive action waiting for a plain yes/no. */
type Pending = { kind: 'revoke' | 'reissue' | 'deactivate'; worker: Worker }

export default function WorkersPage() {
  const t = useTranslations('workers')
  const tFilter = useTranslations('filters')
  const tError = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()

  const formId = useId()
  const nameId = useId()
  const emailId = useId()
  const phoneId = useId()
  const rateId = useId()
  const activeId = useId()
  const codeHeadingId = useId()
  const codeValueId = useId()
  const codeOnceId = useId()
  const codePanelRef = useRef<HTMLElement>(null)

  // null = still loading. An empty worker list is the genuine first-run state, not an error.
  const [snapshot, setSnapshot] = useState<WorkerSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  /**
   * `?worker=<id>` opens the Mitarbeiterpanel; `?state=noEmail` narrows the list to the
   * people the dashboard's triage row names. Both are read from the URL so the dashboard's
   * „Adresse eintragen" lands on those people and not on the whole roster (decision-38).
   */
  const [filters, setFilters] = useFilters()
  /** null = the drawer is closed. There is no half-open form on this screen any more. */
  const [draft, setDraft] = useState<Draft | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ErrorMessage | null>(null)
  /** A 5xx or an offline browser during a SAVE. Shown in the drawer, which stays open. */
  const [saveError, setSaveError] = useState<ErrorKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  /** The code just created, shown once. Unrecoverable afterwards — see `issueEnrolmentCode`. */
  const [freshCode, setFreshCode] = useState<FreshEnrolmentCode | null>(null)
  /** Result of the last write, announced in the page's permanent live region. */
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
        setSnapshot(await fetchWorkerSnapshot(signal))
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

  function openEdit(worker: Worker) {
    setDraft(draftOf(worker))
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

  /** Maps a failed upsert onto the field it belongs to. 409 can only be the email index. */
  function reportSaveFailure(cause: unknown) {
    if (handleAuthLoss(cause)) return
    if (cause instanceof ApiError && cause.status === 409) {
      setFieldErrors({ email: 'errorEmailTaken' })
      setFormError('errorEmailTaken')
      return
    }
    // decision-41's own refusal, put on the field it is about. The client check above
    // should already have caught it; this is the case where they ever disagree, and „Der
    // Server hat diese Angaben abgelehnt" beside four fields is not something a director
    // can act on.
    if (cause instanceof ApiError && cause.code === 'rate_required') {
      setFieldErrors({ rate: 'errorRateRequired' })
      setFormError('errorRateRequired')
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
    const email = draft.email.trim()
    const phone = draft.phone.trim()
    /*
     * THE RATE IS REQUIRED AND STRICTLY POSITIVE (decision-41).
     *
     * An empty field used to mean 0, which meant "nobody has told us yet", which meant a
     * real person's hours sat in every report carrying no amount at all. That state is
     * gone from the schema, so it has to be gone from here: an empty field is now a
     * VALIDATION FAILURE and never a silent 0, and 0 itself is refused because a wage of
     * zero is not a wage. THIS BRANCH ALSO COVERS THE EDIT PATH — the route rewrites every
     * column, so an edit that cleared the field would have posted a 0 the server now
     * refuses with `422 rate_required`, and the drawer would have had nothing to say.
     */
    const typed = draft.rate.trim()
    const cents = typed === '' ? null : parseEuroToCents(typed)

    // Client-side validation is UX only — server/lib/validate.js decides for real.
    const errors: FieldErrors = {}
    if (name === '') errors.name = 'errorNameRequired'
    if (email !== '' && !EMAIL_RE.test(email)) errors.email = 'errorEmailShape'
    if (phone !== '' && !PHONE_RE.test(phone)) errors.phone = 'errorPhoneShape'
    if (typed === '') errors.rate = 'errorRateRequired'
    else if (cents === null || cents <= 0) errors.rate = 'errorRateInvalid'
    setFieldErrors(errors)
    setFormError(null)
    setSaveError(null)
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
      // The result is announced by the PAGE, not by the drawer: the drawer closes on
      // success and would take its own success message with it, unread.
      setNotice({ ok: true, text: t('saved') })
      closeDrawer()
      await load()
    } catch (cause) {
      // A FAILED save keeps the drawer open, so its message stays inside the drawer where
      // the fields it is about are. Nothing is carried away by a close that did not happen.
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

  /**
   * The modal is dismissed BEFORE the action runs, on purpose. Closing an overlay restores
   * focus to whatever opened it, and issuing a code moves focus to the fresh-code panel —
   * run in the other order, the restore fires last and steals the code panel's focus.
   */
  function confirmPending() {
    if (pending === null) return
    const { kind, worker } = pending
    setPending(null)
    if (kind === 'revoke') void revokeCode(worker)
    else if (kind === 'reissue') void issueCode(worker)
    else void toggleActive(worker)
  }

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

  /**
   * The row's state rule. Inactive is MUTED, not a problem: it was a decision somebody
   * made. An ACTIVE person with no email address is the problem this screen exists to
   * surface — they can never sign in on an iPhone (decision-22) — and it is carried by the
   * word in the email cell first and the 3px rule second.
   */
  function rowState(worker: Worker): string | undefined {
    if (!worker.active) return 'is-muted'
    return worker.email === null ? 'is-unres' : undefined
  }

  const all = snapshot?.workers ?? null
  /**
   * `?state=noEmail` — the only state this screen understands. Every other value in the
   * vocabulary is IGNORED silently (decision-38 §4): `/workers/?state=noTag` is not an
   * error, it is the worker list.
   *
   * The filter is applied over ACTIVE people only, exactly as the dashboard counts them: a
   * deactivated worker with no address cannot sign in either, but that is a decision
   * somebody made and not a thing to fix this morning.
   */
  const noEmailOnly = filters.state === 'noEmail'
  const workers =
    all === null
      ? null
      : noEmailOnly
        ? all.filter((worker) => worker.active && worker.email === null)
        : all

  /**
   * `?worker=<id>` resolved against the loaded roster. A well-formed id naming nobody keeps
   * the panel shut and says so in the chip — rendering the list as though no panel had been
   * asked for would leave the reader believing they are looking at that person.
   */
  const panelWorker =
    filters.worker === null ? null : (all?.find((worker) => worker.id === filters.worker) ?? null)
  const panelUnknown = filters.worker !== null && all !== null && panelWorker === null

  const openPanel = (id: number) => setFilters({ worker: id }, 'push')
  const closePanel = () => setFilters({ worker: null }, 'replace')

  const chips = [
    filters.worker === null
      ? null
      : {
          key: 'worker',
          label: tFilter('worker'),
          value: panelWorker?.name ?? tFilter('unknownWorker'),
          unknown: panelUnknown,
          onRemove: closePanel,
        },
    noEmailOnly
      ? {
          key: 'state',
          label: tFilter('state'),
          value: tFilter('stateNoEmail'),
          onRemove: () => setFilters({ state: null }, 'replace'),
        }
      : null,
  ].filter((chip) => chip !== null)

  const drawerTitle = draft?.id === undefined ? t('createHeading') : t('editHeading')
  const editedName = draft?.id === undefined ? undefined : draft.name
  // A server error during a save is shown inside the drawer as well, because the drawer
  // stays open on failure and the page-level copy of it is behind the scrim.
  const drawerError =
    formError !== null ? t(formError) : saveError !== null ? tError(saveError) : ''

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

      {/* Permanent live regions, on the PAGE and never inside an overlay: an overlay that
          closes on success takes its own success message with it, unread. A text change
          inside an existing region is also announced far more reliably than a node that
          appears and disappears, which is why neither is unmounted when empty. */}
      <p className="form-error" role="alert">
        {loadError === null ? '' : tError(loadError)}
      </p>
      <p className={notice?.ok === false ? 'form-error' : 'form-status'} role="status">
        {notice === null ? '' : notice.text}
      </p>

      {/* The filter, echoed and removable (decision-38 rule 3). Without it a list narrowed
          to two people by a link is indistinguishable from a roster of two people. */}
      <FilterChips chips={chips} />
      {panelUnknown ? <p className="notice bad">{tFilter('unknownNotice')}</p> : null}

      {/* THE WARNING COMES FIRST. "Shown only once" is useless underneath a code that has
          already scrolled past, so it stands here permanently, above the buttons that
          create one. It also says what a code is FOR, because the same paragraph has to
          stop a director concluding that the email address is now optional. */}
      <p className="note">{t('codeStandingNote')}</p>

      {/* The one and only sighting of the code. NOT a dialog (owner, explicitly): the
          director reads it out over the phone while looking at that person's row, and a
          centred modal covers the row. Focused on appearance (above), so it is not
          announced twice by also being a live region. */}
      {freshCode === null ? null : (
        <section
          className="note share-panel"
          ref={codePanelRef}
          tabIndex={-1}
          aria-labelledby={codeHeadingId}
          aria-describedby={codeOnceId}
        >
          <p id={codeHeadingId}>
            <strong>{t('codeReadyHeading', { name: freshCode.worker.name })}</strong>
          </p>
          <code className="code" id={codeValueId}>
            {freshCode.code}
          </code>
          {/* The expiry sits ABOVE the copy button, not below the fold: a code that expired
              silently already cost this project a second phone call. */}
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
          <p>{t('codeExplain', { name: freshCode.worker.name })}</p>
          <p id={codeOnceId}>{t('codeOnce')}</p>
        </section>
      )}

      <ListPanel
        title={t('listHeading')}
        padded={workers === null}
        action={
          <Link className="btn btn-quiet" href={OPERATORS_PATH}>
            {t('operatorsLink')}
          </Link>
        }
      >
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
        {workers === null ? (
          <p role="status">{loadError === null ? t('loading') : tError(loadError)}</p>
        ) : workers.length === 0 ? (
          /* An empty FILTER and an empty ROSTER are two different sentences. Saying „noch
             keine Mitarbeiter angelegt" to a company with six of them is the misreading
             this whole contract exists to prevent. */
          <EmptyState>{noEmailOnly ? t('filterNoEmail') : t('emptyBodyNew')}</EmptyState>
        ) : (
          <table className="data-table" aria-busy={busy}>
            <caption className="visually-hidden">{t('tableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('colName')}</th>
                <th scope="col">{t('colEmailLogin')}</th>
                <th scope="col">{t('colPhoneCall')}</th>
                <th scope="col">{t('colRate')}</th>
                <th scope="col">{t('colStatus')}</th>
                <th scope="col">{t('colCode')}</th>
                <th scope="col">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.id} className={rowState(worker)}>
                  {/* The name opens that person's panel. No extra column: the row already
                      carries five actions, and at 390px a sixth pushes the card sideways. */}
                  <th scope="row">
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => openPanel(worker.id)}
                    >
                      {worker.name}
                      <span className="visually-hidden"> {t('panelOpen')}</span>
                    </button>
                  </th>
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
                  {/* Always an amount. The „Kein Stundensatz hinterlegt" branch that used
                      to live here described a row the database can no longer hold
                      (decision-41), and a branch for an impossible state is a branch
                      nobody will ever see fail. */}
                  <td className="col-numeric num">
                    {format.number(worker.hourly_rate_cents / 100, {
                      style: 'currency',
                      currency: 'EUR',
                    })}
                  </td>
                  {/* Text, not a colour: the status has to survive greyscale and a screen reader.

                      WHAT THAT PERSON'S PHONE IS STILL HOLDING (TASK-225) goes HERE, as a
                      second line, and NOT as an eighth column: this table already carries
                      seven and a phone at 390px cannot take another. It belongs next to
                      Aktiv/Inaktiv because it is the same kind of fact — the state of that
                      person's ability to file hours — and because this is the screen with
                      their telephone number one cell to the left, which is what the director
                      does about it.

                      "Never reported" is said out loud rather than left blank. A blank cell
                      reads as "nothing pending", and on a fleet that has not been updated
                      yet that is a guess wearing the clothes of a measurement. */}
                  <td>
                    {worker.active ? t('statusActive') : t('statusInactive')}
                    {worker.phone_pending_shifts > 0 ? (
                      <p className="cell-code">
                        {t('phoneHolding', { shifts: worker.phone_pending_shifts })}
                      </p>
                    ) : null}
                    {worker.phone_pending_blocked > 0 ? (
                      <p className="cell-code">
                        {t('phoneBlocked', { blocked: worker.phone_pending_blocked })}
                      </p>
                    ) : null}
                    <p className="cell-muted">
                      {worker.phone_last_seen_at === null
                        ? t('phoneNeverSeen')
                        : t('phoneLastSeen', { date: dayTime(worker.phone_last_seen_at) })}
                    </p>
                  </td>
                  {/* Revoke sits in the open next to create, at the same weight. It is the
                      control used when a code went to the wrong person, and burying it in a
                      menu would cost seconds exactly when they matter. */}
                  <td>
                    <p className="cell-code">{codeStatusText(worker)}</p>
                    <div className="cell-actions">
                      {worker.active ? (
                        <button
                          type="button"
                          className="btn btn-quiet"
                          onClick={() =>
                            codeStateOf(worker, now) === 'live'
                              ? setPending({ kind: 'reissue', worker })
                              : issueCode(worker)
                          }
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
                          className="btn btn-quiet"
                          onClick={() => setPending({ kind: 'revoke', worker })}
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
                      className="btn btn-quiet"
                      onClick={() => openEdit(worker)}
                    >
                      {t('edit')}
                      <span className="visually-hidden">
                        {t('forWorker', { name: worker.name })}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() =>
                        worker.active
                          ? setPending({ kind: 'deactivate', worker })
                          : toggleActive(worker)
                      }
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
      </ListPanel>

      {/* ONE drawer, ONE job. Create and edit share it because they share every field and
          every validation rule; the two shift drawers do not, and are two drawers. */}
      <Drawer
        open={draft !== null}
        onClose={closeDrawer}
        title={drawerTitle}
        step={editedName}
        busy={busy}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeDrawer}>
              {t('cancel')}
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
              {busy
                ? t('submitting')
                : draft?.id === undefined
                  ? t('submitCreate')
                  : t('submitSave')}
            </button>
          </>
        }
      >
        {draft === null ? null : (
          <form id={formId} onSubmit={onSubmit} noValidate>
            {/* Kept in the DOM so the live region survives a re-render. */}
            <p className="form-error" role="alert">
              {drawerError}
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
              id={emailId}
              label={t('fieldEmail')}
              optional
              help={t('emailHint')}
              error={fieldErrors.email === undefined ? undefined : t(fieldErrors.email)}
            >
              <input
                type="email"
                value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                maxLength={320}
                autoComplete="off"
                disabled={busy}
              />
            </Field>

            {/* The phone number is NOT a login. A director who assumes it is would enrol the
                whole crew with numbers and nobody could sign in, so the field carries the
                distinction in its label AND in its hint. */}
            <Field
              id={phoneId}
              label={t('fieldPhone')}
              optional
              help={t('phoneHint')}
              error={fieldErrors.phone === undefined ? undefined : t(fieldErrors.phone)}
            >
              <input
                type="tel"
                value={draft.phone}
                onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                maxLength={40}
                autoComplete="off"
                disabled={busy}
              />
            </Field>

            {/* REQUIRED on the label, `required` on the control (which is what announces
                it), and refused on submit. Three places, one rule: a person cannot be
                filed without the number their pay is computed from. */}
            <Field
              id={rateId}
              label={t('fieldRate')}
              required
              help={`${t('rateHint')} ${t('rateRequiredHint')}`}
              error={fieldErrors.rate === undefined ? undefined : t(fieldErrors.rate)}
            >
              <input
                type="text"
                inputMode="decimal"
                required
                value={draft.rate}
                onChange={(event) => setDraft({ ...draft, rate: event.target.value })}
                disabled={busy}
              />
            </Field>

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
          </form>
        )}
      </Drawer>

      {/* Plain yes/no for the three actions that cannot be taken back by pressing the same
          button again. The body states the CONSEQUENCE — "are you sure?" tells the reader
          nothing they did not already know. */}
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
                { name: pending.worker.name },
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

      {/* THE MITARBEITERPANEL — the `/workers/<id>` route that cannot exist under a static
          export. Driven by the URL, so it can be linked to from the shift log, the payroll
          table, the material queue and the building panel. */}
      <WorkerPanel
        worker={panelWorker}
        shifts={snapshot?.shifts ?? []}
        truncated={snapshot !== null && snapshot.shifts.length >= snapshot.shift_limit}
        now={now}
        onClose={closePanel}
      />
    </>
  )
}
