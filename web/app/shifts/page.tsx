'use client'

import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  fetchShiftSnapshot,
  type Shift,
  type ShiftPatch,
  type ShiftSnapshot,
  updateShift,
} from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'
import { LOGIN_PATH } from '@/lib/nav'
import {
  blocksPayroll,
  durationMinutes,
  formatDuration,
  fromLocalInput,
  isPeriod,
  PERIODS,
  type Period,
  periodStart,
  type ShiftState,
  shiftState,
  toLocalInput,
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
 * Filtering and sorting happen in the browser over the single `/admin/data` payload: the
 * bundle is a static export (decision-16), the route takes no date range yet, and it
 * answers with at most `shift_limit` rows. That truncation is surfaced, never hidden.
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

const WORKER_ALL = 'all'
const LOCATION_ALL = 'all'

function draftOf(shift: Shift): Draft {
  return {
    id: shift.id,
    workerId: shift.worker_id,
    locationId: shift.location_id,
    start: toLocalInput(shift.start_time),
    end: shift.end_time === null ? '' : toLocalInput(shift.end_time),
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
  const startId = useId()
  const endId = useId()
  const endHintId = useId()
  const editWorkerId = useId()
  const editLocationId = useId()
  const errorId = useId()
  const statusId = useId()
  const correctionHeadingId = useId()
  const correctionRef = useRef<HTMLHeadingElement>(null)

  // null = still loading. An empty list is a legitimate first-run state, not an error.
  const [snapshot, setSnapshot] = useState<ShiftSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  const [workerFilter, setWorkerFilter] = useState<string>(WORKER_ALL)
  const [locationFilter, setLocationFilter] = useState<string>(LOCATION_ALL)
  const [period, setPeriod] = useState<Period>('month')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<ErrorMessage | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

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

  /**
   * The period boundary is pinned to the moment the list was rendered rather than
   * recomputed per row, so a filter cannot change meaning halfway down the table.
   */
  const visible = useMemo(() => {
    const from = periodStart(period, new Date())
    return shifts
      .filter((shift) => {
        if (workerFilter !== WORKER_ALL && String(shift.worker_id) !== workerFilter) return false
        if (locationFilter !== LOCATION_ALL && shift.location_id !== locationFilter) return false
        if (from !== null && new Date(shift.start_time).getTime() < from.getTime()) return false
        return true
      })
      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
  }, [shifts, workerFilter, locationFilter, period])

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

    const start = fromLocalInput(draft.start)
    const end = fromLocalInput(draft.end)

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

  const periodLabel: Record<Period, string> = {
    week: t('periodWeek'),
    month: t('periodMonth'),
    quarter: t('periodQuarter'),
    year: t('periodYear'),
    all: t('periodAll'),
  }

  const stateLabel: Record<ShiftState, string> = {
    open: t('stateOpen'),
    unresolved: t('stateUnresolved'),
    resolved: t('stateResolved'),
    complete: t('stateComplete'),
  }

  const formErrorText = formError === null ? '' : t(formError)

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
          </div>
        </div>

        {/* Live region: the table has no other way to tell a screen reader that changing
            a select just changed what is below it. */}
        <p role="status">
          {snapshot === null
            ? ''
            : `${t('resultCount', { count: visible.length })} ${
                blockedCount === 0 ? t('noneBlocked') : t('blockedCount', { count: blockedCount })
              }`}
        </p>

        {truncated ? (
          <p className="notice">{t('truncated', { limit: snapshot.shift_limit })}</p>
        ) : null}
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
                aria-describedby={`${startId}-error`}
                aria-invalid={fieldErrors.start !== undefined}
                disabled={busy}
              />
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
        ) : shifts.length === 0 ? (
          <p>{t('emptyBody')}</p>
        ) : visible.length === 0 ? (
          <p>{t('emptyFiltered')}</p>
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
                    <td>
                      {format.dateTime(new Date(shift.start_time), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td>
                      {shift.end_time === null ? (
                        <span className="cell-muted">{t('endMissing')}</span>
                      ) : (
                        format.dateTime(new Date(shift.end_time), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
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
                            date: format.dateTime(new Date(shift.start_time), {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }),
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
