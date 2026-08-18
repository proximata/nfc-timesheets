'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from 'react'
import { AnswerBand } from '@/components/AnswerBand'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { Field } from '@/components/Field'
import { FilterChips } from '@/components/FilterChips'
import { ListPanel } from '@/components/ListPanel'
import { PageHeader } from '@/components/PageHeader'
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
import { filterHref, useFilters } from '@/lib/filters'
import { type ErrorKey, htmlLang, isLocale } from '@/lib/locale'
import { LOGIN_PATH } from '@/lib/nav'
import {
  futureDays,
  isPartElapsed,
  isPeriod,
  PAYROLL_PERIODS,
  type Period,
  periodRange,
} from '@/lib/period'
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
 * „Verdienen wir an diesem Objekt?" — answered by the band, argued by the flagged blocks,
 * evidenced by the table, and qualified by the methodology under it.
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
 *    a client who is paying perfectly well. The same rule runs down the COST side: hours
 *    worked by somebody with no hourly rate carry NO amount rather than 0,00 EUR, exactly
 *    as on /payroll/ and /workers/. Priced at zero they moved a building's hours from
 *    48:00 to 58:30 and its margin by nothing at all — an inflated margin is a decision
 *    about a client's contract taken on a false number, so those hours are excluded from
 *    the cost and NAMED, in the labour cell, in the flagged argument and in the method.
 * 1b. Report a period that has not finished as if it had. The contract fee accrues for
 *    every contract-valid day in the range while labour and materials only exist for days
 *    that have happened, so "Dieses Jahr" picked in August books five more months of
 *    revenue against three weeks of work: 71,33 % margin, next to the 10,70 % the last
 *    CLOSED month actually made. The arithmetic is NOT corrected here — clipping the
 *    accrual changes numbers already reported and is its own decision record — so instead
 *    the screen states it, in the margin cell and in the method block, naming how many days
 *    of the period have not happened. `isPartElapsed` in lib/period.ts carries the reason.
 * 2. Treat "not assessable" as a pass. `below_baseline` is TRUE, FALSE **or NULL**, and
 *    null means the margin or the baseline is unknown. It gets its own words.
 * 3. Invent the baseline. `pl_margin_baseline_bp` ships UNSET and nothing defaults it. With
 *    it unset no building is flagged and the screen says so, because this codebase has no
 *    basis for an opinion about what a Viennese cleaning contract ought to earn. Setting it
 *    is a control on this page, and unsetting it is too — an invented threshold would end up
 *    in a real conversation about revising a client's contract.
 *
 * A FLAG IS NOT A RED DOT. The director has to be able to argue the case to a client, so
 * every flagged building gets a paragraph naming the margin, the floor, the shortfall, and
 * where the money went — including the hours that were deliberately NOT counted
 * (decision-10), because a building looks cheap precisely while those are outstanding. Those
 * paragraphs stay paragraphs. Compressing them into a badge was never on the table.
 *
 * ONE WRITE: the baseline, in a drawer. Its result is announced in the PAGE's live region,
 * because Escape closes a drawer at any moment and a message that leaves with the overlay
 * reporting it has not been read.
 */

const MATERIALS_PATH = '/material-requests/'
const CONTRACTS_PATH = '/contracts/'
const SHIFTS_PATH = '/shifts/'
const WORKERS_PATH = '/workers/'
/** Where a building is created. The empty state names that action, so it links to it. */
const BUILDINGS_PATH = '/locations/'
/** The building's object surface. `/?location=<uuid>` — there is no `/locations/<id>`. */
const HOME_PATH = '/'

export default function PlPage() {
  const t = useTranslations('pl')
  const tFilter = useTranslations('filters')
  const tError = useTranslations('error')
  const format = useFormatter()
  const locale = useLocale()
  const router = useRouter()

  const periodId = useId()
  const baselineId = useId()

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
  /**
   * `?location=` narrows the report to one building; `?period=` is read so the object
   * panel's „Ergebnis dieses Objekts · Vormonat" opens in the month its own label named
   * (decision-38). The URL is the period — no second copy in state.
   */
  const [filters, setFilters] = useFilters()
  /** The month that has ENDED is the one a P&L is run for. Same vocabulary as /payroll/. */
  const period: Period =
    filters.period !== null && filters.period !== 'all' ? filters.period : 'lastMonth'
  const setPeriod = (next: Period) => setFilters({ period: next }, 'replace')
  // Frozen at mount: "this month" must not change meaning halfway through a re-render.
  const [now] = useState(() => new Date())
  const range = useMemo(() => periodRange(period, now), [period, now])
  /**
   * The period has not finished, so every revenue figure on this page counts days nobody
   * has worked yet. Said twice on purpose: once in the method block, which argues it, and
   * once in the margin cell, which is the number the answer band exists to be read alone.
   */
  const stillRunning = isPartElapsed(range, now)
  const unhappenedDays = futureDays(range, now)

  const [baselineOpen, setBaselineOpen] = useState(false)
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
      // Closed on success: the drawer had one job and it is done. The outcome is announced
      // in the page's live region, which is still on screen after the close.
      setBaselineOpen(false)
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
      setBaselineOpen(false)
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

  /**
   * `?location=` — one building's row, its flagged argument and a total scoped to it.
   *
   * The totals row is recomputed over the VISIBLE set rather than left whole: a table of one
   * row under a total of six buildings is a screen contradicting itself. `totalScope` already
   * names how many buildings it counted, so the recomputed total says what it is.
   *
   * The methodology callout below is NOT scoped — the material pool, the unpriced counts and
   * the rate basis are period-wide facts, and a scoped copy of them would be a different
   * number wearing the same label. `scopedNote` says so where they are.
   */
  const allBuildings = report?.buildings ?? []
  const scopedBuilding =
    filters.location === null
      ? null
      : (allBuildings.find((b) => b.location_id === filters.location) ?? null)
  const scopeUnknown = filters.location !== null && report !== null && scopedBuilding === null
  const buildings =
    filters.location === null
      ? allBuildings
      : allBuildings.filter((b) => b.location_id === filters.location)

  const totals = report === null ? null : plTotals(buildings)
  const flagged = buildings.filter((b) => b.below_baseline === true)
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
  /**
   * The labour amount, or the refusal to state one.
   *
   * A building whose ONLY hours were worked by somebody with no rate has `labour_cents: 0`,
   * and 0,00 EUR is the exact claim this screen refuses to make about a real person's work.
   * Zero cost with zero unpriced hours is a genuine zero — nobody cleaned it — and stays a
   * number. Same shape as `revenueUnknown`.
   */
  const labourAmount = (building: PlBuilding): string =>
    building.labour_cents === 0 && building.labour_unpriced_seconds > 0
      ? t('labourUnknown')
      : money(building.labour_cents)

  function reasoning(building: PlBuilding, floorBp: number): string[] {
    const lines: string[] = []
    const labourShare = shareBp(building.labour_cents, building.revenue_cents)
    const materialShare = shareBp(building.material_cents, building.revenue_cents)
    const short = shortfallBp(building.margin_bp, floorBp)

    if (building.margin_bp !== null && short !== null) {
      lines.push(
        t('whyMargin', {
          margin: percent(building.margin_bp),
          baseline: percent(floorBp),
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
        labour: labourAmount(building),
        hours: formatDuration(building.labour_minutes),
        share: labourShare === null ? t('shareUnknown') : percent(labourShare),
      }),
    )
    // Same shape as `whyExcluded` and for the same reason: work that is real, in the hours
    // above, and in NOBODY's cost. Said here because it is the sentence that stops the
    // director defending a margin that ignored somebody's wage.
    if (building.labour_unpriced_seconds > 0) {
      lines.push(
        t('whyLabourUnpriced', {
          workers: building.labour_unpriced_workers,
          hours: formatDuration(building.labour_unpriced_minutes),
        }),
      )
    }
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
      <PageHeader
        title={t('heading')}
        question={t('question')}
        action={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setBaselineError(false)
              setBaselineOpen(true)
            }}
          >
            {t('baselineOpen')}
          </button>
        }
      />

      {/* The page's live regions: permanently mounted, empty when there is nothing to say,
          and OUTSIDE the drawer that produces the baseline outcome. */}
      <p className="form-error" role="alert">
        {loadError === null ? '' : tError(loadError)}
      </p>
      <p className={baselineNotice?.ok === false ? 'form-error' : 'form-status'} role="status">
        {baselineNotice === null ? '' : baselineNotice.text}
      </p>

      {/* The filter, echoed and removable (decision-38 rule 3). */}
      <FilterChips
        chips={
          filters.location === null
            ? []
            : [
                {
                  key: 'location',
                  label: tFilter('location'),
                  value: scopedBuilding?.name ?? tFilter('unknownLocation'),
                  unknown: scopeUnknown,
                  onRemove: () => setFilters({ location: null }, 'replace'),
                },
              ]
        }
      />
      {scopeUnknown ? <p className="notice bad">{tFilter('unknownNotice')}</p> : null}

      {/* The answer first, above the control that changes it. `flagged` leads because it is
          the only cell that asks for something; everything else here is context. */}
      {report === null || totals === null ? null : (
        <AnswerBand
          cells={[
            {
              k: t('answerFlagged'),
              v: totals.flagged,
              calm: totals.flagged === 0,
              sub:
                totals.notAssessable > 0
                  ? t('totalNotAssessable', { buildings: totals.notAssessable })
                  : t('totalAllAssessed'),
            },
            {
              k: t('answerProfit'),
              v: totals.profitCents === null ? t('profitUnknown') : money(totals.profitCents),
              sub: rangeLabel,
            },
            {
              k: t('answerMargin'),
              v: totals.marginBp === null ? t('marginUnknown') : percent(totals.marginBp),
              // NOT calm while the period is still running: this is the cell the critique
              // caught reporting 99,25 % for a building in its first week.
              calm: !stillRunning,
              sub: [
                baselineBp === null
                  ? t('answerNoBaseline')
                  : t('answerBaseline', { percent: percent(baselineBp) }),
                stillRunning ? t('answerFuture', { days: unhappenedDays }) : null,
              ]
                .filter((part) => part !== null)
                .join(' · '),
            },
            {
              k: t('answerRevenue'),
              v: money(totals.revenueCents),
              calm: true,
              sub: t('totalScope', {
                buildings: buildings.length - totals.unpricedBuildings,
              }),
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
        </Field>
      </div>

      {report === null || totals === null ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <>
          {/* „Nicht gesetzt" is a supported, deliberate state and not a fault. The sentence
              says what FOLLOWS from it rather than leaving the reader to guess, and it stays
              on the page — not in the drawer that sets it. */}
          <p className="note">
            {report.baseline_margin_bp === null
              ? t('baselineUnset')
              : t('baselineCurrent', { percent: percent(report.baseline_margin_bp) })}
          </p>

          {/* THE ARGUMENT, before the evidence. A red row is not something a director can
              take to a client; these paragraphs are. */}
          <ListPanel title={t('flaggedHeading')} padded>
            {baselineBp === null ? (
              <EmptyState>{t('flaggedNoBaseline')}</EmptyState>
            ) : flagged.length === 0 ? (
              <EmptyState>
                {t('flaggedNone', { baseline: percent(baselineBp) })}
                {totals.notAssessable > 0
                  ? ` ${t('flaggedNoneCaveat', { buildings: totals.notAssessable })}`
                  : ''}
              </EmptyState>
            ) : (
              flagged.map((building) => (
                <div className="callout" key={building.location_id}>
                  <h3>{t('flaggedFor', { name: building.name })}</h3>
                  <ul>
                    {reasoning(building, baselineBp).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {/* Every link out of a flagged building carries THAT building and THIS
                      period. They used to be bare navigations: the director read a
                      paragraph about Handelskai and landed on an unfiltered contract list. */}
                  <ul className="panel-links">
                    <li>
                      <Link href={filterHref(HOME_PATH, { location: building.location_id })}>
                        {t('flaggedBuildingLink')}
                      </Link>
                    </li>
                    <li>
                      <Link href={filterHref(CONTRACTS_PATH, { location: building.location_id })}>
                        {t('flaggedContractLink')}
                      </Link>
                    </li>
                    <li>
                      {/* L24: that building's shifts, in the month this argument was made
                          about — not „the shifts screen" on its own default period. */}
                      <Link
                        href={filterHref(SHIFTS_PATH, {
                          location: building.location_id,
                          period,
                        })}
                      >
                        {t('flaggedShiftsLink')}
                      </Link>
                    </li>
                    {/* Rule 1: only when this building actually carries material cost. A
                        link to an empty material queue is the „nichts gefunden" landing
                        this contract exists to stop. */}
                    {building.material_cents > 0 ? (
                      <li>
                        <Link
                          href={filterHref(MATERIALS_PATH, {
                            location: building.location_id,
                            status: 'all',
                          })}
                        >
                          {t('flaggedMaterialsLink')}
                        </Link>
                      </li>
                    ) : null}
                  </ul>
                </div>
              ))
            )}
          </ListPanel>

          <ListPanel title={t('resultHeading')}>
            {buildings.length === 0 ? (
              /* Empty is not an error and must not read like one. There is genuinely
                 nothing to report when no building is active and none was worked in — and
                 the hint says
                 „Legen Sie ein Objekt an“, so it carries the link that does it. /analytics/
                 has offered exactly this link from exactly this sentence since it was
                 written; /pl/ is its twin and did not, which is the same day-zero dead end
                 TASK-178 found on the dashboard. */
              <div className="list-body">
                <EmptyState>
                  {t('emptyBody')} {t('emptyHint')}{' '}
                  <Link href={BUILDINGS_PATH}>{t('emptyLink')}</Link>
                </EmptyState>
              </div>
            ) : (
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
                  {buildings.map((building) => (
                    <tr
                      key={building.location_id}
                      className={
                        building.below_baseline === true
                          ? 'is-unres'
                          : building.active
                            ? undefined
                            : 'is-muted'
                      }
                    >
                      <th scope="row">
                        {/* The name opens the building's panel, carrying its id. */}
                        <Link href={filterHref(HOME_PATH, { location: building.location_id })}>
                          {building.name}
                          <span className="visually-hidden"> {t('flaggedBuildingLink')}</span>
                        </Link>
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
                        {building.labour_cents === 0 && building.labour_unpriced_seconds > 0 ? (
                          <span className="cell-muted">{t('labourUnknown')}</span>
                        ) : (
                          money(building.labour_cents)
                        )}
                        <span className="shift-state-note">
                          {t('labourHours', {
                            hours: formatDuration(building.labour_minutes),
                          })}
                        </span>
                        {/* Attached to the amount it qualifies, the way `revenuePartial`
                            is: this cell is the one that is too low, and it must not be
                            read without the hours it does not contain. */}
                        {building.labour_unpriced_seconds > 0 ? (
                          <span className="shift-state-note">
                            {t('labourUnpriced', {
                              workers: building.labour_unpriced_workers,
                              hours: formatDuration(building.labour_unpriced_minutes),
                            })}
                          </span>
                        ) : null}
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
                          buildings: buildings.length - totals.unpricedBuildings,
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
            )}
          </ListPanel>

          {/* Standing methodology. Every line is something a reader would otherwise
              reasonably assume the opposite of, and all of them change what the numbers
              mean. Permanently visible — never a tooltip, never behind a hover. It moved
              BELOW the table in the redesign and got smaller. It did not lose a line. */}
          <div className="callout">
            <h3>{t('methodHeading')}</h3>
            <ul>
              {/* The pool, the unpriced counts and the rate basis are PERIOD-wide facts.
                  They are not re-scoped when one building is selected, and pretending they
                  were would be a different number under the same label. */}
              {filters.location === null ? null : <li>{t('scopedNote')}</li>}
              {/* The old lede's second sentence: every number on this page is the server's
                  SQL over exactly the chosen days. The lede is gone, the fact is not. */}
              <li>{t('intro')}</li>
              {/* The reverse of `revenuePartial`: there the CONTRACT covers less than the
                  period, here the period covers more than has happened. Same honesty
                  channel, opposite direction, and the direction is the one that flatters. */}
              {stillRunning ? (
                <li>
                  {t('methodFuture', {
                    days: unhappenedDays,
                    periodDays: report.period_days,
                  })}
                </li>
              ) : null}
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
              {/* The cost side's twin of `methodUnpriced`: a real input nobody has priced,
                  counted rather than valued at zero, with the one link that fixes it.
                  `unpriced_workers` is the server's DISTINCT head count — one person at
                  three buildings is one rate to set, not three. */}
              {report.labour.unpriced_workers > 0 ? (
                <li>
                  {t('methodUnpricedLabour', {
                    workers: report.labour.unpriced_workers,
                    hours: formatDuration(report.labour.unpriced_minutes),
                    buildings: totals.unpricedLabourBuildings,
                  })}{' '}
                  <Link href={WORKERS_PATH}>{t('methodUnpricedLabourLink')}</Link>
                </li>
              ) : null}
              {totals.unpricedBuildings > 0 ? (
                <li>
                  {t('methodNoContract', {
                    buildings: totals.unpricedBuildings,
                    cost: money(totals.costCentsUnpriced),
                  })}{' '}
                  <Link href={CONTRACTS_PATH}>{t('methodNoContractLink')}</Link>
                </li>
              ) : null}
              <li>{t('attributionHint')}</li>
            </ul>
          </div>
        </>
      )}

      {/*
        THE ONE WRITE. Configurable, clearable, and never defaulted: an invented threshold
        would end up in a real conversation about revising a client's contract.
      */}
      <Drawer
        open={baselineOpen}
        onClose={() => setBaselineOpen(false)}
        title={t('baselineHeading')}
        busy={busy}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setBaselineOpen(false)}
              disabled={busy}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              form="pl-baseline-form"
              className="btn btn-primary"
              disabled={busy}
            >
              {busy ? t('submitting') : t('baselineSubmit')}
            </button>
          </>
        }
      >
        <p>{t('baselineIntro')}</p>
        {/* The form is in the body and the submit button is in the footer, joined by `form=`
            rather than by a click handler: Enter in the field must save, exactly as it did
            when the form was inline on the page. */}
        <form id="pl-baseline-form" onSubmit={submitBaseline} noValidate>
          <Field
            id={baselineId}
            label={t('fieldBaseline')}
            help={t('baselineHint')}
            error={baselineError ? t('errorBaselineInvalid') : undefined}
          >
            <input
              type="text"
              inputMode="decimal"
              value={baselineDraft}
              disabled={busy}
              onChange={(event) => setBaselineDraft(event.target.value)}
            />
          </Field>
        </form>
        {/* Clearing is in the BODY, not the footer: three buttons in a drawer footer wrap on
            a 480px drawer and the primary action ends up on its own line. Clearing is also
            reversible — it is re-settable from this same field — so it needs no confirm. */}
        {report?.baseline_set === true ? (
          <p className="form-actions">
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={removeBaseline}
            >
              {t('baselineClear')}
            </button>
          </p>
        ) : null}
      </Drawer>
    </>
  )
}
