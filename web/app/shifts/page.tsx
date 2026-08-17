'use client'

import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from 'react'
import { AnswerBand } from '@/components/AnswerBand'
import { type AttentionItem, AttentionList } from '@/components/AttentionList'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
import { type BadgeState, StateBadge } from '@/components/StateBadge'
import {
  ApiError,
  createShift,
  fetchShiftSnapshot,
  type Shift,
  type ShiftPatch,
  type ShiftSnapshot,
  updateShift,
} from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'
import { LOGIN_PATH } from '@/lib/nav'
import {
  isPeriod,
  PERIODS,
  type Period,
  periodContaining,
  periodRange,
  withinRange,
} from '@/lib/period'
import {
  BUSINESS_TIME_ZONE,
  blocksPayroll,
  durationMinutes,
  formatDuration,
  fromBusinessInput,
  isManualEntry,
  overlappingShift,
  type ShiftState,
  shiftState,
  toBusinessInput,
} from '@/lib/shifts'

/**
 * Shift log — „Welche Schichten brauchen eine Entscheidung?"
 *
 * Two jobs. (1) Month-end verification: before payroll runs, every shift must be closed
 * and every auto-closed one resolved, because decision-10 keeps the rest out of the pay
 * total silently. Silence is the danger, so state is spelled out in words in its own
 * column, the shifts that block payroll are counted in the answer band at the top, and the
 * ones that need a decision are listed by name above the log.
 * (2) Correction: `PATCH /admin/shifts/:id` is how a forgotten tap-out becomes a paid
 * shift and how a shift filed against the wrong building gets moved.
 *
 * (3) Entry by hand: `POST /admin/shifts` files the day of a worker whose phone died or
 * whose tag was destroyed. Without it that person is paid EUR 0 and the only recovery is
 * SQL on the production box. Such a shift is labelled as hand-entered in the drawer AND in
 * its own column in the log, because payroll gets audited and a typed shift must never be
 * read as a tapped one.
 *
 * TWO DRAWERS, ONE JOB EACH, AND DELIBERATELY NOT ONE DRAWER BEHIND A MODE FLAG. Correcting
 * a shift allows an EMPTY end time (that is how a shift is put back to running); filing one
 * by hand REQUIRES it (the server refuses to open a shift by hand). One component holding
 * both rules is exactly how the two drift apart and start disagreeing about what a shift is.
 * Owner decision, this turn, and it is not an implementation detail.
 *
 * Filtering and sorting happen in the browser over the single UNBOUNDED `/admin/data`
 * payload, even though the route now takes `?from=&to=`. That is deliberate: this screen
 * has to be able to say "no shifts in August — 5 exist in earlier periods", and it can only
 * count what it holds. A server-bounded fetch would answer the period question and destroy
 * the only fact that tells an empty FILTER apart from an empty DATABASE. On 3 August 2026
 * the difference between those two readings was the difference between "fine" and "our
 * payroll data is gone". The payload is still capped at `shift_limit` rows and that
 * truncation is surfaced, never hidden.
 *
 * EVERY time on this screen — shown or typed — is Vienna wall-clock time, converted to and
 * from UTC in lib/shifts.ts and labelled as such. See BUSINESS_TIME_ZONE for why it is not
 * the browser's zone.
 */

type Draft = {
  id: number
  workerId: number
  locationId: string
  /** `YYYY-MM-DDTHH:mm` local time, as `<input type="datetime-local">` produces it. */
  start: string
  end: string
  /** The row as loaded, so only genuinely changed fields are sent. */
  original: Shift
}

/** Message keys inside the `shifts` namespace. */
type ErrorMessage =
  | 'errorStartRequired'
  | 'errorStartInvalid'
  | 'errorEndInvalid'
  | 'errorEndBeforeStart'
  | 'errorFuture'
  | 'errorGone'
  | 'errorRejected'

type FieldErrors = { start?: ErrorMessage; end?: ErrorMessage }

/**
 * The hand-entry drawer. Nothing is preselected: a wrong worker chosen by default is a wrong
 * payslip, so both selects start empty and the director has to name the person.
 */
type NewDraft = {
  workerId: string
  locationId: string
  /** `YYYY-MM-DDTHH:mm`, Vienna wall time. */
  start: string
  end: string
}

const EMPTY_NEW_DRAFT: NewDraft = { workerId: '', locationId: '', start: '', end: '' }

/** Message keys for the hand-entry drawer. */
type NewErrorMessage =
  | 'errorWorkerRequired'
  | 'errorLocationRequired'
  | 'errorStartRequired'
  | 'errorEndRequired'
  | 'errorStartInvalid'
  | 'errorEndInvalid'
  | 'errorEndBeforeStart'
  | 'errorFuture'
  | 'errorOverlapUnknown'
  | 'errorCreateRejected'

type NewFieldErrors = {
  worker?: NewErrorMessage
  location?: NewErrorMessage
  start?: NewErrorMessage
  end?: NewErrorMessage
}

const WORKER_ALL = 'all'
const LOCATION_ALL = 'all'

/**
 * The submit button lives in the drawer's footer and the fields in its body, so the two are
 * tied together by `form=` rather than by nesting. Constant ids, not `useId()`: only one
 * drawer is ever open, and an IDREF is easier to read in a DOM inspector than `:r7:`.
 */
const CORRECT_FORM_ID = 'shift-correct-form'
const CREATE_FORM_ID = 'shift-create-form'

/** How many rows „Zu entscheiden" names before it stops listing and starts counting. */
const TRIAGE_ROWS = 8

const ROW_CLASS: Record<ShiftState, string | undefined> = {
  open: 'is-open',
  unresolved: 'is-unres',
  resolved: 'is-corr',
  // A finished, payable shift is the normal case and gets no rule. Everything cannot be
  // highlighted; if it is, nothing is.
  complete: undefined,
}

const BADGE: Record<ShiftState, BadgeState> = {
  open: 'open',
  unresolved: 'unres',
  resolved: 'corr',
  complete: 'muted',
}

function draftOf(shift: Shift): Draft {
  return {
    id: shift.id,
    workerId: shift.worker_id,
    locationId: shift.location_id,
    start: toBusinessInput(shift.start_time),
    end: shift.end_time === null ? '' : toBusinessInput(shift.end_time),
    original: shift,
  }
}

export default function ShiftsPage() {
  const t = useTranslations('shifts')
  const tError = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()

  const workerFilterId = useId()
  const locationFilterId = useId()
  const periodFilterId = useId()
  const periodRangeId = useId()
  const startId = useId()
  const endId = useId()
  const editWorkerId = useId()
  const editLocationId = useId()

  const newWorkerId = useId()
  const newLocationId = useId()
  const newStartId = useId()
  const newEndId = useId()

  // null = still loading. An empty list is a legitimate first-run state, not an error.
  const [snapshot, setSnapshot] = useState<ShiftSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  const [workerFilter, setWorkerFilter] = useState<string>(WORKER_ALL)
  const [locationFilter, setLocationFilter] = useState<string>(LOCATION_ALL)
  /**
   * A ROLLING window, not the calendar month it used to be. On the 1st of a month a
   * calendar default renders an empty table to a company that worked all of yesterday, and
   * an empty table is exactly what a director reads as data loss.
   */
  const [period, setPeriod] = useState<Period>('last30Days')
  // Frozen at mount, so "last 30 days" cannot mean one thing at the top of the table and
  // another at the bottom, and cannot shift under a tab left open overnight.
  const [now] = useState(() => new Date())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ErrorMessage | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [newDraft, setNewDraft] = useState<NewDraft>(EMPTY_NEW_DRAFT)
  const [newFieldErrors, setNewFieldErrors] = useState<NewFieldErrors>({})
  const [newFormError, setNewFormError] = useState<NewErrorMessage | null>(null)
  // The shift the new one collides with, when we can name it. Beats an opaque refusal.
  const [clash, setClash] = useState<Shift | null>(null)
  const [created, setCreated] = useState(false)
  const [creating, setCreating] = useState(false)

  /**
   * `/shifts/?period=all`, as the dashboard's unresolved rows link to it. An unresolved
   * shift is usually OLDER than the 30-day default — that is what made it unresolved — so
   * arriving without a period would land on an empty table, which is the one reading this
   * product must never produce. Read from `location`, not `useSearchParams`, so the static
   * export needs no Suspense boundary; in an effect, so the prerendered HTML and the first
   * client render still agree.
   */
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('period')
    if (wanted !== null && isPeriod(wanted)) setPeriod(wanted)
  }, [])

  /** A dead session must not render an empty table that reads as "no shifts". */
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
        setSnapshot(await fetchShiftSnapshot(signal))
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

  const shifts = snapshot?.shifts ?? []

  const range = useMemo(() => periodRange(period, now), [period, now])

  /** Everything the worker/building filters keep, before the period is applied. */
  const matching = useMemo(
    () =>
      shifts
        .filter((shift) => {
          if (workerFilter !== WORKER_ALL && String(shift.worker_id) !== workerFilter) return false
          if (locationFilter !== LOCATION_ALL && shift.location_id !== locationFilter) return false
          return true
        })
        .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()),
    [shifts, workerFilter, locationFilter],
  )

  const visible = useMemo(
    () => matching.filter((shift) => withinRange(shift.start_time, range)),
    [matching, range],
  )

  /**
   * Shifts this worker/building filter keeps that the PERIOD is hiding. The number the
   * screen was missing: without it "no rows" cannot be told apart from "everything is gone",
   * and the director has no reason to prefer the harmless reading.
   */
  const outsideCount = matching.length - visible.length

  /**
   * The newest shift in the WHOLE ledger — not bounded by this period and not capped by the
   * row limit — and the period that would show it. The one-click escape from an empty
   * table, and the sentence that proves the records are still there.
   */
  const latestStart = snapshot?.shift_bounds.latest ?? null
  const latest = latestStart === null ? null : periodContaining(latestStart, now)
  const latestPeriod = latest === 'all' || latest === period ? null : latest

  /** The shifts on screen the payroll total will silently leave out — the whole point. */
  const blocked = visible.filter((shift) => blocksPayroll(shiftState(shift)))

  // The server LIMITs the shift list. Hitting that limit means older shifts exist and are
  // NOT on this screen; saying nothing would present a truncated month as a complete one.
  const truncated = snapshot !== null && snapshot.shifts.length >= snapshot.shift_limit

  /**
   * Opening a correction. There is no focus bookkeeping here on purpose: <Drawer> moves
   * focus in, traps it, and returns it to the control that opened it — and when a save
   * removes that control (a resolved shift leaves the triage list) lib/useOverlay.ts falls
   * back to #main-content instead of dropping the keyboard user on <body>.
   */
  function startCorrection(shift: Shift) {
    setCreateOpen(false)
    setDraft(draftOf(shift))
    setFieldErrors({})
    setFormError(null)
    setSaved(false)
  }

  function closeCorrection() {
    setDraft(null)
    setFieldErrors({})
    setFormError(null)
  }

  function openCreate() {
    setDraft(null)
    setNewFieldErrors({})
    setNewFormError(null)
    setClash(null)
    setCreated(false)
    setCreateOpen(true)
  }

  function closeCreate() {
    setCreateOpen(false)
    setNewFieldErrors({})
    setNewFormError(null)
    setClash(null)
  }

  function reportSaveFailure(cause: unknown) {
    if (handleAuthLoss(cause)) return
    if (cause instanceof ApiError && cause.status === 404) {
      setFormError('errorGone')
      return
    }
    if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
      setFormError('errorRejected')
      return
    }
    setFormError(null)
    setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || draft === null) return

    const start = fromBusinessInput(draft.start)
    const end = fromBusinessInput(draft.end)

    // Client-side validation is UX only — server/lib/validate.js decides for real.
    const errors: FieldErrors = {}
    if (draft.start.trim() === '') errors.start = 'errorStartRequired'
    else if (start === null) errors.start = 'errorStartInvalid'
    if (draft.end.trim() !== '' && end === null) errors.end = 'errorEndInvalid'
    if (start !== null && end !== null && new Date(end) <= new Date(start)) {
      errors.end = 'errorEndBeforeStart'
    }
    if (start !== null && new Date(start).getTime() > Date.now()) errors.start = 'errorFuture'
    if (end !== null && new Date(end).getTime() > Date.now()) errors.end = 'errorFuture'
    setFieldErrors(errors)
    setFormError(null)
    setSaved(false)
    if (Object.keys(errors).length > 0 || start === null) return

    // Only changed fields go on the wire: worker_id and location_id are re-validated
    // against ACTIVE rows, so resending an unchanged reference to a deactivated worker
    // or building would fail an edit that has nothing to do with either.
    const patch: ShiftPatch = {}
    if (start !== draft.original.start_time) patch.start_time = start
    if (end !== draft.original.end_time) patch.end_time = end
    if (draft.workerId !== draft.original.worker_id) patch.worker_id = draft.workerId
    if (draft.locationId !== draft.original.location_id) patch.location_id = draft.locationId

    setBusy(true)
    try {
      await updateShift(draft.id, patch)
      // The drawer closes and <Drawer> restores focus; the result is announced by the
      // PAGE's live region, which is still on screen after the drawer is gone.
      setDraft(null)
      setSaved(true)
      await load()
    } catch (cause) {
      reportSaveFailure(cause)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Every timestamp on this screen, in Vienna time. Passed explicitly rather than left to
   * the browser, so the table and the two drawers cannot disagree by an hour.
   */
  function showDateTime(iso: string): string {
    return format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BUSINESS_TIME_ZONE,
    })
  }

  function showTime(iso: string): string {
    return format.dateTime(new Date(iso), {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: BUSINESS_TIME_ZONE,
    })
  }

  /** File a shift that was never tapped. Its own drawer, its own validation rules. */
  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creating) return

    const workerId = Number(newDraft.workerId)
    const start = fromBusinessInput(newDraft.start)
    const end = fromBusinessInput(newDraft.end)

    // Client-side validation is UX only — server/lib/validate.js decides for real.
    const errors: NewFieldErrors = {}
    if (!Number.isInteger(workerId) || workerId <= 0) errors.worker = 'errorWorkerRequired'
    if (newDraft.locationId === '') errors.location = 'errorLocationRequired'
    if (newDraft.start.trim() === '') errors.start = 'errorStartRequired'
    else if (start === null) errors.start = 'errorStartInvalid'
    // Required, unlike a correction: POST /admin/shifts refuses to open a shift by hand.
    if (newDraft.end.trim() === '') errors.end = 'errorEndRequired'
    else if (end === null) errors.end = 'errorEndInvalid'
    if (start !== null && end !== null && new Date(end) <= new Date(start)) {
      errors.end = 'errorEndBeforeStart'
    }
    if (start !== null && new Date(start).getTime() > Date.now()) errors.start = 'errorFuture'
    if (end !== null && new Date(end).getTime() > Date.now()) errors.end = 'errorFuture'

    setNewFormError(null)
    setClash(null)
    setCreated(false)

    // Named collision check before the round trip: the server answers 409 either way, but
    // its body cannot reach here (ApiError carries no server text), and "Anna is already
    // recorded at Neuhaus 09:00–13:00" is the only version the director can act on.
    if (Object.keys(errors).length === 0 && start !== null && end !== null) {
      const existing = overlappingShift(shifts, workerId, start, end)
      if (existing !== null) {
        setNewFieldErrors({})
        setClash(existing)
        return
      }
    }

    setNewFieldErrors(errors)
    if (Object.keys(errors).length > 0 || start === null || end === null) return

    setCreating(true)
    try {
      await createShift({
        worker_id: workerId,
        location_id: newDraft.locationId,
        start_time: start,
        end_time: end,
      })
      setNewDraft(EMPTY_NEW_DRAFT)
      setCreateOpen(false)
      setCreated(true)
      await load()
    } catch (cause) {
      if (handleAuthLoss(cause)) return
      if (cause instanceof ApiError && cause.status === 409) {
        // The clashing shift is outside the page we hold, so it cannot be named.
        setNewFormError('errorOverlapUnknown')
      } else if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
        setNewFormError('errorCreateRejected')
      } else {
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
      }
    } finally {
      setCreating(false)
    }
  }

  const periodLabel: Record<Period, string> = {
    last30Days: t('periodLast30Days'),
    thisMonth: t('periodThisMonth'),
    lastMonth: t('periodLastMonth'),
    thisQuarter: t('periodThisQuarter'),
    thisYear: t('periodThisYear'),
    all: t('periodAll'),
  }

  /** `1. Juli 2026 bis 31. Juli 2026`. The range is half-open, so the last day is one ms back. */
  const showDay = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'long', timeZone: BUSINESS_TIME_ZONE })
  const rangeLabel =
    range.from === null || range.to === null
      ? t('rangeAll')
      : t('rangeLabel', {
          from: showDay(range.from),
          to: showDay(new Date(new Date(range.to).getTime() - 1).toISOString()),
        })

  const stateLabel: Record<ShiftState, string> = {
    open: t('stateOpen'),
    unresolved: t('stateUnresolved'),
    resolved: t('stateResolved'),
    complete: t('stateComplete'),
  }

  const clashText =
    clash === null
      ? ''
      : t('errorOverlap', {
          worker: clash.worker_name,
          location: clash.location_name,
          from: showDateTime(clash.start_time),
          to: clash.end_time === null ? t('endMissing') : showDateTime(clash.end_time),
        })

  const correctErrorText = formError === null ? '' : t(formError)
  // One refusal, whichever applies, in one sentence.
  const createErrorText = `${clashText} ${newFormError === null ? '' : t(newFormError)}`.trim()

  /**
   * THE PAGE'S OWN LIVE REGIONS, and they are not inside either drawer on purpose: Escape
   * closes a drawer at any moment, including mid-save, and a message that leaves with the
   * thing it is reporting on has not been read. The drawers repeat the refusal visually
   * (aria-hidden, so it is announced once) because a drawer is the whole screen on a phone
   * and a refusal nobody can see is a refusal nobody can act on.
   */
  const pageErrorText = [
    loadError === null ? null : tError(loadError),
    correctErrorText === '' ? null : correctErrorText,
    createErrorText === '' ? null : createErrorText,
  ]
    .filter((part) => part !== null)
    .join(' ')

  const pageStatusText = [saved ? t('saved') : null, created ? t('createSaved') : null]
    .filter((part) => part !== null)
    .join(' ')

  /**
   * „Zu entscheiden": one row per shift that is holding up the payroll, named, with the
   * decision one click away. NOT a table — these are not columns that line up, they are
   * things to be dealt with. The full log below still lists every one of them.
   */
  const triage: AttentionItem[] = blocked.slice(0, TRIAGE_ROWS).map((shift) => {
    const state = shiftState(shift)
    return {
      id: String(shift.id),
      who: shift.worker_name,
      where:
        state === 'open'
          ? t('rowOpen', { location: shift.location_name, time: showTime(shift.start_time) })
          : t('rowUnresolved', {
              location: shift.location_name,
              date: showDateTime(shift.start_time),
            }),
      state: BADGE[state],
      trailing: <StateBadge state={BADGE[state]} label={stateLabel[state]} />,
      openLabel: t('correct'),
      onOpen: () => startCorrection(shift),
    }
  })

  const hasTable = snapshot !== null && visible.length > 0

  return (
    <>
      <PageHeader
        title={t('heading')}
        question={t('question')}
        action={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            {t('createTitle')}
          </button>
        }
      />

      <p className="form-error" role="alert">
        {pageErrorText}
      </p>
      <p className="form-status" role="status">
        {pageStatusText}
      </p>

      {snapshot === null ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <>
          {/* The answer first: how much of what is on screen the pay total will leave out.
              AnswerBand IS this page's role="status" — it replaces the result sentence and
              must not be wrapped in a second live region. */}
          <AnswerBand
            cells={[
              {
                k: t('answerBlocked'),
                v: blocked.length,
                sub:
                  visible.length === 0
                    ? // A claim about an empty table is a claim about nothing, and saying
                      // "all of them count" over no rows is part of what made the empty
                      // table unreadable in the first place.
                      ''
                    : blocked.length === 0
                      ? t('noneBlocked')
                      : t('notPayable'),
              },
              {
                k: t('answerShown'),
                v: visible.length,
                calm: true,
                sub: [
                  rangeLabel,
                  outsideCount === 0 ? null : t('outsideCount', { count: outsideCount }),
                ]
                  .filter((part) => part !== null)
                  .join(' '),
              },
            ]}
          />

          <section aria-labelledby="shift-filters-heading">
            <h2 className="visually-hidden" id="shift-filters-heading">
              {t('filterHeading')}
            </h2>

            {/* No submit: each control filters a list already in memory, so there is nothing
                to wait for and a submit button would only add a step. */}
            <div className="filter-bar">
              <div className="field">
                <label htmlFor={workerFilterId}>{t('filterWorker')}</label>
                <select
                  id={workerFilterId}
                  value={workerFilter}
                  onChange={(event) => setWorkerFilter(event.target.value)}
                >
                  <option value={WORKER_ALL}>{t('allWorkers')}</option>
                  {(snapshot?.workers ?? []).map((worker) => (
                    <option key={worker.id} value={String(worker.id)}>
                      {worker.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor={locationFilterId}>{t('filterLocation')}</label>
                <select
                  id={locationFilterId}
                  value={locationFilter}
                  onChange={(event) => setLocationFilter(event.target.value)}
                >
                  <option value={LOCATION_ALL}>{t('allLocations')}</option>
                  {(snapshot?.locations ?? []).map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor={periodFilterId}>{t('filterPeriod')}</label>
                <select
                  id={periodFilterId}
                  value={period}
                  aria-describedby={periodRangeId}
                  onChange={(event) => {
                    if (isPeriod(event.target.value)) setPeriod(event.target.value)
                  }}
                >
                  {PERIODS.map((value) => (
                    <option key={value} value={value}>
                      {periodLabel[value]}
                    </option>
                  ))}
                </select>
                <p className="field-hint" id={periodRangeId}>
                  {rangeLabel}
                </p>
              </div>
            </div>

            {truncated ? (
              <p className="notice">{t('truncated', { limit: snapshot.shift_limit })}</p>
            ) : null}

            <p className="field-hint">{t('timeZoneHint')}</p>
          </section>

          {triage.length === 0 ? null : (
            <ListPanel title={t('triageHeading')}>
              <AttentionList items={triage} />
            </ListPanel>
          )}

          {blocked.length > TRIAGE_ROWS ? (
            <p className="field-hint">{t('triageMore', { count: blocked.length - TRIAGE_ROWS })}</p>
          ) : null}

          <ListPanel title={t('listHeading')} padded={!hasTable}>
            {shifts.length === 0 && latestStart === null ? (
              <EmptyState>{t('emptyBody')}</EmptyState>
            ) : visible.length === 0 ? (
              /* The empty state that started all of this. It states, in words, how many
                 shifts exist just outside the chosen period and when the most recent one
                 was, and puts the way out one keystroke away. "Nothing here" and
                 "everything is gone" must never render the same. */
              <>
                <EmptyState>
                  {outsideCount === 0
                    ? t('emptyFiltered')
                    : t('emptyOutside', { count: outsideCount })}
                </EmptyState>
                {latestStart === null ? null : (
                  <p className="field-hint">
                    {t('latestRecorded', { date: showDateTime(latestStart) })}
                  </p>
                )}
                {outsideCount === 0 && latestStart === null ? null : (
                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setPeriod('all')}
                    >
                      {t('showAll')}
                    </button>
                    {latestPeriod === null ? null : (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setPeriod(latestPeriod)}
                      >
                        {t('jumpToLatest', { period: periodLabel[latestPeriod] })}
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <table className="data-table" aria-busy={busy || creating}>
                <caption className="visually-hidden">{t('tableCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('colWorker')}</th>
                    <th scope="col">{t('colLocation')}</th>
                    <th scope="col">{t('colStart')}</th>
                    <th scope="col">{t('colEnd')}</th>
                    <th scope="col">{t('colDuration')}</th>
                    <th scope="col">{t('colState')}</th>
                    <th scope="col">{t('colOrigin')}</th>
                    <th scope="col">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((shift) => {
                    const state = shiftState(shift)
                    return (
                      <tr key={shift.id} className={ROW_CLASS[state]}>
                        <th scope="row">{shift.worker_name}</th>
                        <td>{shift.location_name}</td>
                        <td>{showDateTime(shift.start_time)}</td>
                        <td>
                          {shift.end_time === null ? (
                            <span className="cell-muted">{t('endMissing')}</span>
                          ) : (
                            showDateTime(shift.end_time)
                          )}
                        </td>
                        <td>
                          {/* An open shift has no duration yet, and showing one frozen at
                              page load would be a number the admin could not act on. */}
                          {shift.end_time === null ? (
                            <span className="cell-muted">{t('durationRunning')}</span>
                          ) : (
                            formatDuration(durationMinutes(shift.start_time, shift.end_time))
                          )}
                        </td>
                        {/* Words first. The badge tint and the 3px row rule are the second
                            and third signals only — this column has to survive greyscale,
                            a screen reader and a printed page. */}
                        <td>
                          <StateBadge state={BADGE[state]} label={stateLabel[state]} />
                          <span className="shift-state-note">
                            {blocksPayroll(state) ? t('notPayable') : t('payable')}
                          </span>
                        </td>
                        {/* Its own column, in words: an auditor comparing this log against
                            the tap history has to be able to see at a glance which rows a
                            human typed. `client_uuid IS NULL` is the only record of it. */}
                        <td>
                          {isManualEntry(shift) ? (
                            <span className="shift-origin-manual">{t('originManual')}</span>
                          ) : (
                            <span className="cell-muted">{t('originTap')}</span>
                          )}
                        </td>
                        <td className="cell-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => startCorrection(shift)}
                          >
                            {t('correct')}
                            <span className="visually-hidden">
                              {t('forShift', {
                                worker: shift.worker_name,
                                date: showDateTime(shift.start_time),
                              })}
                            </span>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </ListPanel>
        </>
      )}

      {/* DRAWER 1 — correct an existing shift. End time OPTIONAL: clearing it puts the
          shift back to running, which is the only way to undo a wrong auto-close. */}
      <Drawer
        open={draft !== null}
        onClose={closeCorrection}
        title={t('correctHeading')}
        step={
          draft === null
            ? undefined
            : t('correctFor', {
                worker: draft.original.worker_name,
                location: draft.original.location_name,
              })
        }
        busy={busy}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={closeCorrection}
              disabled={busy}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form={CORRECT_FORM_ID}
              className="btn btn-primary"
              disabled={busy}
            >
              {busy ? t('submitting') : t('submitSave')}
            </button>
          </>
        }
      >
        {draft === null ? null : (
          <form id={CORRECT_FORM_ID} onSubmit={onSubmit} noValidate>
            {/* Visual only — the page's role="alert" above does the announcing. */}
            {correctErrorText === '' ? null : (
              <p className="form-error" aria-hidden="true">
                {correctErrorText}
              </p>
            )}

            {/* PATCH /admin/shifts/:id stamps `corrected_at` whenever an edit leaves an
                auto-closed shift with an end time — including an edit that changes nothing.
                Saving here therefore RESOLVES this shift and puts its hours into payroll,
                whether the end time was retyped or accepted as it stands. That is the
                intended way to accept the timer's guess, but it must not be a surprise. */}
            {shiftState(draft.original) === 'unresolved' ? (
              <p className="notice">{t('correctUnresolvedNotice')}</p>
            ) : null}

            <Field
              id={startId}
              label={t('fieldStart')}
              required
              help={t('timeZoneHint')}
              error={fieldErrors.start === undefined ? null : t(fieldErrors.start)}
            >
              <input
                type="datetime-local"
                required
                value={draft.start}
                onChange={(event) => setDraft({ ...draft, start: event.target.value })}
                disabled={busy}
              />
            </Field>

            <Field
              id={endId}
              label={t('fieldEnd')}
              optional
              help={t('endHint')}
              error={fieldErrors.end === undefined ? null : t(fieldErrors.end)}
            >
              <input
                type="datetime-local"
                value={draft.end}
                onChange={(event) => setDraft({ ...draft, end: event.target.value })}
                disabled={busy}
              />
            </Field>

            {/* Only ACTIVE rows are offered: the server rejects a shift pointed at a
                deactivated worker or building. The current one is listed regardless so
                the select can show what the shift actually says today. */}
            <Field id={editWorkerId} label={t('fieldWorker')}>
              <select
                value={String(draft.workerId)}
                onChange={(event) => setDraft({ ...draft, workerId: Number(event.target.value) })}
                disabled={busy}
              >
                {(snapshot?.workers ?? [])
                  .filter((worker) => worker.active || worker.id === draft.original.worker_id)
                  .map((worker) => (
                    <option key={worker.id} value={String(worker.id)}>
                      {worker.active ? worker.name : t('inactiveOption', { name: worker.name })}
                    </option>
                  ))}
              </select>
            </Field>

            <Field id={editLocationId} label={t('fieldLocation')}>
              <select
                value={draft.locationId}
                onChange={(event) => setDraft({ ...draft, locationId: event.target.value })}
                disabled={busy}
              >
                {(snapshot?.locations ?? [])
                  .filter(
                    (location) => location.active || location.id === draft.original.location_id,
                  )
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.active
                        ? location.name
                        : t('inactiveOption', { name: location.name })}
                    </option>
                  ))}
              </select>
            </Field>
          </form>
        )}
      </Drawer>

      {/* DRAWER 2 — file a shift that was never tapped. End time REQUIRED, because
          POST /admin/shifts refuses to open a shift by hand. A SEPARATE drawer from the
          correction above, and not the same one behind a flag: that is how these two rules
          drift apart. */}
      <Drawer
        open={createOpen}
        onClose={closeCreate}
        title={t('createTitle')}
        busy={creating}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={closeCreate}
              disabled={creating}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form={CREATE_FORM_ID}
              className="btn btn-primary"
              disabled={creating}
            >
              {creating ? t('submitting') : t('submitCreate')}
            </button>
          </>
        }
      >
        <form id={CREATE_FORM_ID} onSubmit={onCreate} noValidate>
          {/* Visual only — the page's role="alert" above does the announcing. */}
          {createErrorText === '' ? null : (
            <p className="form-error" aria-hidden="true">
              {createErrorText}
            </p>
          )}

          <p>{t('createIntro')}</p>

          {/* Said BEFORE the fields, not after them: what this button produces is a shift
              marked as hand-entered forever, and that is not something to discover later. */}
          <p className="notice">{t('createManualNotice')}</p>

          {/* ACTIVE rows only: the server refuses a shift pointed at a deactivated worker
              or building, and there is no existing value to preserve on a new shift. */}
          <Field
            id={newWorkerId}
            label={t('fieldWorker')}
            required
            error={newFieldErrors.worker === undefined ? null : t(newFieldErrors.worker)}
          >
            <select
              required
              value={newDraft.workerId}
              onChange={(event) => setNewDraft({ ...newDraft, workerId: event.target.value })}
              disabled={creating}
            >
              <option value="">{t('choosePlaceholder')}</option>
              {(snapshot?.workers ?? [])
                .filter((worker) => worker.active)
                .map((worker) => (
                  <option key={worker.id} value={String(worker.id)}>
                    {worker.name}
                  </option>
                ))}
            </select>
          </Field>

          <Field
            id={newLocationId}
            label={t('fieldLocation')}
            required
            error={newFieldErrors.location === undefined ? null : t(newFieldErrors.location)}
          >
            <select
              required
              value={newDraft.locationId}
              onChange={(event) => setNewDraft({ ...newDraft, locationId: event.target.value })}
              disabled={creating}
            >
              <option value="">{t('choosePlaceholder')}</option>
              {(snapshot?.locations ?? [])
                .filter((location) => location.active)
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </select>
          </Field>

          <Field
            id={newStartId}
            label={t('fieldStart')}
            required
            help={t('timeZoneHint')}
            error={newFieldErrors.start === undefined ? null : t(newFieldErrors.start)}
          >
            <input
              type="datetime-local"
              required
              value={newDraft.start}
              onChange={(event) => setNewDraft({ ...newDraft, start: event.target.value })}
              disabled={creating}
            />
          </Field>

          <Field
            id={newEndId}
            label={t('fieldEnd')}
            required
            error={newFieldErrors.end === undefined ? null : t(newFieldErrors.end)}
          >
            <input
              type="datetime-local"
              required
              value={newDraft.end}
              onChange={(event) => setNewDraft({ ...newDraft, end: event.target.value })}
              disabled={creating}
            />
          </Field>
        </form>
      </Drawer>
    </>
  )
}
