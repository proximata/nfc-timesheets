'use client'

import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'
import { useId, useState } from 'react'
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

export type BuildingFactsProps = {
  building: Location
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
  /**
   * WHICH FRAME THIS IS BEING RENDERED IN, and it is a layout fact rather than a content
   * one — the numbers and the links are identical in both.
   *
   *   'panel' the drawer and the phone bottom sheet: a full-height surface, so the numbers
   *           AND the links are on screen at once, which is the shape everything else in
   *           this admin has.
   *   'box'   the info box on a map pin: ~300px of room, measured, inside a map region that
   *           may not eat the fold (decision-39 §3). Five numbers and ten cross-links do not
   *           both fit in 300px at any legible size, and the version that pretended they did
   *           put ALL TEN LINKS below the box's own fold with no scrollbar and no expander —
   *           i.e. it hid the entire point of decision-38 on the landing surface. So the box
   *           is a DISCLOSURE: the numbers, and one control that says how many links there
   *           are and shows them. The owner's word for it was 'expandable' (IA-PLAN §9).
   */
  layout?: 'panel' | 'box'
}

/**
 * THE BUILDING AS AN OBJECT: five numbers and every screen that holds a fact about it.
 *
 * WHY THIS IS ITS OWN FILE. It is rendered in TWO places — inside the `<Drawer>`
 * (components/BuildingPanel.tsx) and inside the info box that expands on the map pin
 * (components/HomeMap.tsx) — and both are opened by the SAME `?location=` parameter. Two
 * copies of these numbers would be two things that can disagree about the same building on
 * the same screen, and „3 nicht bestätigt" in one box beside „2 nicht bestätigt" in another
 * is worse than either number being wrong on its own, because neither looks wrong.
 *
 * WHAT IT IS NOT: a report. Every number here exists to start a journey, and every one of
 * them is followed by a link that carries it (decision-38). „3 nicht bestätigt" with no way
 * to reach those three is the filing cabinet this replaces.
 *
 * WHERE THE NUMBERS COME FROM, and what that costs. Everything is sliced from the shift
 * payload `/` already fetched — no second round trip, no new endpoint. That payload is
 * CAPPED at the server's row limit, so when it is truncated this says so in the same words
 * `/` uses: a capped list can under-report a building, and „zuletzt gereinigt: noch nie"
 * computed from a truncated list is a false statement about a real building.
 *
 * There is deliberately NO margin cell. Margin comes from the server's SQL over a period
 * (`/pl/`), and browser arithmetic over a capped payload would report a confident number
 * that is quietly too small. The link to `/pl/` carries the building and the period instead;
 * the screen that owns the number states it.
 *
 * NO STREET VIEW, ANYWHERE. Dropped by the owner (IA-PLAN §9), not deferred: it removes the
 * per-building image cost and the question of putting a photograph of a customer's front
 * door on a screen. There is no `<img>` here and no metadata request; `streetViewUrl` in
 * lib/map.ts is still used by `/analytics/` and is not this screen's business.
 */
export function BuildingFacts({
  building,
  shifts,
  openMaterials,
  truncated,
  asOf,
  layout = 'panel',
}: BuildingFactsProps) {
  const t = useTranslations('home')
  const format = useFormatter()
  /**
   * Which face of the box is showing. VIEW STATE, deliberately not a URL parameter: the URL
   * says WHICH BUILDING is open (decision-38) and a link somebody is sent must open the same
   * thing every time. It resets when another building is selected, because that is a
   * different box.
   */
  const [linksOpen, setLinksOpen] = useState(false)
  const linksId = useId()

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

  const numbers = (
    <>
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
    </>
  )

  const linkList = (
    <>
      {/* `panel-links-out` carries no styling. It is a HOOK: the on-site cell above is also a
          `.panel-links` list, so a check reaching for „the links out of this building" with a
          loose selector finds a worker link and passes while every cross-link is unreachable.
          That is not hypothetical — it happened while this file was being checked. */}
      <ul className="panel-links panel-links-out">
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
    </>
  )

  /**
   * THE DRAWER AND THE BOTTOM SHEET: both at once, in the order the reader asks the
   * question — what is going on here, then what can I do about it.
   */
  if (layout === 'panel') {
    return (
      <>
        {numbers}
        <h3>{t('panelLinksHeading')}</h3>
        {linkList}
      </>
    )
  }

  /**
   * THE INFO BOX ON A PIN: one face at a time, with the control between them saying HOW MANY
   * links are behind it. The count is the affordance — a bare chevron is a thing to ignore,
   * '10 Verknuepfungen' is a thing to press.
   *
   * Both faces stay MOUNTED and are hidden with the `hidden` attribute rather than unmounted:
   * `hidden` takes them out of the tab order and out of the accessibility tree (which an
   * `overflow: hidden` fold never did — that is how ten links ended up reachable only by a
   * wheel gesture over a box with no scrollbar), while a check can still ask the DOM whether
   * the box carries the same links the drawer does. It does; the two are one component.
   */
  return (
    <>
      <div className="map-info-face" hidden={linksOpen}>
        {numbers}
      </div>
      <button
        type="button"
        className="map-info-expand"
        aria-expanded={linksOpen}
        aria-controls={linksId}
        onClick={() => setLinksOpen((open) => !open)}
      >
        <span aria-hidden="true">{linksOpen ? '▴' : '▾'}</span>{' '}
        {t('panelLinksToggle', { count: links.length })}
      </button>
      <div className="map-info-face is-links" id={linksId} hidden={!linksOpen}>
        {linkList}
      </div>
    </>
  )
}
