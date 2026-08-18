'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { AnswerBand } from '@/components/AnswerBand'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { FilterChips } from '@/components/FilterChips'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
import {
  type AnalyticsBuilding,
  type AnalyticsReport,
  ApiError,
  fetchAnalytics,
  geocodeLocation,
  isClosedRange,
  TREND_MONTHS_DEFAULT,
  TREND_MONTHS_MAX,
} from '@/lib/api'
import { filterHref, useFilters } from '@/lib/filters'
import { type ErrorKey, htmlLang, isLocale } from '@/lib/locale'
import { isPinned, MAPS_API_KEY, streetViewUrl } from '@/lib/map'
import { LOGIN_PATH } from '@/lib/nav'
import { isPeriod, PAYROLL_PERIODS, type Period, periodRange } from '@/lib/period'
import { formatDuration } from '@/lib/shifts'

/**
 * Building analytics — agreed time against time actually worked, and the trend behind it.
 * „Wo geht die Zeit hin?"
 *
 * THIS SCREEN HAS NO MAP ANY MORE (decision-39 §2). It had one; `/` now has THE one, and
 * two maps in one admin are two things that can disagree — two extents, two selections, two
 * sets of pin states, and two billed map loads for one question. What made the map here
 * safe to remove is that the map was never the primary presentation: everything it showed,
 * the table below showed too, for every building, including the ones with no coordinates.
 * That invariant did not move — it is now the standing note `noteMapEquivalent`, and it is
 * what `/`'s Objektliste inherits.
 *
 * NOTHING TRUE WAS DELETED WITH IT. The geocode state per building is still a column, in
 * words, with the three genuinely different reasons („noch nie abgefragt" / a status /
 * pinned), and „erneut geokodieren" is still a row action. Those are the facts; the map was
 * a rendering of them.
 *
 * THE TREND IS ARITHMETIC, NOT A FORECAST. N Vienna calendar months of actual payable
 * minutes and the delta between the last two. With fewer than two months that contain any
 * shift at all the answer is "not enough data" and NOT a flat line, which would be a claim
 * with nothing behind it.
 *
 * ONE WRITE: re-geocoding a single building, and it stays a ROW action — the row is where
 * the director is looking when they notice the pin is missing. The detail view became a
 * drawer, which is what finally gives it a focus trap, Escape, and a focus return to the
 * button that opened it.
 */

const BUILDINGS_PATH = '/locations/'
const SHIFTS_PATH = '/shifts/'
const CONTRACTS_PATH = '/contracts/'

/** Trend lengths the control offers. The server clamps anything else to TREND_MONTHS_MAX. */
const TREND_CHOICES = [3, 6, 12, TREND_MONTHS_MAX] as const

export default function AnalyticsPage() {
  const t = useTranslations('analytics')
  const tFilter = useTranslations('filters')
  const tError = useTranslations('error')
  const locale = useLocale()
  const router = useRouter()

  const periodId = useId()
  const monthsId = useId()

  const [report, setReport] = useState<AnalyticsReport | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  /**
   * `?location=` opens this screen's building panel on that building, and `?period=` puts
   * it in the period the link's label promised (decision-38). The building panel on `/`
   * links here; so does a flagged row on `/pl/`.
   */
  const [filters, setFilters] = useFilters()
  const period: Period =
    filters.period !== null && filters.period !== 'all' ? filters.period : 'lastMonth'
  const setPeriod = (next: Period) => setFilters({ period: next }, 'replace')
  const [months, setMonths] = useState<number>(TREND_MONTHS_DEFAULT)
  const [now] = useState(() => new Date())
  const range = useMemo(() => periodRange(period, now), [period, now])

  /**
   * THE URL IS THE SELECTION. A table button writes it; back closes the panel because back
   * pops the entry that opened it. That is only true because opening is a 'push' and
   * closing is a 'replace' — see lib/filters.ts.
   */
  const selectedId = filters.location
  const setSelectedId = useCallback(
    (id: string | null) => setFilters({ location: id }, id === null ? 'replace' : 'push'),
    [setFilters],
  )
  /** Buildings whose Street View image 404ed after we asked for it. Second line of defence. */
  const [photoFailed, setPhotoFailed] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(htmlLang(isLocale(locale) ? locale : 'de'), {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Vienna',
      }),
    [locale],
  )
  /** `2026-07` -> "Juli 2026", in Austrian German. Same `htmlLang` trick as /payroll/. */
  const monthFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(htmlLang(isLocale(locale) ? locale : 'de'), {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    [locale],
  )

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
      if (!isClosedRange(range)) {
        setLoadError('request')
        return
      }
      try {
        setReport(await fetchAnalytics(range, months, signal))
        setLoadError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (handleAuthLoss(cause)) return
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
      }
    },
    [handleAuthLoss, range, months],
  )

  useEffect(() => {
    const controller = new AbortController()
    setReport(null)
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const buildings = useMemo(() => report?.buildings ?? [], [report])
  const pinned = useMemo(() => buildings.filter(isPinned), [buildings])

  const selected = buildings.find((b) => b.location_id === selectedId) ?? null

  /** Ask Google again for one building's pin. 200 does NOT mean a pin came back. */
  async function retryGeocode(building: AnalyticsBuilding) {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const updated = await geocodeLocation(building.location_id)
      setNotice(
        updated.lat === null
          ? {
              ok: false,
              text: t('geoRetryNoPin', {
                name: building.name,
                status: updated.geocode_status ?? t('geoStatusUnknown'),
              }),
            }
          : { ok: true, text: t('geoRetryPinned', { name: building.name }) },
      )
      await load()
    } catch (cause) {
      if (handleAuthLoss(cause)) return
      setNotice({
        ok: false,
        text:
          cause instanceof ApiError && cause.status === 422
            ? t('geoRetryNoAddress', { name: building.name })
            : t('geoRetryFailed', { name: building.name }),
      })
    } finally {
      setBusy(false)
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
  const rangeLabel =
    range.from === null || range.to === null
      ? periodLabel[period]
      : t('rangeLabel', {
          from: dayFormat.format(new Date(range.from)),
          to: dayFormat.format(new Date(new Date(range.to).getTime() - 1)),
        })

  /** `2026-07` as a month name. Built at midday UTC so no zone can shift the month. */
  const monthLabel = (month: string) => monthFormat.format(new Date(`${month}-15T12:00:00Z`))

  /** Direction in WORDS. There is no arrow glyph doing this job on its own. */
  function trendText(building: AnalyticsBuilding): string {
    if (building.trend_reason === 'insufficient_data' || building.trend_delta_minutes === null) {
      return t('trendInsufficient')
    }
    const delta = formatDuration(Math.abs(building.trend_delta_minutes))
    if (building.trend_direction === 'up') return t('trendUp', { delta })
    if (building.trend_direction === 'down') return t('trendDown', { delta })
    return t('trendFlat')
  }

  /** Why there is no photo. Never a grey rectangle presented as a building. */
  function photoReason(building: AnalyticsBuilding): string {
    if (MAPS_API_KEY === '') return t('photoNoKey')
    if (!isPinned(building)) return t('photoNoPin')
    if (photoFailed.has(building.location_id)) return t('photoLoadFailed')
    if (building.street_view_status === null) return t('photoNotChecked')
    if (building.street_view_status === 'REQUEST_DENIED') return t('photoDenied')
    if (building.street_view_status === 'ZERO_RESULTS') return t('photoNoImagery')
    return t('photoUnavailable', { status: building.street_view_status })
  }

  function geocodeText(building: AnalyticsBuilding): string {
    if (building.geocode_state === 'pinned') {
      return building.geocoded_at === null
        ? t('geoPinned')
        : t('geoPinnedAt', { when: dayFormat.format(new Date(building.geocoded_at)) })
    }
    if (building.geocode_state === 'never_attempted') return t('geoNeverAttempted')
    return t('geoFailed', { status: building.geocode_status ?? t('geoStatusUnknown') })
  }

  const photoUrl = selected === null ? null : streetViewUrl(selected)
  const showPhoto = selected !== null && photoUrl !== null && !photoFailed.has(selected.location_id)
  /** Longest month in the trend, so the bars have a scale. `1` keeps an all-zero trend safe. */
  const trendPeak = Math.max(1, ...(selected?.trend ?? []).map((point) => point.actual_minutes))

  /** Counted over the SAME list the table renders, so the band cannot disagree with a row. */
  const overCount = buildings.filter(
    (b) => b.variance_minutes !== null && b.variance_minutes > 0,
  ).length
  const underCount = buildings.filter(
    (b) => b.variance_minutes !== null && b.variance_minutes < 0,
  ).length
  const noTargetCount = buildings.filter((b) => b.target_minutes === null).length

  return (
    <>
      <PageHeader title={t('heading')} question={t('question')} />

      {/* Permanently-mounted page live regions. The geocode outcome is announced here and
          not inside the drawer, which Escape can close at any moment. */}
      <p className="form-error" role="alert">
        {loadError === null ? '' : tError(loadError)}
      </p>
      <p className={notice?.ok === false ? 'form-error' : 'form-status'} role="status">
        {notice === null ? '' : notice.text}
      </p>

      {/* The panel selection IS a filter and it is echoed like every other one, so a link
          that opened a panel on a building this report does not cover says so rather than
          silently doing nothing (decision-38 rule 3). */}
      <FilterChips
        chips={
          selectedId === null
            ? []
            : [
                {
                  key: 'location',
                  label: tFilter('location'),
                  value: selected?.name ?? tFilter('unknownLocation'),
                  unknown: report !== null && selected === null,
                  onRemove: () => setSelectedId(null),
                },
              ]
        }
      />
      {selectedId !== null && report !== null && selected === null ? (
        <p className="notice bad">{tFilter('unknownNotice')}</p>
      ) : null}

      {/* The answer first, above the controls that change it. It counts BUILDINGS and
          not pins: the map is the optional part. */}
      {report === null ? null : (
        <AnswerBand
          cells={[
            {
              k: t('answerOver'),
              v: overCount,
              calm: overCount === 0,
              sub: rangeLabel,
            },
            { k: t('answerUnder'), v: underCount, calm: true },
            {
              k: t('answerNoTarget'),
              v: noTargetCount,
              calm: noTargetCount === 0,
              sub: t('answerNoTargetSub'),
            },
            {
              k: t('answerBuildings'),
              v: buildings.length,
              calm: true,
              sub: t('answerPinnedSub', { pinned: pinned.length }),
            },
          ]}
        />
      )}

      <div className="filter-bar">
        <Field id={periodId} label={t('fieldPeriod')} help={rangeLabel}>
          <select
            value={period}
            onChange={(event) => {
              const next = event.target.value
              if (isPeriod(next) && next !== 'all') setPeriod(next)
            }}
          >
            {PAYROLL_PERIODS.map((option) => (
              <option key={option} value={option}>
                {periodLabel[option]}
              </option>
            ))}
          </select>
        </Field>

        <Field id={monthsId} label={t('fieldMonths')} help={t('monthsHint')}>
          <select
            value={String(months)}
            onChange={(event) => setMonths(Number(event.target.value))}
          >
            {TREND_CHOICES.map((choice) => (
              <option key={choice} value={String(choice)}>
                {t('monthsOption', { months: choice })}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <ListPanel title={t('tableHeading')}>
        {report === null ? (
          <div className="list-body">
            <p role="status">{t('loading')}</p>
          </div>
        ) : buildings.length === 0 ? (
          <div className="list-body">
            <EmptyState>
              {t('emptyBody')} <Link href={BUILDINGS_PATH}>{t('emptyLink')}</Link>
            </EmptyState>
          </div>
        ) : (
          <table className="data-table" aria-busy={busy}>
            <caption className="visually-hidden">
              {t('tableCaption', { period: rangeLabel })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('colBuilding')}</th>
                <th scope="col" className="col-numeric">
                  {t('colActual')}
                </th>
                <th scope="col" className="col-numeric">
                  {t('colTarget')}
                </th>
                <th scope="col" className="col-numeric">
                  {t('colVariance')}
                </th>
                <th scope="col">{t('colTrend')}</th>
                <th scope="col">{t('colMapState')}</th>
                <th scope="col">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {buildings.map((building) => (
                <tr key={building.location_id} className={building.active ? undefined : 'is-muted'}>
                  <th scope="row">
                    {building.name}
                    <span className="shift-state-note">
                      {building.client_name ?? t('noClient')}
                    </span>
                    {building.excluded_unresolved_shifts > 0 ? (
                      <span className="shift-state-note">
                        {t('rowExcluded', { shifts: building.excluded_unresolved_shifts })}
                      </span>
                    ) : null}
                  </th>
                  <td className="col-numeric">{formatDuration(building.actual_minutes)}</td>
                  <td className="col-numeric">
                    {building.target_minutes === null ? (
                      <span className="cell-muted">{t('targetUnknown')}</span>
                    ) : (
                      formatDuration(building.target_minutes)
                    )}
                  </td>
                  {/* Signed h:mm, the same unit as the two columns beside it. `+` is
                      printed explicitly because `formatDuration` only ever emits `-`, and
                      an unsigned "1:30" in a variance column is genuinely ambiguous. */}
                  <td className="col-numeric">
                    {building.variance_minutes === null ? (
                      <span className="cell-muted">{t('varianceUnknown')}</span>
                    ) : (
                      `${building.variance_minutes > 0 ? '+' : ''}${formatDuration(building.variance_minutes)}`
                    )}
                  </td>
                  <td>{trendText(building)}</td>
                  <td>
                    {geocodeText(building)}
                    {building.geocode_state === 'pinned' ? null : (
                      <span className="cell-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={busy}
                          onClick={() => retryGeocode(building)}
                        >
                          {t('geoRetry')}
                          <span className="visually-hidden">
                            {t('forBuilding', { name: building.name })}
                          </span>
                        </button>
                      </span>
                    )}
                  </td>
                  <td className="cell-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      aria-pressed={selectedId === building.location_id}
                      onClick={() => setSelectedId(building.location_id)}
                    >
                      {t('openDetails')}
                      <span className="visually-hidden">
                        {t('forBuilding', { name: building.name })}
                      </span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ListPanel>

      {/* Standing notes: what these numbers ARE. Small, permanently visible, never a
          tooltip — `noteMapEquivalent` in particular is the sentence that says the table,
          and not the map, is the complete list. */}
      <div className="callout">
        <h3>{t('standingHeading')}</h3>
        <ul>
          <li>{t('noteExclusions')}</li>
          <li>{t('noteTrend')}</li>
          <li>{t('noteTargetSource')}</li>
          <li>{t('noteMapEquivalent')}</li>
        </ul>
      </div>

      {/*
        The detail view. It was a focus-managed callout; as a drawer it gets Escape, a real
        focus trap and a focus RETURN to the row button that opened it — and the row it
        describes is still behind it rather than pushed off screen. Read-only: the one write
        on this screen (re-geocode) stays on the row, because that is where the director is
        looking when they notice the pin is missing.
      */}
      <Drawer
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected?.name ?? ''}
        step={selected?.client_name ?? undefined}
        footer={
          <button type="button" className="btn btn-ghost" onClick={() => setSelectedId(null)}>
            {t('panelClose')}
          </button>
        }
      >
        {selected === null ? null : (
          <>
            {showPhoto && photoUrl !== null ? (
              /* Rendered ONLY because the Street View METADATA endpoint already answered OK
                 for this exact coordinate. The image endpoint serves a grey "no imagery"
                 tile with HTTP 200, so trusting `onError` alone ships that tile as a
                 photograph of the client's building. `onError` is still wired, as the second
                 line of defence for a late refusal.

                 A plain <img>, not next/image: a static export has no image optimizer
                 (decision-16), so `unoptimized` would emit this same tag plus runtime. */
              // biome-ignore lint/performance/noImgElement: decision-16 makes this a static export, so no Next image optimizer exists; next/image with `unoptimized` emits this same tag plus client runtime, and the LCP argument does not apply to a 400x220 thumbnail inside a panel the director opens on purpose.
              <img
                className="building-photo"
                src={photoUrl}
                alt={t('photoAlt', { name: selected.name })}
                width={400}
                height={220}
                onError={() =>
                  setPhotoFailed((previous) => new Set(previous).add(selected.location_id))
                }
              />
            ) : (
              <p className="cell-muted">{photoReason(selected)}</p>
            )}

            <dl className="panel-metrics">
              <dt>{t('panelAddress')}</dt>
              <dd>{selected.address ?? t('noAddress')}</dd>
              <dt>{t('panelClient')}</dt>
              <dd>
                {selected.client_name ?? t('noClient')}
                {selected.contact_name === null ? '' : ` · ${selected.contact_name}`}
              </dd>
              <dt>{t('panelActual')}</dt>
              <dd>{formatDuration(selected.actual_minutes)}</dd>
              <dt>{t('panelTarget')}</dt>
              <dd>
                {selected.target_minutes === null
                  ? t('targetUnknown')
                  : formatDuration(selected.target_minutes)}
              </dd>
              <dt>{t('panelVariance')}</dt>
              <dd>
                {selected.variance_minutes === null
                  ? t('varianceUnknown')
                  : selected.variance_minutes === 0
                    ? t('varianceExact')
                    : selected.variance_minutes > 0
                      ? t('varianceOver', { delta: formatDuration(selected.variance_minutes) })
                      : t('varianceUnder', {
                          delta: formatDuration(Math.abs(selected.variance_minutes)),
                        })}
              </dd>
              <dt>{t('panelTrend')}</dt>
              <dd>{trendText(selected)}</dd>
              <dt>{t('panelMapState')}</dt>
              <dd>{geocodeText(selected)}</dd>
              <dt>{t('panelExcluded')}</dt>
              <dd>
                {selected.excluded_unresolved_shifts === 0 && selected.open_shifts === 0
                  ? t('excludedNone')
                  : t('excludedSome', {
                      shifts: selected.excluded_unresolved_shifts,
                      open: selected.open_shifts,
                      hours: formatDuration(Math.round(selected.excluded_unresolved_seconds / 60)),
                    })}
              </dd>
            </dl>

            <h3>{t('panelTrendHeading', { months: report?.trend_months ?? months })}</h3>
            <table className="data-table">
              <caption className="visually-hidden">
                {t('trendCaption', { name: selected.name })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t('colMonth')}</th>
                  <th scope="col" className="col-numeric">
                    {t('colActual')}
                  </th>
                  <th scope="col" className="col-numeric">
                    {t('colShifts')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {selected.trend.map((point) => (
                  <tr key={point.month}>
                    <th scope="row">{monthLabel(point.month)}</th>
                    <td className="col-numeric">
                      {formatDuration(point.actual_minutes)}
                      {/* Decorative only. The number to its left is the fact; this is a
                          shape, and it is aria-hidden so nothing is announced twice. */}
                      <span
                        className="trend-bar"
                        aria-hidden="true"
                        style={{
                          width: `${Math.round((point.actual_minutes / trendPeak) * 100)}%`,
                        }}
                      />
                    </td>
                    <td className="col-numeric">{point.shifts}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Every one of these used to be a bare navigation: the director read a panel
                about Handelskai and landed on an unfiltered list of everything. The fourth
                is new — the building's own object surface, which is where the numbers and
                the rest of its links live. */}
            <ul className="panel-links">
              <li>
                <Link href={filterHref('/', { location: selected.location_id })}>
                  {t('panelObjectLink')}
                </Link>
              </li>
              <li>
                <Link href={filterHref(CONTRACTS_PATH, { location: selected.location_id })}>
                  {t('panelContractLink')}
                </Link>
              </li>
              <li>
                <Link href={filterHref(SHIFTS_PATH, { location: selected.location_id, period })}>
                  {t('panelShiftsLink')}
                </Link>
              </li>
              <li>
                <Link href={filterHref(BUILDINGS_PATH, { open: selected.location_id })}>
                  {t('panelBuildingLink')}
                </Link>
              </li>
            </ul>
          </>
        )}
      </Drawer>
    </>
  )
}
