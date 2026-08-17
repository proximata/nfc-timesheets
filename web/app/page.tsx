'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { AnswerBand } from '@/components/AnswerBand'
import { type AttentionItem, AttentionList } from '@/components/AttentionList'
import { EmptyState } from '@/components/EmptyState'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
import { StateBadge } from '@/components/StateBadge'
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
 * Dashboard — „Muss ich gerade etwas tun?", answered in that order: the ANSWER first, then
 * the exceptions, then the reassurance.
 *
 * Deliberately not a metrics wall. Every block above the last one is either a person
 * currently on site, something that will cost somebody money if it is ignored, or a thing
 * that is already broken; and every one of them opens the screen that fixes it.
 *
 * THE LAST BLOCK IS THE EXCEPTION AND IT IS BOUNDED ON PURPOSE. The director opened an
 * admin panel that showed him nothing at all and concluded his data was gone; in fact five
 * clean shifts existed and the exception view correctly had nothing to report. So there is
 * now a recent-activity list. It carries NO period filter — every period filter in this app
 * is exactly what produced that misreading — no total, no badge, no colour and no count,
 * and it is not part of `problemCount`. It goes LAST so that "something is wrong" keeps the
 * top of the page. A "hours this month" tile was rejected for the same reason: on the 3rd
 * of August it would have read EUR 0,00 and raised the alarm all over again. The prototype's
 * third answer cell ("Diese Woche 38:20") is the same tile in a different hat and is
 * deliberately NOT built: on a Monday morning it reads 0:00 and means nothing.
 *
 * AN EMPTY „ZU ERLEDIGEN" LIST MUST READ AS „NICHTS ZU TUN", never as a screen that failed
 * to load. That is why the empty case is a sentence about the company and not a dash, and
 * why the checks that came back clean are still named — smaller — when something else did not.
 *
 * This screen WRITES NOTHING: one round trip, `GET /admin/data` (one payload) sliced five
 * ways, plus a refresh. So it has no drawer and no confirm modal, and every row here is a
 * jump to the screen that owns the fix.
 */

/** ops/sql/autoclose.sql closes an open shift at start + 8h (decision-10). */
const AUTO_CLOSE_MINUTES = 8 * 60

/** How many recent shifts the activity block shows. Named in the heading, never summed. */
const RECENT_SHIFTS = 10

/**
 * How many rows „Zu erledigen" shows before it stops listing and starts counting. A payload
 * capped at 2000 shifts can carry more unresolved ones than a screen should scroll through,
 * and a list you have to scroll is not an answer. The remainder is stated in words.
 */
const TRIAGE_ROWS = 8

/** How many people the answer band names before it counts the rest. */
const ONSITE_NAMES = 3

const SHIFTS_PATH = '/shifts/'
/**
 * Unresolved shifts are frequently OLDER than 30 days — that is what makes them unresolved —
 * and `/shifts/` defaults to the last 30 days. Jumping without a period would land the
 * director on an empty table, which is the one reading this whole product must never
 * produce. `/shifts/` reads this parameter on mount.
 */
const SHIFTS_ALL_PATH = '/shifts/?period=all'
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

  const unresolvedShifts =
    snapshot === null ? [] : snapshot.shifts.filter((shift) => shiftState(shift) === 'unresolved')

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

  const hourMinute = (iso: string) =>
    format.dateTime(new Date(iso), {
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

  const problemCount =
    unresolvedShifts.length + workersWithoutEmail.length + locationsWithoutShifts.length

  /**
   * One row per NAMED thing that needs doing. A count alone is not actionable — "3 Objekte
   * ohne Schicht" tells the director nothing he can act on this morning, and the names do.
   * Every row opens the screen that owns the fix; this one owns none of them.
   */
  const todo: AttentionItem[] = [
    ...unresolvedShifts.map(
      (shift): AttentionItem => ({
        id: `shift-${shift.id}`,
        who: shift.worker_name,
        where: t('rowUnresolved', {
          location: shift.location_name,
          date: dayTime(shift.start_time),
        }),
        state: 'unres',
        trailing: <StateBadge state="unres" label={t('badgeUnresolved')} />,
        openLabel: t('unresolvedLink'),
        onOpen: () => router.push(SHIFTS_ALL_PATH),
      }),
    ),
    ...workersWithoutEmail.map(
      (worker): AttentionItem => ({
        id: `worker-${worker.id}`,
        who: worker.name,
        where: t('rowNoEmail'),
        state: 'muted',
        trailing: <StateBadge state="muted" label={t('badgeNoEmail')} />,
        openLabel: t('noEmailLink'),
        onOpen: () => router.push(WORKERS_PATH),
      }),
    ),
    ...locationsWithoutShifts.map(
      (location): AttentionItem => ({
        id: `location-${location.id}`,
        who: location.name,
        where: t('rowDeadTag'),
        state: 'muted',
        trailing: <StateBadge state="muted" label={t('badgeDeadTag')} />,
        openLabel: t('deadTagLink'),
        onOpen: () => router.push(LOCATIONS_PATH),
      }),
    ),
  ]

  /** Which parts the number in the answer band is made of. Never just the total. */
  const todoParts = [
    unresolvedShifts.length === 0 ? null : t('toDoUnresolved', { count: unresolvedShifts.length }),
    workersWithoutEmail.length === 0
      ? null
      : t('toDoNoEmail', { count: workersWithoutEmail.length }),
    locationsWithoutShifts.length === 0
      ? null
      : t('toDoDeadTag', { count: locationsWithoutShifts.length }),
  ].filter((part) => part !== null)

  /**
   * The checks that came back clean, still named but typeset small. When EVERYTHING is
   * clean the list below says so on its own and this would be the same sentence twice.
   */
  const clearNotes =
    problemCount === 0
      ? []
      : [
          unresolvedShifts.length === 0 ? t('unresolvedNone') : null,
          workersWithoutEmail.length === 0 ? t('noEmailNone') : null,
          locationsWithoutShifts.length === 0 ? t('deadTagNone') : null,
        ].filter((note) => note !== null)

  const onSiteSub =
    openShifts.length === 0
      ? t('onSiteEmpty')
      : [
          ...openShifts
            .slice(0, ONSITE_NAMES)
            .map((shift) =>
              t('onSiteSince', { name: shift.worker_name, time: hourMinute(shift.start_time) }),
            ),
          openShifts.length > ONSITE_NAMES
            ? t('onSiteMore', { count: openShifts.length - ONSITE_NAMES })
            : null,
        ]
          .filter((part) => part !== null)
          .join(' · ')

  return (
    <>
      <PageHeader
        title={t('heading')}
        question={t('question')}
        action={
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void load()}
            disabled={busy}
          >
            {busy ? t('refreshing') : t('refresh')}
          </button>
        }
      />

      {/* Above the snapshot and independent of it: a failed refresh must not be able to
          present the previous payload as current without saying so. */}
      {loadError !== null ? (
        <p className="form-error" role="alert">
          {tError(loadError)}
        </p>
      ) : null}

      {snapshot === null ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <>
          {/* The answer, first. AnswerBand is the page's role="status" — it replaces the
              summary sentence this screen used to lead with, and it must not be wrapped
              in a second live region. */}
          <AnswerBand
            cells={[
              {
                k: t('triageHeading'),
                v: problemCount,
                sub: problemCount === 0 ? t('toDoNone') : todoParts.join(' · '),
              },
              {
                k: t('onSiteHeading'),
                v: openShifts.length,
                calm: true,
                sub: onSiteSub,
              },
            ]}
          />

          <ListPanel
            title={t('triageHeading')}
            action={
              <Link className="btn btn-quiet" href={SHIFTS_ALL_PATH}>
                {t('unresolvedLink')}
              </Link>
            }
          >
            {todo.length === 0 ? (
              /* „Leer heißt: nichts zu tun." Never a dash, never a blank panel: an empty
                 exception view is what a director once read as data loss. */
              <EmptyState>{t('allClear', { count: openShifts.length })}</EmptyState>
            ) : (
              <AttentionList items={todo.slice(0, TRIAGE_ROWS)} />
            )}
          </ListPanel>

          {todo.length > TRIAGE_ROWS ? (
            <p className="field-hint">{t('moreToDo', { count: todo.length - TRIAGE_ROWS })}</p>
          ) : null}

          {clearNotes.length > 0 ? <p className="field-hint">{clearNotes.join(' ')}</p> : null}

          {/* The shift list is capped by the server; do not let a truncated payload be
              read as "this building has never been cleaned". */}
          {snapshot.shifts.length >= snapshot.shift_limit ? (
            <p className="field-hint">{t('truncatedNote', { limit: snapshot.shift_limit })}</p>
          ) : null}

          <ListPanel title={t('onSiteHeading')}>
            {openShifts.length === 0 ? (
              <EmptyState>{t('onSiteEmpty')}</EmptyState>
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
                      <tr key={shift.id} className="is-open">
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
          </ListPanel>

          {/* The elapsed column is frozen at load and says so. */}
          <p className="field-hint">
            {t('asOf', {
              time: format.dateTime(asOf, {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: BUSINESS_TIME_ZONE,
              }),
            })}
          </p>

          {/* Last, and deliberately plain. Not a live region: it is not news, it is
              reassurance, and announcing it would compete with the answer band above. */}
          <ListPanel
            title={t('recentHeading', { count: RECENT_SHIFTS })}
            action={
              <Link className="btn btn-quiet" href={SHIFTS_PATH}>
                {t('recentLink')}
              </Link>
            }
          >
            {recentShifts.length === 0 ? (
              <EmptyState>{t('recentEmpty')}</EmptyState>
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
          </ListPanel>

          <p className="field-hint">{t('recentScope', { count: RECENT_SHIFTS })}</p>
        </>
      )}
    </>
  )
}
