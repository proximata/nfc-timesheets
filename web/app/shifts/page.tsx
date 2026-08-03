'use client'

import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
 * Shift log — what actually happened, and the only place to fix it.
 *
 * Two jobs. (1) Month-end verification: before payroll runs, every shift must be closed
 * and every auto-closed one resolved, because decision-10 keeps the rest out of the pay
 * total silently. Silence is the danger, so state is spelled out in words in its own
 * column and the shifts that block payroll are counted at the top of the screen.
 * (2) Correction: `PATCH /admin/shifts/:id` is how a forgotten tap-out becomes a paid
 * shift and how a shift filed against the wrong building gets moved.
 *
 * (3) Entry by hand: `POST /admin/shifts` files the day of a worker whose phone died or
 * whose tag was destroyed. Without it that person is paid EUR 0 and the only recovery is
 * SQL on the production box. Such a shift is labelled as hand-entered in the form AND in
 * its own column in the log, because payroll gets audited and a typed shift must never be
 * read as a tapped one.
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
 * The hand-entry form. Nothing is preselected: a wrong worker chosen by default is a wrong
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

/** Message keys for the hand-entry form. */
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
  const endHintId = useId()
  const editWorkerId = useId()
  const editLocationId = useId()
  const errorId = useId()
  const statusId = useId()
  const correctionHeadingId = useId()
  const correctionRef = useRef<HTMLHeadingElement>(null)

  const newWorkerId = useId()
  const newLocationId = useId()
  const newStartId = useId()
  const newEndId = useId()
  const newTimeZoneHintId = useId()
  const newErrorId = useId()
  const newStatusId = useId()
  const newHeadingId = useId()
  const newHeadingRef = useRef<HTMLHeadingElement>(null)

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

  const [newDraft, setNewDraft] = useState<NewDraft>(EMPTY_NEW_DRAFT)
  const [newFieldErrors, setNewFieldErrors] = useState<NewFieldErrors>({})
  const [newFormError, setNewFormError] = useState<NewErrorMessage | null>(null)
  // The shift the new one collides with, when we can name it. Beats an opaque refusal.
  const [clash, setClash] = useState<Shift | null>(null)
  const [created, setCreated] = useState(false)
  const [creating, setCreating] = useState(false)

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

  /** How many of the shifts on screen the payroll total will silently leave out. */
  const blockedCount = visible.filter((shift) => blocksPayroll(shiftState(shift))).length

  // The server LIMITs the shift list. Hitting that limit means older shifts exist and are
  // NOT on this screen; saying nothing would present a truncated month as a complete one.
  const truncated = snapshot !== null && snapshot.shifts.length >= snapshot.shift_limit

  function startCorrection(shift: Shift) {
    setDraft(draftOf(shift))
    setFieldErrors({})
    setFormError(null)
    setSaved(false)
    // The form mounts in this render; focus lands once it exists.
    window.requestAnimationFrame(() => correctionRef.current?.focus())
  }

  function cancelCorrection() {
    setDraft(null)
    setFieldErrors({})
    setFormError(null)
    correctionRef.current?.focus()
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
      setDraft(null)
      setSaved(true)
      await load()
      // The form just unmounted; put focus somewhere real instead of on <body>.
      correctionRef.current?.focus()
    } catch (cause) {
      reportSaveFailure(cause)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Every timestamp on this screen, in Vienna time. Passed explicitly rather than left to
   * the browser, so the table and the two forms cannot disagree by an hour.
   */
  function showDateTime(iso: string): string {
    return format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BUSINESS_TIME_ZONE,
    })
  }

  /** File a shift that was never tapped. Deliberately separate from the correction form. */
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
      setCreated(true)
      await load()
      // The submit button is disabled while saving, so focus would fall to <body>.
      newHeadingRef.current?.focus()
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

  const formErrorText = formError === null ? '' : t(formError)

  const clashText =
    clash === null
      ? ''
      : t('errorOverlap', {
          worker: clash.worker_name,
          location: clash.location_name,
          from: showDateTime(clash.start_time),
          to: clash.end_time === null ? t('endMissing') : showDateTime(clash.end_time),
        })
  // One alert region for both, so whichever refusal applies is announced in the same place.
  const newFormErrorText = `${clashText} ${newFormError === null ? '' : t(newFormError)}`.trim()

  return (
    <>
      <h1>{t('heading')}</h1>
      <p className="lede">{t('intro')}</p>

      <section aria-labelledby="shift-filters-heading">
        <h2 id="shift-filters-heading">{t('filterHeading')}</h2>

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

        {/* Live region: the table has no other way to tell a screen reader that changing
            a select just changed what is below it. The count of shifts the PERIOD is
            hiding is part of the same sentence on purpose — it is the fact that makes an
            empty table readable, and it must not be somewhere the eye can skip. */}
        <p role="status">
          {snapshot === null
            ? ''
            : [
                t('resultCount', { count: visible.length }),
                // Only when there IS something on screen for it to be about. "All of them
                // count towards pay" said over an empty table is a claim about nothing,
                // and it was part of what made the empty table unreadable in the first
                // place. The sentence that matters when the table is empty is the next one.
                visible.length === 0
                  ? null
                  : blockedCount === 0
                    ? t('noneBlocked')
                    : t('blockedCount', { count: blockedCount }),
                outsideCount === 0 ? null : t('outsideCount', { count: outsideCount }),
              ]
                .filter((part) => part !== null)
                .join(' ')}
        </p>

        {truncated ? (
          <p className="notice">{t('truncated', { limit: snapshot.shift_limit })}</p>
        ) : null}

        <p className="field-hint">{t('timeZoneHint')}</p>
      </section>

      <section aria-labelledby={newHeadingId}>
        {/* Focus target after a shift is filed. */}
        <h2 id={newHeadingId} ref={newHeadingRef} tabIndex={-1}>
          {t('createHeading')}
        </h2>
        <p>{t('createIntro')}</p>

        {/* Said before the form, not after it: what this button produces is a shift marked
            as hand-entered forever, and that is not something to discover afterwards. */}
        <p className="notice">{t('createManualNotice')}</p>

        <form className="worker-form" onSubmit={onCreate} noValidate>
          {/* Permanent live regions: a text change inside an existing region is announced
              far more reliably than a node that appears and disappears. */}
          <p className="form-error" id={newErrorId} role="alert">
            {newFormErrorText}
          </p>
          <p className="form-status" id={newStatusId} role="status">
            {created ? t('createSaved') : ''}
          </p>

          {/* ACTIVE rows only: the server refuses a shift pointed at a deactivated worker
              or building, and there is no existing value to preserve on a new shift. */}
          <div className="field">
            <label htmlFor={newWorkerId}>{t('fieldWorker')}</label>
            <select
              id={newWorkerId}
              value={newDraft.workerId}
              onChange={(event) => setNewDraft({ ...newDraft, workerId: event.target.value })}
              aria-describedby={`${newWorkerId}-error`}
              aria-invalid={newFieldErrors.worker !== undefined}
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
            <p className="field-error" id={`${newWorkerId}-error`} role="alert">
              {newFieldErrors.worker === undefined ? '' : t(newFieldErrors.worker)}
            </p>
          </div>

          <div className="field">
            <label htmlFor={newLocationId}>{t('fieldLocation')}</label>
            <select
              id={newLocationId}
              value={newDraft.locationId}
              onChange={(event) => setNewDraft({ ...newDraft, locationId: event.target.value })}
              aria-describedby={`${newLocationId}-error`}
              aria-invalid={newFieldErrors.location !== undefined}
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
            <p className="field-error" id={`${newLocationId}-error`} role="alert">
              {newFieldErrors.location === undefined ? '' : t(newFieldErrors.location)}
            </p>
          </div>

          <div className="field">
            <label htmlFor={newStartId}>{t('fieldStart')}</label>
            <input
              id={newStartId}
              type="datetime-local"
              value={newDraft.start}
              onChange={(event) => setNewDraft({ ...newDraft, start: event.target.value })}
              aria-describedby={`${newTimeZoneHintId} ${newStartId}-error`}
              aria-invalid={newFieldErrors.start !== undefined}
              disabled={creating}
            />
            <p className="field-hint" id={newTimeZoneHintId}>
              {t('timeZoneHint')}
            </p>
            <p className="field-error" id={`${newStartId}-error`} role="alert">
              {newFieldErrors.start === undefined ? '' : t(newFieldErrors.start)}
            </p>
          </div>

          <div className="field">
            <label htmlFor={newEndId}>{t('fieldEnd')}</label>
            <input
              id={newEndId}
              type="datetime-local"
              value={newDraft.end}
              onChange={(event) => setNewDraft({ ...newDraft, end: event.target.value })}
              aria-describedby={`${newTimeZoneHintId} ${newEndId}-error`}
              aria-invalid={newFieldErrors.end !== undefined}
              disabled={creating}
            />
            <p className="field-error" id={`${newEndId}-error`} role="alert">
              {newFieldErrors.end === undefined ? '' : t(newFieldErrors.end)}
            </p>
          </div>

          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={creating}>
              {creating ? t('submitting') : t('submitCreate')}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby={correctionHeadingId}>
        {/* Focus target after the form opens, saves or is cancelled. */}
        <h2 id={correctionHeadingId} ref={correctionRef} tabIndex={-1}>
          {t('correctHeading')}
        </h2>

        {/* Permanent live regions: a text change inside an existing region is announced
            far more reliably than a node that appears and disappears. */}
        <p className="form-error" id={errorId} role="alert">
          {formErrorText}
        </p>
        <p className="form-status" id={statusId} role="status">
          {saved ? t('saved') : ''}
        </p>

        {draft === null ? (
          <p>{t('correctIdle')}</p>
        ) : (
          <form className="worker-form" onSubmit={onSubmit} noValidate>
            <p className="field-hint">
              {t('correctFor', {
                worker: draft.original.worker_name,
                location: draft.original.location_name,
              })}
            </p>

            {/* PATCH /admin/shifts/:id stamps `corrected_at` whenever an edit leaves an
                auto-closed shift with an end time — including an edit that changes nothing.
                Saving here therefore RESOLVES this shift and puts its hours into payroll,
                whether the end time was retyped or accepted as it stands. That is the
                intended way to accept the timer's guess, but it must not be a surprise. */}
            {shiftState(draft.original) === 'unresolved' ? (
              <p className="notice">{t('correctUnresolvedNotice')}</p>
            ) : null}

            <div className="field">
              <label htmlFor={startId}>{t('fieldStart')}</label>
              <input
                id={startId}
                type="datetime-local"
                value={draft.start}
                onChange={(event) => setDraft({ ...draft, start: event.target.value })}
                aria-describedby={`${startId}-hint ${startId}-error`}
                aria-invalid={fieldErrors.start !== undefined}
                disabled={busy}
              />
              <p className="field-hint" id={`${startId}-hint`}>
                {t('timeZoneHint')}
              </p>
              <p className="field-error" id={`${startId}-error`} role="alert">
                {fieldErrors.start === undefined ? '' : t(fieldErrors.start)}
              </p>
            </div>

            <div className="field">
              <label htmlFor={endId}>{t('fieldEnd')}</label>
              <input
                id={endId}
                type="datetime-local"
                value={draft.end}
                onChange={(event) => setDraft({ ...draft, end: event.target.value })}
                aria-describedby={`${endHintId} ${endId}-error`}
                aria-invalid={fieldErrors.end !== undefined}
                disabled={busy}
              />
              <p className="field-hint" id={endHintId}>
                {t('endHint')}
              </p>
              <p className="field-error" id={`${endId}-error`} role="alert">
                {fieldErrors.end === undefined ? '' : t(fieldErrors.end)}
              </p>
            </div>

            {/* Only ACTIVE rows are offered: the server rejects a shift pointed at a
                deactivated worker or building. The current one is listed regardless so
                the select can show what the shift actually says today. */}
            <div className="field">
              <label htmlFor={editWorkerId}>{t('fieldWorker')}</label>
              <select
                id={editWorkerId}
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
            </div>

            <div className="field">
              <label htmlFor={editLocationId}>{t('fieldLocation')}</label>
              <select
                id={editLocationId}
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
            </div>

            <div className="form-actions">
              <button type="submit" className="button-primary" disabled={busy}>
                {busy ? t('submitting') : t('submitSave')}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={cancelCorrection}
                disabled={busy}
              >
                {t('cancel')}
              </button>
            </div>
          </form>
        )}
      </section>

      <section aria-labelledby="shift-list-heading">
        <h2 id="shift-list-heading">{t('listHeading')}</h2>

        {loadError !== null ? (
          <p className="form-error" role="alert">
            {tError(loadError)}
          </p>
        ) : null}

        {snapshot === null ? (
          <p role="status">{t('loading')}</p>
        ) : shifts.length === 0 && latestStart === null ? (
          <p>{t('emptyBody')}</p>
        ) : visible.length === 0 ? (
          /* The empty state that started all of this. It now states, in words, how many
             shifts exist just outside the chosen period and when the most recent one was,
             and puts the way out one keystroke away. "Nothing here" and "everything is
             gone" must never render the same. */
          <div className="notice">
            <p>
              {outsideCount === 0 ? t('emptyFiltered') : t('emptyOutside', { count: outsideCount })}
            </p>
            {latestStart === null ? null : (
              <p>{t('latestRecorded', { date: showDateTime(latestStart) })}</p>
            )}
            {outsideCount === 0 && latestStart === null ? null : (
              <p className="form-actions">
                <button type="button" className="button-primary" onClick={() => setPeriod('all')}>
                  {t('showAll')}
                </button>
                {latestPeriod === null ? null : (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setPeriod(latestPeriod)}
                  >
                    {t('jumpToLatest', { period: periodLabel[latestPeriod] })}
                  </button>
                )}
              </p>
            )}
          </div>
        ) : (
          <table className="data-table" aria-busy={busy}>
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
                const blocked = blocksPayroll(state)
                return (
                  <tr key={shift.id} className={blocked ? 'row-attention' : undefined}>
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
                      {/* An open shift has no duration yet, and showing one frozen at page
                          load would be a number the admin could not act on. */}
                      {shift.end_time === null ? (
                        <span className="cell-muted">{t('durationRunning')}</span>
                      ) : (
                        formatDuration(durationMinutes(shift.start_time, shift.end_time))
                      )}
                    </td>
                    {/* Words first. The class is a second signal only — this column has to
                        survive greyscale, a screen reader and a printed page. */}
                    <td>
                      <span className={`shift-state shift-state-${state}`}>
                        {stateLabel[state]}
                      </span>
                      <span className="shift-state-note">
                        {blocked ? t('notPayable') : t('payable')}
                      </span>
                    </td>
                    {/* Its own column, in words: an auditor comparing this log against the
                        tap history has to be able to see at a glance which rows a human
                        typed. `client_uuid IS NULL` is the only record of that fact. */}
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
                        className="button-secondary"
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
      </section>
    </>
  )
}
