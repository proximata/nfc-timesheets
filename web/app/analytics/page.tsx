'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
import { type ErrorKey, htmlLang, isLocale } from '@/lib/locale'
import {
  failureOf,
  type GMarker,
  isPinned,
  loadGoogleMaps,
  MAPS_API_KEY,
  type MapFailure,
  type MapStatus,
  onMapsAuthFailure,
  streetViewUrl,
  VIENNA_CENTRE,
} from '@/lib/map'
import { LOGIN_PATH } from '@/lib/nav'
import { isPeriod, PAYROLL_PERIODS, type Period, periodRange } from '@/lib/period'
import { formatDuration } from '@/lib/shifts'

/**
 * Building analytics — agreed time against time actually worked, the trend behind it, and
 * a map of Vienna.
 *
 * THE MAP IS THE OPTIONAL PART AND THE TABLE IS NOT. Everything the map shows, the table
 * below it shows too, for every building, including the ones that have no coordinates. A
 * building without a pin is a building we cannot draw, never a building the director cannot
 * see — that distinction is the whole reason the table is not "extra detail" but the
 * primary presentation, and it is also what makes this screen usable with a keyboard and a
 * screen reader without a second implementation.
 *
 * FIVE WAYS THE MAP CAN NOT WORK, all of them ordinary, all of them named on screen:
 *   noKey    the build had no NEXT_PUBLIC_GOOGLE_MAPS_KEY. Not a fault; a deployment fact.
 *   noPins   no building has been geocoded yet. The buildings are listed with the reason.
 *   blocked  Google rejected the key (referrer restriction, or the Maps JavaScript API is
 *            not enabled on the project). Caught via `gm_authFailure`, because an
 *            unauthorised key still loads the script and still constructs a Map.
 *   failed   the script never arrived: offline, an ad blocker, a proxy, a timeout.
 *   ready    ...and even then, a building without coordinates is still only in the table.
 *
 * THE TREND IS ARITHMETIC, NOT A FORECAST. N Vienna calendar months of actual payable
 * minutes and the delta between the last two. With fewer than two months that contain any
 * shift at all the answer is "not enough data" and NOT a flat line, which would be a claim
 * with nothing behind it.
 */

const BUILDINGS_PATH = '/locations/'
const SHIFTS_PATH = '/shifts/'
const CONTRACTS_PATH = '/contracts/'

/** Trend lengths the control offers. The server clamps anything else to TREND_MONTHS_MAX. */
const TREND_CHOICES = [3, 6, 12, TREND_MONTHS_MAX] as const

export default function AnalyticsPage() {
  const t = useTranslations('analytics')
  const tError = useTranslations('error')
  const locale = useLocale()
  const router = useRouter()

  const periodId = useId()
  const periodHintId = useId()
  const monthsId = useId()
  const monthsHintId = useId()
  const mapHeadingId = useId()
  const panelHeadingId = useId()

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)

  const [report, setReport] = useState<AnalyticsReport | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  const [period, setPeriod] = useState<Period>('lastMonth')
  const [months, setMonths] = useState<number>(TREND_MONTHS_DEFAULT)
  const [now] = useState(() => new Date())
  const range = useMemo(() => periodRange(period, now), [period, now])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mapStatus, setMapStatus] = useState<MapStatus>('loading')
  const [mapFailure, setMapFailure] = useState<MapFailure | null>(null)
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

  /**
   * Google's own rejection signal. It fires LATE — the script loads, `new Map()` succeeds,
   * and only then does an overlay appear over a grey rectangle — so without this the screen
   * would report a healthy map that is not there.
   */
  useEffect(
    () =>
      onMapsAuthFailure(() => {
        setMapFailure('auth')
        setMapStatus('blocked')
      }),
    [],
  )

  const buildings = useMemo(() => report?.buildings ?? [], [report])
  const pinned = useMemo(() => buildings.filter(isPinned), [buildings])
  const unpinned = useMemo(() => buildings.filter((b) => !isPinned(b)), [buildings])

  /**
   * Draw the map.
   *
   * ponytail: the whole map is rebuilt whenever the period changes, rather than diffing
   * markers. CEILING: with hundreds of buildings the redraw would be visible. There are
   * single figures. UPGRADE PATH: keep a marker per location id and move it.
   */
  useEffect(() => {
    if (report === null) return
    if (MAPS_API_KEY === '') {
      setMapStatus('noKey')
      return
    }
    if (pinned.length === 0) {
      setMapStatus('noPins')
      return
    }

    let cancelled = false
    const markers: GMarker[] = []
    setMapStatus('loading')
    setMapFailure(null)

    loadGoogleMaps()
      .then((api) => {
        const container = mapContainerRef.current
        if (cancelled || container === null) return
        const map = new api.Map(container, {
          center: VIENNA_CENTRE,
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        })
        const bounds = new api.LatLngBounds()
        for (const building of pinned) {
          const position = { lat: building.lat, lng: building.lng }
          bounds.extend(position)
          const marker = new api.Marker({ position, map, title: building.name })
          marker.addListener('click', () => setSelectedId(building.location_id))
          markers.push(marker)
        }
        map.fitBounds(bounds, 48)
        // A single pin makes `fitBounds` zoom to the maximum, which lands the director on a
        // rooftop with no street around it. Pull back to a block.
        const only = pinned.length === 1 ? pinned[0] : undefined
        if (only !== undefined) {
          map.setCenter({ lat: only.lat, lng: only.lng })
          map.setZoom(16)
        }
        setMapStatus('ready')
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setMapFailure(failureOf(cause))
        setMapStatus('failed')
      })

    return () => {
      cancelled = true
      for (const marker of markers) marker.setMap(null)
    }
  }, [report, pinned])

  const selected = buildings.find((b) => b.location_id === selectedId) ?? null

  // The panel is the answer to a click on a pin, and a pin is not in the tab order in any
  // useful way. Focus follows so a keyboard user who used the table's button lands in it.
  useEffect(() => {
    if (selected !== null) panelRef.current?.focus()
  }, [selected])

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

  return (
    <>
      <h1>{t('heading')}</h1>
      <p className="lede">{t('intro')}</p>

      <section aria-labelledby="analytics-controls-heading">
        <h2 id="analytics-controls-heading">{t('controlsHeading')}</h2>
        <div className="filter-bar">
          <div className="field">
            <label htmlFor={periodId}>{t('fieldPeriod')}</label>
            <select
              id={periodId}
              value={period}
              aria-describedby={periodHintId}
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
            <p className="field-hint" id={periodHintId}>
              {rangeLabel}
            </p>
          </div>

          <div className="field">
            <label htmlFor={monthsId}>{t('fieldMonths')}</label>
            <select
              id={monthsId}
              value={String(months)}
              aria-describedby={monthsHintId}
              onChange={(event) => setMonths(Number(event.target.value))}
            >
              {TREND_CHOICES.map((choice) => (
                <option key={choice} value={String(choice)}>
                  {t('monthsOption', { months: choice })}
                </option>
              ))}
            </select>
            <p className="field-hint" id={monthsHintId}>
              {t('monthsHint')}
            </p>
          </div>
        </div>
      </section>

      <div className="callout">
        <h2>{t('standingHeading')}</h2>
        <ul>
          <li>{t('noteExclusions')}</li>
          <li>{t('noteTrend')}</li>
          <li>{t('noteTargetSource')}</li>
          <li>{t('noteMapEquivalent')}</li>
        </ul>
      </div>

      {loadError !== null ? (
        <p className="form-error" role="alert">
          {tError(loadError)}
        </p>
      ) : null}

      <p className={notice?.ok === false ? 'form-error' : 'form-status'} role="status">
        {notice === null ? '' : notice.text}
      </p>

      <section aria-labelledby={mapHeadingId}>
        <h2 id={mapHeadingId}>{t('mapHeading')}</h2>

        {/* The state of the map, in words, ALWAYS — including when it worked. A director
            who cannot see pins has to be able to tell "nothing is geocoded" from "Google
            refused our key", because those have different owners and different fixes. */}
        <p className="notice" role="status">
          {mapStatus === 'noKey'
            ? t('mapNoKey')
            : mapStatus === 'noPins'
              ? t('mapNoPins', { unpinned: unpinned.length })
              : mapStatus === 'loading'
                ? t('mapLoading')
                : mapStatus === 'ready'
                  ? t('mapReady', { pinned: pinned.length, unpinned: unpinned.length })
                  : mapFailure === 'auth'
                    ? t('mapBlocked')
                    : mapFailure === 'timeout'
                      ? t('mapTimeout')
                      : t('mapNetwork')}
        </p>

        {mapStatus === 'failed' ? (
          <p className="form-actions">
            <button type="button" className="button-secondary" onClick={() => void load()}>
              {t('mapRetry')}
            </button>
          </p>
        ) : null}

        {/* Always in the DOM so the ref exists when the API resolves; `hidden` rather than
            unmounted so a zero-height canvas never gets a Map constructed into it. */}
        <div
          ref={mapContainerRef}
          className="map-canvas"
          hidden={mapStatus !== 'loading' && mapStatus !== 'ready'}
        />

        {/* Only when there is actually a map to click. "Selecting a pin opens…" printed
            under a notice that says no map was drawn is the screen contradicting itself. */}
        {mapStatus === 'ready' ? <p className="field-hint">{t('mapTableHint')}</p> : null}
      </section>

      {selected === null ? null : (
        <section
          className="callout building-panel"
          ref={panelRef}
          tabIndex={-1}
          aria-labelledby={panelHeadingId}
        >
          <h2 id={panelHeadingId}>{selected.name}</h2>

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
                      style={{ width: `${Math.round((point.actual_minutes / trendPeak) * 100)}%` }}
                    />
                  </td>
                  <td className="col-numeric">{point.shifts}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="form-actions">
            <Link href={CONTRACTS_PATH}>{t('panelContractLink')}</Link>
            {' · '}
            <Link href={SHIFTS_PATH}>{t('panelShiftsLink')}</Link>
            {' · '}
            <Link href={BUILDINGS_PATH}>{t('panelBuildingLink')}</Link>
          </p>
          <p className="form-actions">
            <button type="button" className="button-secondary" onClick={() => setSelectedId(null)}>
              {t('panelClose')}
            </button>
          </p>
        </section>
      )}

      <section aria-labelledby="analytics-table-heading">
        <h2 id="analytics-table-heading">{t('tableHeading')}</h2>

        {report === null ? (
          <p role="status">{t('loading')}</p>
        ) : buildings.length === 0 ? (
          <div className="notice">
            <p>{t('emptyBody')}</p>
            <p>
              <Link href={BUILDINGS_PATH}>{t('emptyLink')}</Link>
            </p>
          </div>
        ) : (
          <>
            <p className="page-summary" role="status">
              {t('summary', {
                period: rangeLabel,
                buildings: buildings.length,
                pinned: pinned.length,
              })}
            </p>

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
                  <tr
                    key={building.location_id}
                    className={building.active ? undefined : 'row-inactive'}
                  >
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
                            className="button-secondary"
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
                        className="button-secondary"
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
          </>
        )}
      </section>
    </>
  )
}
