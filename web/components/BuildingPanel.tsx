'use client'

import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'
import { Drawer } from '@/components/Drawer'
import type { Location, Shift } from '@/lib/api'
import { filterHref } from '@/lib/filters'
import { periodRange, withinRange } from '@/lib/period'
import {
  BUSINESS_TIME_ZONE,
  blocksPayroll,
  durationMinutes,
  formatDuration,
  shiftState,
} from '@/lib/shifts'

/** ops/sql/autoclose.sql closes an open shift at start + 8h (decision-10). Same as `/`. */
const AUTO_CLOSE_MINUTES = 8 * 60

export type BuildingPanelProps = {
  /** null → the drawer is closed. */
  building: Location | null
  /** The whole loaded ledger. Sliced here; never refetched. */
  shifts: readonly Shift[]
  /**
   * How many OPEN material requests this building has, or null while that list is still on
   * its way. Null suppresses both the number and the link — decision-38 rule 1 forbids a
   * link to a target we cannot yet promise is non-empty.
   */
  openMaterials: number | null
  /** True → the shift payload hit the server's row cap, so every count below is a floor. */
  truncated: boolean
  /** The clock the elapsed times were read against. Frozen at load, exactly like `/`. */
  asOf: Date
  onClose: () => void
}

/**
 * OBJEKTPANEL — the building as an object, and the eleven screens that hold a fact about it.
 *
 * This is the surface `/locations/<id>` would have been if the admin were not a static
 * export (decision-16, decision-38). It is reached at `/?location=<uuid>`, which means it
 * can be bookmarked, sent to somebody and re-opened — the point of the whole exercise.
 *
 * WHAT IT IS NOT: a report. Every number here exists to start a journey, and every one of
 * them is followed by a link that carries it. „3 nicht bestätigt" with no way to reach those
 * three is the filing cabinet this replaces.
 *
 * WHERE THE NUMBERS COME FROM, and what that costs. Everything is sliced from the shift
 * payload `/` already fetched — no second round trip, no new endpoint. That payload is
 * CAPPED at the server's row limit, so when it is truncated the panel says so in the same
 * words `/` uses: a capped list can under-report a building, and „zuletzt gereinigt: noch
 * nie" computed from a truncated list is a false statement about a real building.
 *
 * There is deliberately NO margin cell. Margin comes from the server's SQL over a period
 * (`/pl/`), and browser arithmetic over a capped payload would report a confident number
 * that is quietly too small. The link to `/pl/` carries the building and the period instead;
 * the screen that owns the number states it.
 */
export function BuildingPanel({
  building,
  shifts,
  openMaterials,
  truncated,
  asOf,
  onClose,
}: BuildingPanelProps) {
  const t = useTranslations('home')
  const format = useFormatter()

  if (building === null) return null

  const here = shifts.filter((shift) => shift.location_id === building.id)
  const onSite = here
    .filter((shift) => shift.end_time === null)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
  const unresolved = here.filter((shift) => shiftState(shift) === 'unresolved')
  /** Newest completed, payable shift. `undefined` is „noch nie", which is a real answer. */
  const lastCleaned = here.find(
    (shift) => shift.end_time !== null && !blocksPayroll(shiftState(shift)),
  )

  const month = periodRange('thisMonth', asOf)
  const monthShifts = here.filter((shift) => withinRange(shift.start_time, month))
  const monthMinutes = monthShifts.reduce(
    (sum, shift) =>
      shift.end_time === null || blocksPayroll(shiftState(shift))
        ? sum
        : sum + durationMinutes(shift.start_time, shift.end_time),
    0,
  )
  /** Recorded but not counted: an open or unconfirmed shift is PENDING, never zero. */
  const monthPending = monthShifts.filter((shift) => blocksPayroll(shiftState(shift))).length
  const target = building.target_minutes_per_month

  const clock = (iso: string) =>
    format.dateTime(new Date(iso), {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: BUSINESS_TIME_ZONE,
    })
  const day = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BUSINESS_TIME_ZONE,
    })

  /** „3 nicht bestätigt · 1 offen · 2 Material", every zero stated in its own words. */
  const openPoints = [
    unresolved.length === 0
      ? t('panelPointsNoUnresolved')
      : t('panelPointsUnresolved', { count: unresolved.length }),
    onSite.length === 0 ? t('panelPointsNoOpen') : t('panelPointsOpen', { count: onSite.length }),
    openMaterials === null
      ? t('panelPointsMaterialLoading')
      : openMaterials === 0
        ? t('panelPointsNoMaterial')
        : t('panelPointsMaterial', { count: openMaterials }),
  ].join(' · ')

  /**
   * Every link out of here, in one list, each label stating its filter BEFORE the click
   * (decision-38 rule 2). A link whose label is „Schichten" and whose target is filtered is
   * a link the reader has to click to find out what it did.
   */
  const links: { key: string; href: string; label: string }[] = [
    {
      key: 'shifts',
      href: filterHref('/shifts/', { location: building.id, period: 'thisMonth' }),
      label: t('panelLinkShifts'),
    },
  ]
  if (unresolved.length > 0) {
    // `period=all` is MANDATORY here. An unresolved shift is usually older than the shift
    // log's 30-day default — being old is what made it unresolved — so any other period
    // lands the director on an empty table holding the rows he was sent to fix.
    links.push({
      key: 'unresolved',
      href: filterHref('/shifts/', {
        location: building.id,
        period: 'all',
        state: 'unresolved',
      }),
      label: t('panelLinkUnresolved', { count: unresolved.length }),
    })
  }
  const firstOpen = onSite[0]
  if (firstOpen !== undefined) {
    // Carries the shift id, so the correction drawer is already open on arrival: this is
    // D5 („I could not clock out") answered in one action, from a stairwell.
    links.push({
      key: 'close',
      href: filterHref('/shifts/', {
        location: building.id,
        period: 'all',
        state: 'open',
        shift: firstOpen.id,
      }),
      label: t('panelLinkClose', { name: firstOpen.worker_name }),
    })
  }
  links.push(
    {
      key: 'payroll',
      // `lastMonth` matches /payroll/'s OWN default. A link that lands in a different
      // period than the screen it points at is the defect this contract exists to remove.
      href: filterHref('/payroll/', { location: building.id, period: 'lastMonth' }),
      label: t('panelLinkPayroll'),
    },
    {
      key: 'pl',
      href: filterHref('/pl/', { location: building.id, period: 'lastMonth' }),
      label: t('panelLinkPl'),
    },
    {
      key: 'contracts',
      href: filterHref('/contracts/', { location: building.id }),
      label: t('panelLinkContract'),
    },
    {
      key: 'analytics',
      href: filterHref('/analytics/', { location: building.id }),
      label: t('panelLinkAnalytics'),
    },
  )
  if (openMaterials !== null && openMaterials > 0) {
    links.push({
      key: 'materials',
      href: filterHref('/material-requests/', { location: building.id, status: 'open' }),
      label: t('panelLinkMaterials', { count: openMaterials }),
    })
  }
  links.push({
    key: 'edit',
    href: filterHref('/locations/', { open: building.id }),
    label: t('panelLinkEdit'),
  })
  if (building.client_id !== null) {
    links.push({
      key: 'client',
      href: filterHref('/clients/', { client: building.client_id }),
      label: t('panelLinkClient', { name: building.client_name ?? '' }),
    })
  }

  return (
    <Drawer open onClose={onClose} title={building.name} step={t('panelStep')}>
      <dl className="panel-metrics">
        {/* N1 — who is standing in this building right now. Frozen at load and says so. */}
        <dt>{t('panelOnSite')}</dt>
        <dd>
          {onSite.length === 0 ? (
            t('panelOnSiteEmpty')
          ) : (
            <ul className="panel-links">
              {onSite.map((shift) => {
                const minutes = Math.round(
                  (asOf.getTime() - new Date(shift.start_time).getTime()) / 60_000,
                )
                return (
                  <li key={shift.id}>
                    {/* The person is a link to their own panel: gaps 2 and 4 in one step —
                        today the only way to their rate is to read the name off this table
                        and find it again on another screen. */}
                    <Link href={filterHref('/workers/', { worker: shift.worker_id })}>
                      {/* The dashboard's own wording, reused rather than restated: two
                          spellings of „seit 08:15" is two strings to keep in step. */}
                      {t('onSiteSince', {
                        name: shift.worker_name,
                        time: clock(shift.start_time),
                      })}
                    </Link>
                    {/* Words, never colour: the overdue warning has to survive greyscale. */}
                    {minutes >= AUTO_CLOSE_MINUTES ? ` — ${t('overdueFlag')}` : ''}
                  </li>
                )
              })}
            </ul>
          )}
        </dd>

        {/* N2 — NO PERIOD FILTER. An unresolved shift from March is an open point today. */}
        <dt>{t('panelPoints')}</dt>
        <dd>{openPoints}</dd>

        {/* N3 — „noch nie" is a real answer and not an error. */}
        <dt>{t('panelLastCleaned')}</dt>
        <dd>
          {lastCleaned === undefined || lastCleaned.end_time === null
            ? t('panelLastCleanedNever')
            : t('panelLastCleanedValue', {
                date: day(lastCleaned.start_time),
                name: lastCleaned.worker_name,
                duration: formatDuration(
                  durationMinutes(lastCleaned.start_time, lastCleaned.end_time),
                ),
              })}
        </dd>

        {/* N4 — a missing target is „nicht vereinbart", never 0 %. */}
        <dt>{t('panelHours')}</dt>
        <dd>
          {target === null
            ? t('panelHoursNoTarget', { actual: formatDuration(monthMinutes) })
            : t('panelHoursTarget', {
                actual: formatDuration(monthMinutes),
                target: formatDuration(target),
              })}
          {monthPending === 0 ? '' : ` · ${t('panelHoursPending', { count: monthPending })}`}
        </dd>

        {/* N5 — the contract as recorded. No margin: see the file header. */}
        <dt>{t('panelContract')}</dt>
        <dd>
          {building.monthly_contract_cents === null
            ? t('panelContractNone')
            : t('panelContractValue', {
                amount: format.number(building.monthly_contract_cents / 100, {
                  style: 'currency',
                  currency: 'EUR',
                }),
              })}
          {' · '}
          {building.client_name ?? t('panelClientNone')}
        </dd>
      </dl>

      {/* The counts above are floors, not totals, when the payload was cut. Same sentence
          the dashboard prints, for the same reason: a truncated list read as a complete one
          says a building was never cleaned. */}
      {truncated ? <p className="notice bad">{t('panelTruncated')}</p> : null}

      <p className="field-hint">
        {t('asOf', {
          time: format.dateTime(asOf, {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: BUSINESS_TIME_ZONE,
          }),
        })}
      </p>

      <h3>{t('panelLinksHeading')}</h3>
      <ul className="panel-links">
        {links.map((link) => (
          <li key={link.key}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
        {/* Rule 1: no link to an empty target — the zero is stated in words instead. */}
        {openMaterials === 0 ? (
          <li>
            <span className="panel-link-empty">{t('panelLinkNoMaterials')}</span>
          </li>
        ) : null}
      </ul>
    </Drawer>
  )
}
