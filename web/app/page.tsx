'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { type AdminSnapshot, ApiError, fetchAdminSnapshot } from '@/lib/api'
import type { ErrorKey } from '@/lib/locale'
import { LOGIN_PATH } from '@/lib/nav'
import { formatDuration, shiftState } from '@/lib/shifts'

/**
 * Dashboard — the answer to "is anything wrong right now?", and nothing else.
 *
 * Deliberately not a metrics wall. Every block here is either a person currently on site,
 * something that will cost somebody money if it is ignored, or a thing that is already
 * broken; and every one of them links to the screen that fixes it. A number with no action
 * attached does not belong on this page.
 *
 * No new API: this is `GET /admin/data` (one round trip) sliced four ways.
 */

/** ops/sql/autoclose.sql closes an open shift at start + 8h (decision-10). */
const AUTO_CLOSE_MINUTES = 8 * 60

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

  const minutesOnSite = (startIso: string) =>
    Math.round((asOf.getTime() - new Date(startIso).getTime()) / 60_000)

  const clockTime = (iso: string) =>
    format.dateTime(new Date(iso), {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
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
              {t('asOf', { time: format.dateTime(asOf, { hour: '2-digit', minute: '2-digit' }) })}
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
        </>
      )}
    </>
  )
}
