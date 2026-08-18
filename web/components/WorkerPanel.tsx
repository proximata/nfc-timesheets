'use client'

import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'
import { Drawer } from '@/components/Drawer'
import type { Shift, Worker } from '@/lib/api'
import { codeStateOf } from '@/lib/enrolment'
import { filterHref } from '@/lib/filters'
import {
  BUSINESS_TIME_ZONE,
  blocksPayroll,
  durationMinutes,
  formatDuration,
  shiftState,
} from '@/lib/shifts'

/** How many recent shifts the panel names before it stops listing. Same bound as `/`. */
const RECENT_SHIFTS = 10

export type WorkerPanelProps = {
  /** null → the drawer is closed. */
  worker: Worker | null
  /** The whole loaded ledger. Sliced here; never refetched. */
  shifts: readonly Shift[]
  /** True → the shift payload hit the server's row cap, so every count below is a floor. */
  truncated: boolean
  /** Epoch ms, ticked by the screen, so „gültig bis 15:32" stops being true at 15:33. */
  now: number
  onClose: () => void
}

/**
 * MITARBEITERPANEL — the person as an object, at `/workers/?worker=<id>`.
 *
 * This is the `/workers/<id>` route that does not exist and cannot exist while the admin is
 * a static export (decision-16, decision-38). Two of JOURNEYS' named gaps live here: there
 * was no worker surface anywhere, and `/workers/` had no outgoing link at all. The loop it
 * closes was: read the name off `/shifts/`, go to `/workers/`, find them again, read the
 * rate, go back — four screens for one question, on a phone, in a stairwell.
 *
 * Everything is sliced from the payload `/workers/` already fetches. `/admin/data` has
 * always returned the shifts alongside the workers; this screen simply stopped throwing
 * them away. No new endpoint, no second round trip.
 *
 * A RATE OF 0 IS NOT A RATE. It is „nobody has told us", it is stated in those words here as
 * it is on the row, in payroll's caveat, in the P&L's method note and in the CSV — eight
 * surfaces were aligned on that and this is the ninth. It is never rendered as 0,00 €.
 */
export function WorkerPanel({ worker, shifts, truncated, now, onClose }: WorkerPanelProps) {
  const t = useTranslations('workers')
  const format = useFormatter()

  if (worker === null) return null

  const theirs = shifts.filter((shift) => shift.worker_id === worker.id)
  const open = theirs.filter((shift) => shift.end_time === null)
  const unresolved = theirs.filter((shift) => shiftState(shift) === 'unresolved')
  const recent = theirs
    .filter((shift) => shift.end_time !== null && !blocksPayroll(shiftState(shift)))
    .slice(0, RECENT_SHIFTS)

  const day = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BUSINESS_TIME_ZONE,
    })

  const codeState = codeStateOf(worker, now)
  const codeText = !worker.active
    ? t('codeInactive')
    : codeState === 'live'
      ? t('codeLive', { expires: day(worker.enrolment_code_expires_at ?? '') })
      : codeState === 'expired'
        ? t('codeExpired', { expires: day(worker.enrolment_code_expires_at ?? '') })
        : codeState === 'redeemed'
          ? t('codeRedeemed', { date: day(worker.enrolment_code_redeemed_at ?? '') })
          : t('codeNone')

  const links: { key: string; href: string; label: string }[] = [
    {
      key: 'shifts',
      // `period=all`: this is the person's whole record, which is what „meine Stunden
      // stimmen nicht" needs. A 30-day window answers a different question.
      href: filterHref('/shifts/', { worker: worker.id, period: 'all' }),
      label: t('panelLinkShifts'),
    },
  ]
  if (unresolved.length > 0) {
    links.push({
      key: 'unresolved',
      href: filterHref('/shifts/', { worker: worker.id, period: 'all', state: 'unresolved' }),
      label: t('panelLinkUnresolved', { count: unresolved.length }),
    })
  }
  const firstOpen = open[0]
  if (firstOpen !== undefined) {
    links.push(
      {
        key: 'close',
        // The shift id opens the correction drawer on arrival — one action, not a search.
        href: filterHref('/shifts/', {
          worker: worker.id,
          period: 'all',
          state: 'open',
          shift: firstOpen.id,
        }),
        label: t('panelLinkClose'),
      },
      {
        key: 'where',
        href: filterHref('/', { location: firstOpen.location_id }),
        label: t('panelLinkWhere', { name: firstOpen.location_name }),
      },
    )
  }
  links.push({
    key: 'payroll',
    // `lastMonth`, matching /payroll/'s own default: same period on both ends of the link.
    href: filterHref('/payroll/', { worker: worker.id, period: 'lastMonth' }),
    label: t('panelLinkPayroll'),
  })

  return (
    <Drawer open onClose={onClose} title={worker.name} step={t('panelStep')}>
      <dl className="panel-metrics">
        <dt>{t('panelOpenShift')}</dt>
        <dd>
          {firstOpen === undefined
            ? t('panelOpenShiftNone')
            : t('panelOpenShiftValue', {
                location: firstOpen.location_name,
                since: day(firstOpen.start_time),
              })}
        </dd>

        {/* No period filter: an unconfirmed shift from March still blocks this person's pay. */}
        <dt>{t('panelUnresolved')}</dt>
        <dd>
          {unresolved.length === 0
            ? t('panelUnresolvedNone')
            : t('panelUnresolvedSome', { count: unresolved.length })}
        </dd>

        <dt>{t('colCode')}</dt>
        <dd>{codeText}</dd>

        {/* 0 cents is not a rate anybody agreed. Never 0,00 €. */}
        <dt>{t('colRate')}</dt>
        <dd>
          {worker.hourly_rate_cents === 0
            ? t('noRate')
            : format.number(worker.hourly_rate_cents / 100, {
                style: 'currency',
                currency: 'EUR',
              })}
        </dd>

        <dt>{t('panelStatus')}</dt>
        {/* Words, not colour. Inactive means: cannot file an hour at all. */}
        <dd>{worker.active ? t('statusActive') : t('statusInactive')}</dd>

        {/* The email column is not a contact detail — it is the Sign in with Apple gate
            (decision-22) — so its absence is a named state here too, not a blank. */}
        <dt>{t('colEmailLogin')}</dt>
        <dd>{worker.email ?? t('noEmail')}</dd>
      </dl>

      {truncated ? <p className="notice bad">{t('panelTruncated')}</p> : null}

      <h3>{t('panelRecentHeading', { count: RECENT_SHIFTS })}</h3>
      {recent.length === 0 ? (
        <p className="empty-state">{t('panelRecentEmpty')}</p>
      ) : (
        <table className="data-table">
          <caption className="visually-hidden">
            {t('panelRecentCaption', { name: worker.name })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t('panelColWhen')}</th>
              <th scope="col">{t('panelColLocation')}</th>
              <th scope="col">{t('panelColDuration')}</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((shift) => (
              <tr key={shift.id}>
                <th scope="row">{day(shift.start_time)}</th>
                <td>
                  {/* The building is a link to its own panel, carrying its id. */}
                  <Link href={filterHref('/', { location: shift.location_id })}>
                    {shift.location_name}
                  </Link>
                </td>
                <td>
                  {shift.end_time === null
                    ? ''
                    : formatDuration(durationMinutes(shift.start_time, shift.end_time))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* The rate, in the panel, next to the hours it prices — and the standing caveat that
          there is only ONE rate column, so past hours are valued at today's number. Same
          fact /payroll/ and /contracts/ state; a third copy, because this is where a
          director looks before changing it. */}
      <p className="field-hint">{t('panelRateHistory')}</p>

      <h3>{t('panelLinksHeading')}</h3>
      <ul className="panel-links">
        {links.map((link) => (
          <li key={link.key}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
        {/* Rule 1: the zero is stated, not linked to. */}
        {unresolved.length === 0 ? (
          <li>
            <span className="panel-link-empty">{t('panelLinkNoUnresolved')}</span>
          </li>
        ) : null}
      </ul>
    </Drawer>
  )
}
