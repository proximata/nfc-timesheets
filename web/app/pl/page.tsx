'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from 'react'
import {
  ApiError,
  clearSetting,
  fetchPl,
  isClosedRange,
  MARGIN_BASELINE_KEY,
  type PlBuilding,
  type PlReport,
  saveSetting,
} from '@/lib/api'
import { type ErrorKey, htmlLang, isLocale } from '@/lib/locale'
import { LOGIN_PATH } from '@/lib/nav'
import { isPeriod, PAYROLL_PERIODS, type Period, periodRange } from '@/lib/period'
import {
  bpToPlainPercent,
  bpToRatio,
  parsePercentToBp,
  plTotals,
  shareBp,
  shortfallBp,
} from '@/lib/pl'
import { formatDuration } from '@/lib/shifts'

/**
 * Profit and loss per building: revenue − labour − materials, for one period.
 *
 * EVERY NUMBER HERE COMES FROM THE SERVER'S SQL (`GET /admin/pl`), not from arithmetic in
 * this file. `/admin/data` caps shift rows at 2000, so a browser-side aggregate would
 * silently report a smaller month than actually happened — and a P&L that can quietly be
 * wrong is worse than no P&L. What this file adds is a totals row over the buildings it
 * was given, and the words.
 *
 * THE THREE THINGS THIS SCREEN WILL NOT DO:
 *
 * 1. Show a confident zero for something nobody knows. A building with no contract in the
 *    period has `revenue_cents: null` and renders as "no contract on file", never as
 *    EUR 0.00 — a zero would report it as a total loss and flag it for a conversation with
 *    a client who is paying perfectly well.
 * 2. Treat "not assessable" as a pass. `below_baseline` is TRUE, FALSE **or NULL**, and
 *    null means the margin or the baseline is unknown. It gets its own words.
 * 3. Invent the baseline. `pl_margin_baseline_bp` ships UNSET and nothing defaults it. With
 *    it unset no building is flagged and the screen says so, because this codebase has no
 *    basis for an opinion about what a Viennese cleaning contract ought to earn. Setting it
 *    is a control on this page, and unsetting it is too.
 *
 * A FLAG IS NOT A RED DOT. The director has to be able to argue the case to a client, so
 * every flagged building gets a paragraph naming the margin, the floor, the shortfall, and
 * where the money went — including the hours that were deliberately NOT counted
 * (decision-10), because a building looks cheap precisely while those are outstanding.
 */

const MATERIALS_PATH = '/material-requests/'
const CONTRACTS_PATH = '/contracts/'
const SHIFTS_PATH = '/shifts/'

export default function PlPage() {
  const t = useTranslations('pl')
  const tError = useTranslations('error')
  const format = useFormatter()
  const locale = useLocale()
  const router = useRouter()

  const periodId = useId()
  const periodHintId = useId()
  const baselineId = useId()
  const baselineHintId = useId()

  /**
   * Austrian month names. next-intl is handed the message-file key ('de'), whose Intl
   * resolution says "Januar"; this director says "Jänner". Same trick and same reason as
   * /payroll/ and /reinigung/. The zone is pinned so a period boundary reads as the day the
   * director would name, not the day the browser's zone would.
   */
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

  const [report, setReport] = useState<PlReport | null>(null)
  const [loadError, setLoadError] = useState<ErrorKey | null>(null)
  /** The month that has ENDED is the one a P&L is run for. Same vocabulary as /payroll/. */
  const [period, setPeriod] = useState<Period>('lastMonth')
  // Frozen at mount: "this month" must not change meaning halfway through a re-render.
  const [now] = useState(() => new Date())
  const range = useMemo(() => periodRange(period, now), [period, now])

  const [baselineDraft, setBaselineDraft] = useState('')
  const [baselineError, setBaselineError] = useState(false)
  const [baselineNotice, setBaselineNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

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
      // PAYROLL_PERIODS excludes 'all', so both ends are always set. The guard exists so a
      // future open-ended period cannot silently send `?from=&to=` and get a 400 the
      // screen would report as a server fault.
      if (!isClosedRange(range)) {
        setLoadError('request')
        return
      }
      try {
        const next = await fetchPl(range, signal)
        setReport(next)
        setBaselineDraft(
          next.baseline_margin_bp === null ? '' : bpToPlainPercent(next.baseline_margin_bp),
        )
        setLoadError(null)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (handleAuthLoss(cause)) return
        setLoadError(cause instanceof ApiError ? cause.messageKey : 'server')
      }
    },
    [handleAuthLoss, range],
  )

  useEffect(() => {
    const controller = new AbortController()
    // The payload IS the period. Clearing first stops the previous period's rows sitting
    // under the new period's heading while the request is in flight.
    setReport(null)
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  async function submitBaseline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const bp = parsePercentToBp(baselineDraft)
    if (bp === null) {
      setBaselineError(true)
      setBaselineNotice(null)
      return
    }
    setBaselineError(false)
    setBusy(true)
    try {
      await saveSetting(MARGIN_BASELINE_KEY, bp)
      setBaselineNotice({
        ok: true,
        text: t('baselineSaved', {
          percent: format.number(bpToRatio(bp), { style: 'percent', minimumFractionDigits: 2 }),
        }),
      })
      await load()
    } catch (cause) {
      if (!handleAuthLoss(cause)) setBaselineNotice({ ok: false, text: t('baselineFailed') })
    } finally {
      setBusy(false)
    }
  }

  async function removeBaseline() {
    if (busy) return
    setBusy(true)
    setBaselineError(false)
    try {
      await clearSetting(MARGIN_BASELINE_KEY)
      setBaselineNotice({ ok: true, text: t('baselineCleared') })
      await load()
    } catch (cause) {
      if (!handleAuthLoss(cause)) setBaselineNotice({ ok: false, text: t('baselineFailed') })
    } finally {
      setBusy(false)
    }
  }

  const money = (cents: number) =>
    format.number(cents / 100, { style: 'currency', currency: 'EUR' })
  const percent = (bp: number) =>
    format.number(bpToRatio(bp), { style: 'percent', minimumFractionDigits: 2 })
  /** Basis points as PERCENTAGE POINTS of difference — "8.5 points short", not "8.5%". */
  const points = (bp: number) => format.number(bp / 100, { maximumFractionDigits: 2 })

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
          // Half-open, so the last day the director cares about is one millisecond back.
          to: dayFormat.format(new Date(new Date(range.to).getTime() - 1)),
        })

  const totals = report === null ? null : plTotals(report.buildings)
  const flagged = report === null ? [] : report.buildings.filter((b) => b.below_baseline === true)
  // Hoisted out of the JSX: narrowing `report.baseline_margin_bp` inside a `.map()` callback
  // is lost, and the alternative would be a non-null assertion on the one number the whole
  // flagging argument rests on.
  const baselineBp = report?.baseline_margin_bp ?? null

  /** The assessment, in WORDS. Colour is not a signal this screen is allowed to rely on. */
  function assessment(building: PlBuilding): string {
    if (building.below_baseline === true) return t('assessBelow')
    if (building.below_baseline === false) return t('assessOk')
    if (building.margin_unknown_reason === 'no_contract') return t('assessNoContract')
    if (building.margin_unknown_reason === 'zero_revenue') return t('assessZeroRevenue')
    return t('assessNoBaseline')
  }

  /**
   * The argument, not the verdict. Everything a director needs in front of them on the
   * phone to a client: what the building earned, what it cost to clean, in what proportion,
   * and how far short of the floor that lands.
   */
  function reasoning(building: PlBuilding, baselineBp: number): string[] {
    const lines: string[] = []
    const labourShare = shareBp(building.labour_cents, building.revenue_cents)
    const materialShare = shareBp(building.material_cents, building.revenue_cents)
    const short = shortfallBp(building.margin_bp, baselineBp)

    if (building.margin_bp !== null && short !== null) {
      lines.push(
        t('whyMargin', {
          margin: percent(building.margin_bp),
          baseline: percent(baselineBp),
          points: points(short),
        }),
      )
    }
    if (building.revenue_cents !== null) {
      lines.push(
        t('whyRevenue', {
          revenue: money(building.revenue_cents),
          days: building.revenue_days,
          periodDays: building.period_days,
        }),
      )
    }
    lines.push(
      t('whyLabour', {
        labour: money(building.labour_cents),
        hours: formatDuration(building.labour_minutes),
        share: labourShare === null ? t('shareUnknown') : percent(labourShare),
      }),
    )
    lines.push(
      t('whyMaterial', {
        material: money(building.material_cents),
        share: materialShare === null ? t('shareUnknown') : percent(materialShare),
      }),
    )
    // decision-10, stated where it changes the conclusion: those hours are real work that
    // has NOT been charged into this cost, so the true cost is higher than the row shows.
    if (building.excluded_unresolved_shifts > 0) {
      lines.push(
        t('whyExcluded', {
          shifts: building.excluded_unresolved_shifts,
          hours: formatDuration(Math.round(building.excluded_unresolved_seconds / 60)),
        }),
      )
    }
    if (building.open_shifts > 0) lines.push(t('whyOpen', { shifts: building.open_shifts }))
    return lines
  }

  return (
    <>
      <h1>{t('heading')}</h1>
      <p className="lede">{t('intro')}</p>

      <section aria-labelledby="pl-period-heading">
        <h2 id="pl-period-heading">{t('periodHeading')}</h2>
        <div className="field toolbar-field">
          <label htmlFor={periodId}>{t('fieldPeriod')}</label>
          <select
            id={periodId}
            value={period}
            aria-describedby={periodHintId}
            onChange={(event) => {
              const next = event.target.value
              // `all` is excluded by PAYROLL_PERIODS and by the API: /admin/pl requires both
              // bounds, because a monthly fee pro-rated over an unbounded period is either
              // infinitely many days or a month nobody asked for.
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
            {rangeLabel} {t('attributionHint')}
          </p>
        </div>
      </section>

      <section aria-labelledby="pl-baseline-heading">
        <h2 id="pl-baseline-heading">{t('baselineHeading')}</h2>
        <p>{t('baselineIntro')}</p>

        <form className="worker-form" onSubmit={submitBaseline} noValidate>
          <p className={baselineNotice?.ok === false ? 'form-error' : 'form-status'} role="status">
            {baselineNotice === null ? '' : baselineNotice.text}
          </p>

          <div className="field">
            <label htmlFor={baselineId}>{t('fieldBaseline')}</label>
            <input
              id={baselineId}
              type="text"
              inputMode="decimal"
              value={baselineDraft}
              aria-describedby={`${baselineHintId} ${baselineId}-error`}
              aria-invalid={baselineError}
              disabled={busy}
              onChange={(event) => setBaselineDraft(event.target.value)}
            />
            <p className="field-hint" id={baselineHintId}>
              {t('baselineHint')}
            </p>
            <p className="field-error" id={`${baselineId}-error`} role="alert">
              {baselineError ? t('errorBaselineInvalid') : ''}
            </p>
          </div>

          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={busy}>
              {busy ? t('submitting') : t('baselineSubmit')}
            </button>
            {report?.baseline_set === true ? (
              <button
                type="button"
                className="button-secondary"
                disabled={busy}
                onClick={removeBaseline}
              >
                {t('baselineClear')}
              </button>
            ) : null}
          </div>
        </form>

        {/* State in TEXT. "Not set" is a supported, deliberate state, not a fault, and the
            sentence says what follows from it rather than leaving the reader to guess. */}
        <p className="notice">
          {report === null
            ? t('baselineLoading')
            : report.baseline_margin_bp === null
              ? t('baselineUnset')
              : t('baselineCurrent', { percent: percent(report.baseline_margin_bp) })}
        </p>
      </section>

      <section aria-labelledby="pl-result-heading">
        <h2 id="pl-result-heading">{t('resultHeading')}</h2>

        {loadError !== null ? (
          <p className="form-error" role="alert">
            {tError(loadError)}
          </p>
        ) : null}

        {report === null || totals === null ? (
          <p role="status">{t('loading')}</p>
        ) : (
          <>
            <p className="page-summary" role="status">
              {t('summary', {
                period: rangeLabel,
                buildings: report.buildings.length,
                flagged: totals.flagged,
              })}
            </p>

            {/* Standing methodology. Every line is something a reader would otherwise
                reasonably assume the opposite of, and all of them change what the numbers
                mean. Permanently visible, never a tooltip. */}
            <div className="callout">
              <h3>{t('methodHeading')}</h3>
              <ul>
                {/* decision-28 / the API's `labour.rate_basis`. Rendered from OUR messages
                    rather than the server's `rate_basis_note`, which is German-only and
                    would sit untranslated on the English locale. */}
                <li>
                  {report.labour.rate_basis === 'current'
                    ? t('methodRates')
                    : t('methodRatesUnknown')}
                </li>
                <li>{t('methodMaterials')}</li>
                <li>
                  {t('methodMaterialPool', {
                    pool: money(report.materials.pool_cents),
                    priced: report.materials.priced_requests,
                  })}
                </li>
                {report.materials.unpriced_requests > 0 ? (
                  <li>
                    {t('methodUnpriced', { unpriced: report.materials.unpriced_requests })}{' '}
                    <Link href={MATERIALS_PATH}>{t('methodUnpricedLink')}</Link>
                  </li>
                ) : null}
                {report.materials.unallocated_cents > 0 ? (
                  <li>
                    {t('methodUnallocated', {
                      amount: money(report.materials.unallocated_cents),
                    })}
                  </li>
                ) : null}
                <li>{t('methodExclusions')}</li>
                {totals.unpricedBuildings > 0 ? (
                  <li>
                    {t('methodNoContract', {
                      buildings: totals.unpricedBuildings,
                      cost: money(totals.costCentsUnpriced),
                    })}{' '}
                    <Link href={CONTRACTS_PATH}>{t('methodNoContractLink')}</Link>
                  </li>
                ) : null}
              </ul>
            </div>

            {report.buildings.length === 0 ? (
              /* Empty is not an error and must not read like one. There is genuinely
                 nothing to report when no building is active and none was worked in. */
              <div className="notice">
                <p>{t('emptyBody')}</p>
                <p>{t('emptyHint')}</p>
              </div>
            ) : (
              <>
                <table className="data-table">
                  <caption className="visually-hidden">
                    {t('tableCaption', { period: rangeLabel })}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('colBuilding')}</th>
                      <th scope="col">{t('colClient')}</th>
                      <th scope="col" className="col-numeric">
                        {t('colRevenue')}
                      </th>
                      <th scope="col" className="col-numeric">
                        {t('colLabour')}
                      </th>
                      <th scope="col" className="col-numeric">
                        {t('colMaterial')}
                      </th>
                      <th scope="col" className="col-numeric">
                        {t('colProfit')}
                      </th>
                      <th scope="col" className="col-numeric">
                        {t('colMargin')}
                      </th>
                      <th scope="col">{t('colAssessment')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.buildings.map((building) => (
                      <tr
                        key={building.location_id}
                        className={
                          building.below_baseline === true
                            ? 'row-attention'
                            : building.active
                              ? undefined
                              : 'row-inactive'
                        }
                      >
                        <th scope="row">
                          {building.name}
                          {building.active ? null : (
                            <span className="shift-state-note">{t('buildingInactive')}</span>
                          )}
                          {building.excluded_unresolved_shifts > 0 ? (
                            <span className="shift-state-note">
                              {t('rowExcluded', {
                                shifts: building.excluded_unresolved_shifts,
                              })}
                            </span>
                          ) : null}
                        </th>
                        <td>
                          {building.client_name ?? (
                            <span className="cell-muted">{t('noClient')}</span>
                          )}
                        </td>
                        <td className="col-numeric">
                          {building.revenue_cents === null ? (
                            <span className="cell-muted">{t('revenueUnknown')}</span>
                          ) : (
                            <>
                              {money(building.revenue_cents)}
                              {building.revenue_days < building.period_days ? (
                                <span className="shift-state-note">
                                  {t('revenuePartial', {
                                    days: building.revenue_days,
                                    periodDays: building.period_days,
                                  })}
                                </span>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td className="col-numeric">
                          {money(building.labour_cents)}
                          <span className="shift-state-note">
                            {t('labourHours', {
                              hours: formatDuration(building.labour_minutes),
                            })}
                          </span>
                        </td>
                        <td className="col-numeric">{money(building.material_cents)}</td>
                        <td className="col-numeric">
                          {building.profit_cents === null ? (
                            <span className="cell-muted">{t('profitUnknown')}</span>
                          ) : (
                            money(building.profit_cents)
                          )}
                        </td>
                        <td className="col-numeric">
                          {building.margin_bp === null ? (
                            <span className="cell-muted">{t('marginUnknown')}</span>
                          ) : (
                            percent(building.margin_bp)
                          )}
                        </td>
                        <td>{assessment(building)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">
                        {t('totalLabel')}
                        <span className="shift-state-note">
                          {t('totalScope', {
                            buildings: report.buildings.length - totals.unpricedBuildings,
                          })}
                        </span>
                      </th>
                      <td />
                      <td className="col-numeric">{money(totals.revenueCents)}</td>
                      <td className="col-numeric">{money(totals.labourCentsPriced)}</td>
                      <td className="col-numeric">{money(totals.materialCentsPriced)}</td>
                      <td className="col-numeric">
                        {totals.profitCents === null ? (
                          <span className="cell-muted">{t('profitUnknown')}</span>
                        ) : (
                          money(totals.profitCents)
                        )}
                      </td>
                      <td className="col-numeric">
                        {totals.marginBp === null ? (
                          <span className="cell-muted">{t('marginUnknown')}</span>
                        ) : (
                          percent(totals.marginBp)
                        )}
                      </td>
                      <td>
                        {totals.notAssessable > 0
                          ? t('totalNotAssessable', { buildings: totals.notAssessable })
                          : t('totalAllAssessed')}
                      </td>
                    </tr>
                  </tfoot>
                </table>

                {/* THE ARGUMENT. A red row is not something a director can take to a
                    client; this is. One block per flagged building, with the numbers that
                    produced the verdict spelled out. */}
                <section aria-labelledby="pl-flagged-heading">
                  <h3 id="pl-flagged-heading">{t('flaggedHeading')}</h3>
                  {baselineBp === null ? (
                    <p className="notice">{t('flaggedNoBaseline')}</p>
                  ) : flagged.length === 0 ? (
                    <p className="notice">
                      {t('flaggedNone', { baseline: percent(baselineBp) })}
                      {totals.notAssessable > 0
                        ? ` ${t('flaggedNoneCaveat', { buildings: totals.notAssessable })}`
                        : ''}
                    </p>
                  ) : (
                    flagged.map((building) => (
                      <div className="callout" key={building.location_id}>
                        <h4>{t('flaggedFor', { name: building.name })}</h4>
                        <ul>
                          {reasoning(building, baselineBp).map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                        <p>
                          <Link href={CONTRACTS_PATH}>{t('flaggedContractLink')}</Link>
                          {' · '}
                          <Link href={SHIFTS_PATH}>{t('flaggedShiftsLink')}</Link>
                        </p>
                      </div>
                    ))
                  )}
                </section>
              </>
            )}
          </>
        )}
      </section>
    </>
  )
}
