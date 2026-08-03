'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { type AdminSnapshot, ApiError, fetchAdminSnapshot, type Shift } from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'
import { LOGIN_PATH } from '@/lib/nav'
import {
  BUSINESS_TIME_ZONE,
  blocksPayroll,
  durationMinutes,
  formatDuration,
  shiftState,
} from '@/lib/shifts'

/**
 * Dashboard — the answer to "is anything wrong right now?", plus one plain answer to "did
 * my people tap in at all?".
 *
 * Deliberately not a metrics wall. Every block above the last one is either a person
 * currently on site, something that will cost somebody money if it is ignored, or a thing
 * that is already broken; and every one of them links to the screen that fixes it.
 *
 * THE LAST BLOCK IS THE EXCEPTION AND IT IS BOUNDED ON PURPOSE. The director opened an
 * admin panel that showed him nothing at all and concluded his data was gone; in fact five
 * clean shifts existed and the exception view correctly had nothing to report. So there is
 * now a recent-activity list. It carries NO period filter — every period filter in this app
 * is exactly what produced that misreading — no total, no badge, no colour and no count,
 * and it is not part of `problemCount`. It goes LAST so that "something is wrong" keeps the
 * top of the page. A "hours this month" tile was rejected for the same reason: on the 3rd
 * of August it would have read EUR 0,00 and raised the alarm all over again.
 *
 * No new API: this is `GET /admin/data` (one round trip) sliced five ways.
 */

/** ops/sql/autoclose.sql closes an open shift at start + 8h (decision-10). */
const AUTO_CLOSE_MINUTES = 8 * 60

/** How many recent shifts the activity block shows. Named in the heading, never summed. */
const RECENT_SHIFTS = 10

const SHIFTS_PATH = '/shifts/'
const WORKERS_PATH = '/workers/'
const LOCATIONS_PATH = '/locations/'

export default function DashboardPage() {
  const t = useTranslations('home')
  const tError = useTranslations('error')
  const format = useFormatter()
  const router = useRouter()

  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * "How long has this person been on site" is read against the clock at load time, not a
   * ticking one: a per-second re-render of a live region is a screen-reader denial of
   * service. The refresh button is the way to get a newer answer, and it says so.
   */
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

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
      setBusy(true)
      try {
        setSnapshot(await fetchAdminSnapshot(signal))
        setLoadedAt(new Date())
        setLoadError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (handleAuthLoss(cause)) return
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
      } finally {
        setBusy(false)
      }
    },
    [handleAuthLoss],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const asOf = loadedAt ?? new Date()

  // Oldest first: the person most likely to be about to trip the 8h timer is at the top.
  const openShifts =
    snapshot === null
      ? []
      : snapshot.shifts
          .filter((shift) => shift.end_time === null)
          .sort((a, b) => a.start_time.localeCompare(b.start_time))

  const unresolvedCount =
    snapshot === null
      ? 0
      : snapshot.shifts.filter((shift) => shiftState(shift) === 'unresolved').length

  // A worker with no email can never sign in at all (decision-22), so they can never file
  // an hour. Silent and permanent until somebody notices it here.
  const workersWithoutEmail =
    snapshot === null ? [] : snapshot.workers.filter((w) => w.active && w.email === null)

  // An active building that appears in no loaded shift has probably never had a working
  // tag on the wall. Scoped to what was loaded, and the wording says so.
  const seenLocationIds = new Set(snapshot?.shifts.map((shift) => shift.location_id) ?? [])
  const locationsWithoutShifts =
    snapshot === null
      ? []
      : snapshot.locations.filter(
          (location) => location.active && !seenLocationIds.has(location.id),
        )

  /**
   * The last completed shifts, newest first. `/admin/data` already returns shifts in
   * `start_time DESC`, so this is a slice and not a sort.
   *
   * Completed means the same thing it means everywhere else: an end time that counts
   * towards pay. An open or unconfirmed shift is an EXCEPTION and belongs to the blocks
   * above, not to a list whose only job is to prove that recording works.
   */
  const recentShifts =
    snapshot === null
      ? []
      : snapshot.shifts
          .filter(
            // Narrowed, not cast: the duration column below must not be able to compile
            // against a null end time.
            (shift): shift is Shift & { end_time: string } =>
              shift.end_time !== null && !blocksPayroll(shiftState(shift)),
          )
          .slice(0, RECENT_SHIFTS)

  const minutesOnSite = (startIso: string) =>
    Math.round((asOf.getTime() - new Date(startIso).getTime()) / 60_000)

  // Vienna, explicitly — not the browser's zone. The shift log pins it too, and two screens
  // that name the same shift two hours (or one DAY, near midnight) apart is how a director
  // stops believing either of them.
  const clockTime = (iso: string) =>
    format.dateTime(new Date(iso), {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: BUSINESS_TIME_ZONE,
    })

  const dayTime = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BUSINESS_TIME_ZONE,
    })

  const problemCount = unresolvedCount + workersWithoutEmail.length + locationsWithoutShifts.length

  return (
    <>
      <h1>{t('heading')}</h1>
      <p className="lede">{t('intro')}</p>

      {loadError !== null ? (
        <p className="form-error" role="alert">
          {tError(loadError)}
        </p>
      ) : null}

      {snapshot === null ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <>
          <p className="page-summary" role="status">
            {problemCount === 0
              ? t('allClear', { count: openShifts.length })
              : t('needsAttention', { count: problemCount })}
          </p>

          <section aria-labelledby="onsite-heading">
            <h2 id="onsite-heading">{t('onSiteHeading')}</h2>
            {openShifts.length === 0 ? (
              <p>{t('onSiteEmpty')}</p>
            ) : (
              <table className="data-table" aria-busy={busy}>
                <caption className="visually-hidden">{t('onSiteCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('colWorker')}</th>
                    <th scope="col">{t('colLocation')}</th>
                    <th scope="col">{t('colSince')}</th>
                    <th scope="col">{t('colElapsed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {openShifts.map((shift) => {
                    const minutes = minutesOnSite(shift.start_time)
                    return (
                      <tr key={shift.id}>
                        <th scope="row">{shift.worker_name}</th>
                        <td>{shift.location_name}</td>
                        <td>{clockTime(shift.start_time)}</td>
                        {/* Text, not colour: the warning has to survive greyscale. */}
                        <td>
                          {t('elapsedValue', { duration: formatDuration(minutes) })}
                          {minutes >= AUTO_CLOSE_MINUTES ? ` — ${t('overdueFlag')}` : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            <p className="field-hint">
              {t('asOf', {
                time: format.dateTime(asOf, {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: BUSINESS_TIME_ZONE,
                }),
              })}
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="button-secondary"
                onClick={() => void load()}
                disabled={busy}
              >
                {busy ? t('refreshing') : t('refresh')}
              </button>
            </div>
          </section>

          <section aria-labelledby="triage-heading">
            <h2 id="triage-heading">{t('triageHeading')}</h2>
            <ul className="triage-list">
              {/* decision-10: an unresolved shift is unpaid work. The worker is also locked
                  out of clocking in until it is resolved, so this is urgent for two people. */}
              <li>
                {unresolvedCount === 0 ? (
                  t('unresolvedNone')
                ) : (
                  <>
                    {t('unresolvedSome', { count: unresolvedCount })}{' '}
                    <Link href={SHIFTS_PATH}>{t('unresolvedLink')}</Link>
                  </>
                )}
              </li>

              <li>
                {workersWithoutEmail.length === 0 ? (
                  t('noEmailNone')
                ) : (
                  <>
                    {t('noEmailSome', {
                      count: workersWithoutEmail.length,
                      names: workersWithoutEmail.map((w) => w.name).join(', '),
                    })}{' '}
                    <Link href={WORKERS_PATH}>{t('noEmailLink')}</Link>
                  </>
                )}
              </li>

              <li>
                {locationsWithoutShifts.length === 0 ? (
                  t('deadTagNone')
                ) : (
                  <>
                    {t('deadTagSome', {
                      count: locationsWithoutShifts.length,
                      names: locationsWithoutShifts.map((l) => l.name).join(', '),
                    })}{' '}
                    <Link href={LOCATIONS_PATH}>{t('deadTagLink')}</Link>
                  </>
                )}
              </li>
            </ul>
            {/* The shift list is capped by the server; do not let a truncated payload be
                read as "this building has never been cleaned". */}
            {snapshot.shifts.length >= snapshot.shift_limit ? (
              <p className="field-hint">{t('truncatedNote', { limit: snapshot.shift_limit })}</p>
            ) : null}
          </section>

          {/* Last, and deliberately plain. Not a live region: it is not news, it is
              reassurance, and announcing it would compete with the summary above. */}
          <section aria-labelledby="recent-heading">
            <h2 id="recent-heading">{t('recentHeading', { count: RECENT_SHIFTS })}</h2>
            {recentShifts.length === 0 ? (
              <p>{t('recentEmpty')}</p>
            ) : (
              <table className="data-table">
                <caption className="visually-hidden">{t('recentCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('colWhen')}</th>
                    <th scope="col">{t('colWorker')}</th>
                    <th scope="col">{t('colLocation')}</th>
                    <th scope="col">{t('colDuration')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentShifts.map((shift) => (
                    <tr key={shift.id}>
                      <th scope="row">{dayTime(shift.start_time)}</th>
                      <td>{shift.worker_name}</td>
                      <td>{shift.location_name}</td>
                      <td>{formatDuration(durationMinutes(shift.start_time, shift.end_time))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="field-hint">{t('recentScope', { count: RECENT_SHIFTS })}</p>
            <p>
              <Link href={SHIFTS_PATH}>{t('recentLink')}</Link>
            </p>
          </section>
        </>
      )}
    </>
  )
}
